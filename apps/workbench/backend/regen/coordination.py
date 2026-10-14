"""Local people/agent work coordination over one durable project and snapshot.

Tasks and completion reports are scheduling data, never execution proof. Human
decisions do not authorize runtime, model spend, source apply or verdict changes.
The caller must derive actor identity/role from its trusted request channel;
never forward an ``actor_kind`` chosen by model output or submitted source.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time

from .projects import ProjectError, ProjectRegistry, identifier, now, opaque_id, revision, source_identity, text
from .scanner import fingerprint

MAX_TASKS = 200
MAX_DECISIONS = 100
MAX_HANDOFFS = 100
STATES = {'open', 'in_progress', 'blocked', 'completed', 'cancelled'}


def _actor(kind, actor_id):
    if not isinstance(kind, str) or kind not in {'human', 'agent'}:
        raise ProjectError('An explicit human or agent caller is required', 403)
    return {'kind': kind, 'id': identifier(actor_id, 'Actor ID')}


def _assignment(value):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {'kind', 'id'}:
        raise ProjectError('An assignment needs a participant kind and ID')
    return _actor(value.get('kind'), value.get('id'))


def _boolean(value, label):
    if not isinstance(value, bool):
        raise ProjectError(label + ' must be true or false')
    return value


def _dependencies(values):
    if not isinstance(values, list) or len(values) > 20:
        raise ProjectError('A task accepts at most 20 dependencies')
    result = [identifier(value, 'Dependency ID') for value in values]
    if len(result) != len(set(result)):
        raise ProjectError('Dependencies must be unique')
    return result


class Coordination:
    def __init__(self, store, *, registry=None, clock=time.time):
        self.store = store
        self.registry = registry or ProjectRegistry(store)
        self.clock = clock
        with store.lock, store.connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS praxis_coordination (
                project_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL)''')
            db.execute('''CREATE TABLE IF NOT EXISTS praxis_coordination_requests (
                project_id TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
                PRIMARY KEY(project_id,request_key))''')

    @staticmethod
    def _board(db, project_id):
        row = db.execute('SELECT data FROM praxis_coordination WHERE project_id=?', (project_id,)).fetchone()
        return json.loads(row[0]) if row else {'schema_version': 1, 'project_id': project_id,
            'revision': 0, 'tasks': [], 'decisions': [], 'handoffs': [], 'updated_at': None}

    @staticmethod
    def _task(board, task_id):
        identifier(task_id, 'Task ID')
        found = next((task for task in board['tasks'] if task['id'] == task_id), None)
        if not found:
            raise ProjectError('Task not found in this project', 404)
        return found

    @staticmethod
    def _fresh(db, project, task):
        if (task.get('snapshot_id') != project['latest_snapshot_id'] or
                task.get('job_id') != project['latest_job_id']):
            return False
        snapshot = db.execute('SELECT subject,fingerprint FROM praxis_project_snapshots WHERE id=? AND project_id=? AND job_id=?',
                              (task['snapshot_id'], project['id'], task['job_id'])).fetchone()
        job = db.execute('SELECT data FROM jobs WHERE id=?', (task['job_id'],)).fetchone()
        if not snapshot or not job:
            return False
        from pathlib import Path
        data = json.loads(job[0])
        subject = data.get('fix_path') or data.get('snapshot')
        try:
            kind, identity, _ = source_identity(data.get('source', ''))
            return (kind == project['source_kind'] and identity == project['canonical_identity'] and
                    isinstance(subject, str) and str(Path(subject).resolve()) == snapshot[0] and
                    Path(snapshot[0]).is_dir() and not Path(snapshot[0]).is_symlink() and
                    fingerprint(Path(snapshot[0])) == snapshot[1])
        except (ProjectError, OSError, ValueError, RuntimeError):
            return False

    def _public(self, db, board, project, *, job_id=None):
        result = json.loads(json.dumps(board))
        result['snapshot_id'] = project['latest_snapshot_id']
        result['job_id'] = project['latest_job_id']
        timestamp = self.clock()
        observed = {}
        result['tasks'] = [task for task in result['tasks'] if job_id is None or task['job_id'] == job_id]
        for task in result['tasks']:
            binding = (task['job_id'], task['snapshot_id'])
            if binding not in observed:
                observed[binding] = self._fresh(db, project, task)
            task['stale'] = not observed[binding]
            lease = task.pop('_lease', None)
            task['lease'] = {'owner': lease['owner'], 'expires_at': lease['expires_at'],
                             'status': 'active' if lease['expires_at'] > timestamp and not task['stale'] else
                                       'stale' if task['stale'] else 'expired'} if lease else None
            task['verification'] = 'not_evaluated'
            task['completion_is_claim'] = True
        if job_id is not None:
            result['decisions'] = [item for item in result['decisions'] if item['job_id'] in {None, job_id}]
            result['handoffs'] = [item for item in result['handoffs'] if item['job_id'] == job_id]
        return result

    def get(self, project_id, *, job_id=None):
        if job_id is not None:
            identifier(job_id, 'Job ID')
        with self.store.lock, self.store.connect() as db:
            project = self.registry._get(db, project_id)
            return self._public(db, self._board(db, project_id), project, job_id=job_id)

    @staticmethod
    def _selected(board, actor_id, *, include_own=False):
        agent = _actor('agent', actor_id)
        tasks = [task for task in board['tasks'] if not task['stale'] and task['share_with_agents'] and
                 task['assigned_to'] in (None, agent)]
        selected_tasks = {task['id'] for task in tasks}
        decisions = [item for item in board['decisions'] if
                     (item['share_with_agents'] and item['authority'] == 'human_recorded' and
                      (item['snapshot_id'] is None or item['snapshot_id'] == board['snapshot_id'])) or
                     (include_own and item['actor'] == agent)]
        handoffs = [item for item in board['handoffs'] if item['share_with_agents'] and item['recipient'] == agent and
                    item['task_id'] in selected_tasks]
        notes = [{'id': item['id'], 'kind': item['kind'], 'text': item['text'], 'share_with_agents': True,
                  'assigned_to': actor_id, 'authority': 'human_context_data'} for item in decisions if item['share_with_agents']]
        notes.extend({'id': item['id'], 'kind': 'goal', 'text': item['title'] + '\n' + item['description'],
                      'share_with_agents': True, 'assigned_to': actor_id, 'authority': 'human_context_data'} for item in tasks)
        notes.extend({'id': item['id'], 'kind': 'question', 'text': item['text'], 'share_with_agents': True,
                      'assigned_to': actor_id, 'authority': 'human_context_data'} for item in handoffs)
        return {**board, 'tasks': tasks, 'decisions': decisions, 'handoffs': handoffs, 'notes': notes,
                'context_is_untrusted_data': True, 'authorizes_execution': False}

    def _response(self, db, board, project, actor):
        result = self._public(db, board, project)
        return self._selected(result, actor['id'], include_own=True) if actor['kind'] == 'agent' else result

    def _mutate(self, project_id, expected_revision, actor, action, payload, callback, *, idempotency_key=None):
        expected_revision = revision(expected_revision)
        if idempotency_key is not None:
            identifier(idempotency_key, 'Idempotency key')
        digest = hashlib.sha256(json.dumps({'actor': actor, 'action': action, 'payload': payload},
                                         sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        with self.store.lock, self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            project = self.registry._get(db, project_id)
            board = self._board(db, project_id)
            if idempotency_key is not None:
                prior = db.execute('SELECT request_hash FROM praxis_coordination_requests WHERE project_id=? AND request_key=?',
                                   (project_id, idempotency_key)).fetchone()
                if prior:
                    if not hmac.compare_digest(prior[0], digest):
                        raise ProjectError('That idempotency key already identifies a different request', 409)
                    return self._response(db, board, project, actor)
            if board['revision'] != expected_revision:
                raise ProjectError('Shared work changed; refresh before updating it', 409)
            extra = callback(db, board, project) or {}
            board['revision'] += 1
            board['updated_at'] = now()
            db.execute('INSERT INTO praxis_coordination(project_id,revision,data) VALUES(?,?,?) '
                       'ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,data=excluded.data',
                       (project_id, board['revision'], json.dumps(board)))
            if idempotency_key is not None:
                db.execute('INSERT INTO praxis_coordination_requests(project_id,request_key,request_hash) VALUES(?,?,?)',
                           (project_id, idempotency_key, digest))
            return {**self._response(db, board, project, actor), **extra}

    def _scope(self, db, project, job_id):
        identifier(job_id, 'Job ID')
        if project['latest_job_id'] != job_id or not project['latest_snapshot_id']:
            raise ProjectError('Tasks require this project\'s current prepared review', 409)
        binding = {'job_id': job_id, 'snapshot_id': project['latest_snapshot_id']}
        if not self._fresh(db, project, binding):
            raise ProjectError('The project review snapshot is unavailable or stale; rescan first', 409)
        return binding

    @staticmethod
    def _validate_graph(board):
        tasks = {task['id']: task for task in board['tasks']}
        for task in tasks.values():
            for dependency in task['depends_on']:
                if dependency not in tasks or tasks[dependency]['job_id'] != task['job_id'] or tasks[dependency]['snapshot_id'] != task['snapshot_id']:
                    raise ProjectError('Dependencies must reference tasks in the same project review')
                if task['state'] in {'in_progress', 'completed'} and tasks[dependency]['state'] != 'completed':
                    raise ProjectError('Active or completed work cannot have an incomplete prerequisite', 409)
        active, visited = set(), set()
        def visit(task_id):
            if task_id in active:
                raise ProjectError('Task dependencies cannot contain a cycle')
            if task_id in visited:
                return
            active.add(task_id)
            for dependency in tasks[task_id]['depends_on']:
                visit(dependency)
            active.remove(task_id)
            visited.add(task_id)
        for task_id in tasks:
            visit(task_id)

    @staticmethod
    def _dependencies_ready(board, task):
        states = {item['id']: item['state'] for item in board['tasks']}
        if any(states.get(dependency) != 'completed' for dependency in task['depends_on']):
            raise ProjectError('Complete the prerequisite task reports before starting this task', 409)

    def create_task(self, project_id, *, job_id, title, expected_revision, actor_kind, actor_id,
                    description='', depends_on=None, assigned_to=None, share_with_agents=False, idempotency_key=None):
        actor = _actor(actor_kind, actor_id)
        if actor_kind != 'human':
            raise ProjectError('Only a human can create or assign project work', 403)
        values = {'job_id': identifier(job_id, 'Job ID'), 'title': text(title, 'Task title', 160),
                  'description': text(description, 'Task description', 4000, empty=True),
                  'depends_on': _dependencies([] if depends_on is None else depends_on),
                  'assigned_to': _assignment(assigned_to), 'share_with_agents': _boolean(share_with_agents, 'Sharing choice')}
        def create(db, board, project):
            if len(board['tasks']) >= MAX_TASKS:
                raise ProjectError('This project has reached its 200-task limit', 409)
            scope = self._scope(db, project, job_id)
            board['tasks'].append({**values, **scope, 'id': opaque_id('tsk'), 'state': 'open',
                'created_at': now(), 'updated_at': now(), 'created_by': actor, 'completion_report': '', '_lease': None})
            self._validate_graph(board)
        return self._mutate(project_id, expected_revision, actor, 'create_task', values, create, idempotency_key=idempotency_key)

    def update_task(self, project_id, task_id, *, changes, expected_revision, actor_kind, actor_id,
                    lease_token=None, idempotency_key=None):
        actor = _actor(actor_kind, actor_id)
        identifier(task_id, 'Task ID')
        if not isinstance(changes, dict) or not changes:
            raise ProjectError('Supply task changes')
        allowed = {'title', 'description', 'depends_on', 'assigned_to', 'share_with_agents', 'state', 'completion_report'}
        if set(changes) - allowed:
            raise ProjectError('Task changes cannot authorize execution or alter verification')
        if actor_kind == 'agent' and set(changes) - {'state', 'completion_report'}:
            raise ProjectError('Agents can report progress only on their selected work', 403)
        values = dict(changes)
        for field, maximum in (('title', 160), ('description', 4000), ('completion_report', 4000)):
            if field in values:
                values[field] = text(values[field], field.replace('_', ' ').title(), maximum, empty=field != 'title')
        if 'depends_on' in values:
            values['depends_on'] = _dependencies(values['depends_on'])
        if 'assigned_to' in values:
            values['assigned_to'] = _assignment(values['assigned_to'])
        if 'share_with_agents' in values:
            values['share_with_agents'] = _boolean(values['share_with_agents'], 'Sharing choice')
        if 'state' in values and (not isinstance(values['state'], str) or values['state'] not in STATES):
            raise ProjectError('Task state must be open, in progress, blocked, completed or cancelled')
        def update(db, board, project):
            task = self._task(board, task_id)
            if actor_kind == 'agent':
                self._validate_lease(db, project, task, actor_id, lease_token)
                if values.get('state') not in {None, 'in_progress', 'blocked', 'completed'}:
                    raise ProjectError('An agent cannot cancel or reopen human-assigned work', 403)
            if values.get('state') in {'in_progress', 'completed'}:
                if not self._fresh(db, project, task):
                    raise ProjectError('This task refers to a stale review snapshot', 409)
                self._dependencies_ready(board, task)
            task.update(values, updated_at=now())
            if actor_kind == 'human' and (set(values) & {'assigned_to', 'share_with_agents', 'depends_on'} or values.get('state') in {'open', 'cancelled'}):
                task['_lease'] = None
            if values.get('state') in {'completed', 'blocked', 'cancelled'}:
                task['_lease'] = None
            self._validate_graph(board)
        return self._mutate(project_id, expected_revision, actor, 'update_task', {'task_id': task_id, 'changes': values},
                            update, idempotency_key=idempotency_key)

    def _validate_lease(self, db, project, task, actor_id, token):
        if not self._fresh(db, project, task):
            raise ProjectError('This task refers to a stale review snapshot', 409)
        lease = task.get('_lease')
        if not task['share_with_agents'] or not isinstance(token, str) or not lease or lease['owner'] != actor_id or lease['expires_at'] <= self.clock():
            raise ProjectError('An active lease for this agent is required', 403)
        if not hmac.compare_digest(lease['token_hash'], hashlib.sha256(token.encode()).hexdigest()):
            raise ProjectError('The task lease is invalid', 403)

    def claim_task(self, project_id, task_id, *, expected_revision, actor_id, lease_seconds=120):
        actor = _actor('agent', actor_id)
        identifier(task_id, 'Task ID')
        if not isinstance(lease_seconds, int) or isinstance(lease_seconds, bool) or not 15 <= lease_seconds <= 900:
            raise ProjectError('A task lease must last 15–900 seconds')
        token = secrets.token_urlsafe(32)
        def claim(db, board, project):
            task = self._task(board, task_id)
            if not self._fresh(db, project, task):
                raise ProjectError('This task refers to a stale review snapshot', 409)
            if not task['share_with_agents'] or task['assigned_to'] not in (None, actor):
                raise ProjectError('This task is not selected for this agent', 403)
            if task['state'] in {'completed', 'cancelled'}:
                raise ProjectError('This task is already closed', 409)
            self._dependencies_ready(board, task)
            lease = task.get('_lease')
            if lease and lease['expires_at'] > self.clock():
                raise ProjectError('This task already has an active agent lease', 409)
            task.update(state='in_progress', updated_at=now(), _lease={'owner': actor_id,
                'expires_at': self.clock() + lease_seconds, 'token_hash': hashlib.sha256(token.encode()).hexdigest()})
            return {'lease_token': token}
        return self._mutate(project_id, expected_revision, actor, 'claim_task', {'task_id': task_id}, claim)

    def renew_lease(self, project_id, task_id, *, expected_revision, actor_id, lease_token, lease_seconds=120):
        actor = _actor('agent', actor_id)
        identifier(task_id, 'Task ID')
        if not isinstance(lease_seconds, int) or isinstance(lease_seconds, bool) or not 15 <= lease_seconds <= 900:
            raise ProjectError('A task lease must last 15–900 seconds')
        def renew(db, board, project):
            task = self._task(board, task_id)
            self._validate_lease(db, project, task, actor_id, lease_token)
            task['_lease']['expires_at'] = self.clock() + lease_seconds
        return self._mutate(project_id, expected_revision, actor, 'renew_lease', {'task_id': task_id}, renew)

    def record_decision(self, project_id, *, text: str, expected_revision, actor_kind, actor_id,
                        kind='decision', job_id=None, share_with_agents=False, idempotency_key=None):
        actor = _actor(actor_kind, actor_id)
        if not isinstance(kind, str) or kind not in {'goal', 'question', 'decision'}:
            raise ProjectError('Record a goal, question or decision')
        shared = _boolean(share_with_agents, 'Sharing choice')
        if job_id is not None:
            identifier(job_id, 'Job ID')
        if actor_kind == 'agent' and shared:
            raise ProjectError('An agent cannot share private human context', 403)
        from .projects import text as clean_text
        values = {'kind': kind, 'text': clean_text(text, 'Decision text', 2000), 'job_id': job_id,
                  'share_with_agents': shared, 'actor': actor,
                  'authority': 'human_recorded' if actor_kind == 'human' else 'agent_suggestion'}
        def record(db, board, project):
            if len(board['decisions']) >= MAX_DECISIONS:
                raise ProjectError('This project has reached its 100-decision limit', 409)
            scope = self._scope(db, project, job_id) if job_id is not None else {'job_id': None, 'snapshot_id': None}
            board['decisions'].append({**values, **scope, 'id': opaque_id('dec'), 'created_at': now(),
                                       'authorizes_execution': False})
        return self._mutate(project_id, expected_revision, actor, 'record_decision', values, record, idempotency_key=idempotency_key)

    def handoff(self, project_id, *, task_id, recipient, text: str, expected_revision, actor_kind, actor_id,
                share_with_agents=False, idempotency_key=None):
        actor = _actor(actor_kind, actor_id)
        recipient = _assignment(recipient)
        if recipient is None:
            raise ProjectError('A handoff needs a recipient')
        shared = _boolean(share_with_agents, 'Sharing choice')
        if actor_kind != 'human':
            raise ProjectError('A human must select the destination and context of a handoff', 403)
        from .projects import text as clean_text
        values = {'task_id': identifier(task_id, 'Task ID'), 'recipient': recipient,
                  'text': clean_text(text, 'Handoff text', 4000), 'share_with_agents': shared, 'actor': actor}
        def handoff(db, board, project):
            if len(board['handoffs']) >= MAX_HANDOFFS:
                raise ProjectError('This project has reached its 100-handoff limit', 409)
            task = self._task(board, task_id)
            if not self._fresh(db, project, task):
                raise ProjectError('A handoff requires the current review snapshot', 409)
            board['handoffs'].append({**values, 'id': opaque_id('hnd'), 'created_at': now(),
                'job_id': task['job_id'], 'snapshot_id': task['snapshot_id'], 'authorizes_execution': False})
        return self._mutate(project_id, expected_revision, actor, 'handoff', values, handoff, idempotency_key=idempotency_key)

    def agent_context(self, project_id, actor_id, *, job_id=None):
        """Selected data only. Compatible ``notes`` do not become instructions.

        Existing job collaboration remains separate and is never copied here.
        The service may combine its independently filtered expressly shared notes
        with this response for the existing ``team.human_context`` callback.
        """
        _actor('agent', actor_id)
        board = self.get(project_id, job_id=job_id)
        return self._selected(board, actor_id)
