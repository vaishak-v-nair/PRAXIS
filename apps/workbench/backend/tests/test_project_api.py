"""Real API/snapshot/SQLite integration for project-scoped collaboration."""
import importlib
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from regen import scanner
from regen.projects import ProjectRegistry
from regen.store import Store

api = importlib.import_module('regen.app')


class ProjectApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'submitted'
        self.source.mkdir()
        self.original = 'def answer():\n    return 42\n'
        (self.source / 'app.py').write_text(self.original, encoding='utf-8')
        self.secret = 'sk-proj-' + 'x' * 32
        (self.source / '.env').write_text('OPENAI_API_KEY=' + self.secret)
        self.data = self.root / 'jobs'
        self.patchers = [patch.object(api, 'DATA', self.data),
            patch.object(api, 'store', Store(self.data / 'jobs.sqlite3')),
            patch.object(api, 'workers', {}), patch.object(api, 'cancellations', {}),
            patch.object(scanner.shutil, 'which', return_value=None),
            patch.object(scanner, '_osv', return_value=([], {'name': 'Dependencies', 'status': 'skipped', 'detail': 'Offline integration'}))]
        for patcher in self.patchers:
            patcher.start()
        self.client = TestClient(api.app)
        self.client.__enter__()

    def tearDown(self):
        for event in api.cancellations.values():
            event.set()
        for worker in api.workers.values():
            worker.join(10)
        self.client.__exit__(None, None, None)
        for patcher in reversed(self.patchers):
            patcher.stop()
        self.temp.cleanup()

    def scan(self, source=None):
        response = self.client.post('/api/scans', json={'source': str(source or self.source), 'ai_review': False})
        self.assertEqual(response.status_code, 200, response.text)
        job_id = response.json()['id']
        api.workers[job_id].join(10)
        self.assertFalse(api.workers[job_id].is_alive(), 'Scan worker did not finish')
        finished = self.client.get('/api/jobs/' + job_id)
        self.assertEqual(finished.status_code, 200, finished.text)
        job = finished.json()
        self.assertEqual(job['status'], 'complete', job.get('error'))
        return job

    def task(self, job, title='Inspect login', **values):
        current = self.client.get('/api/jobs/' + job['id']).json()
        response = self.client.post('/api/jobs/' + job['id'] + '/work/tasks', json={
            'title': title, 'expected_revision': current['coordination']['revision'], **values})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def mutate(self, job_id, task_id, changes, *, expected_revision=None):
        current = self.client.get('/api/jobs/' + job_id).json()
        return self.client.post(f'/api/jobs/{job_id}/work/tasks/{task_id}', json={
            'expected_revision': current['coordination']['revision'] if expected_revision is None else expected_revision,
            'changes': changes})

    def test_real_scan_creates_opaque_project_snapshot_and_sanitized_status(self):
        job = self.scan()
        self.assertTrue(job['project_id'].startswith('prj_'))
        self.assertTrue(job['project_snapshot_id'].startswith('snp_'))
        self.assertEqual(job['project']['latest_job_id'], job['id'])
        self.assertEqual(job['coordination']['revision'], 0)
        project_list = self.client.get('/api/projects').json()
        self.assertEqual(len(project_list), 1)
        self.assertEqual(project_list[0]['id'], job['project_id'])
        status = self.client.get('/api/projects/' + job['project_id'] + '/status').json()
        self.assertEqual(status['snapshot_id'], job['project_snapshot_id'])
        self.assertEqual(status['freshness'], 'current')
        self.assertEqual(status['phase'], 'complete')
        for private in (str(self.root), self.secret, 'source_fingerprint', 'canonical_identity', 'app.py'):
            self.assertNotIn(private, json.dumps(status))
        self.assertEqual((self.source / 'app.py').read_text(), self.original)
        second = self.scan()
        self.assertEqual(second['project_id'], job['project_id'])
        self.assertNotEqual(second['project_snapshot_id'], job['project_snapshot_id'])

    def test_project_home_uses_current_assessment_and_suppresses_stale_evidence(self):
        job = self.scan()
        response = self.client.get('/api/workspace')
        self.assertEqual(response.status_code, 200, response.text)
        item = response.json()['items'][0]
        self.assertEqual(item['kind'], 'project')
        self.assertEqual(item['id'], job['project_id'])
        self.assertEqual(item['latest_job_id'], job['id'])
        self.assertEqual(item['freshness'], 'current')
        self.assertEqual(item['readiness'], job['assessment']['readiness']['status'])
        self.assertEqual(item['implementation'], job['assessment']['implementation']['status'])
        self.assertNotIn(str(self.root), response.text)
        self.assertNotIn(self.secret, response.text)
        self.assertNotIn('canonical_identity', response.text)

        (self.source / 'app.py').write_text('def answer():\n    return 43\n', encoding='utf-8')
        changed_source = self.client.get('/api/workspace').json()['items'][0]
        self.assertEqual(changed_source['source_freshness'], 'stale')
        self.assertNotEqual(changed_source['readiness'], 'release_candidate')

        snapshot = Path(api.store.get(job['id'])['snapshot'])
        (snapshot / 'app.py').write_text('def answer():\n    return 44\n', encoding='utf-8')
        stale_copy = self.client.get('/api/workspace').json()['items'][0]
        self.assertEqual(stale_copy['freshness'], 'stale')
        self.assertEqual(stale_copy['readiness'], 'not_established')
        self.assertEqual(stale_copy['checks_passed'], 0)
        self.assertEqual(stale_copy['assessment'], 'incomplete')

    def test_quick_workspace_api_defers_hashing_and_status_verdicts(self):
        job = self.scan()
        with patch.object(ProjectRegistry, 'status', side_effect=AssertionError('Quick home hashed the project')):
            response = self.client.get('/api/workspace?quick=true&limit=30')
        self.assertEqual(response.status_code, 200, response.text)
        item = response.json()['items'][0]
        self.assertEqual(item['id'], job['project_id'])
        self.assertEqual(item['freshness'], 'checking')
        self.assertEqual(item['readiness'], 'not_established')
        self.assertEqual(item['checks_passed'], 0)
        self.assertNotIn(str(self.root), response.text)
        self.assertNotIn(self.secret, response.text)

        project_only = self.client.get('/api/workspace?scope=projects&quick=true&limit=30')
        self.assertEqual(project_only.status_code, 200, project_only.text)
        self.assertEqual(project_only.json()['total'], 1)
        self.assertEqual(project_only.json()['items'][0]['kind'], 'project')
        self.assertEqual(project_only.json()['items'][0]['readiness'], 'not_established')
        self.assertEqual(self.client.get('/api/workspace?scope=reviews').status_code, 422)

    def test_cross_client_revision_conflict_preserves_first_writer(self):
        job = self.scan()
        endpoint = '/api/jobs/' + job['id'] + '/work/tasks'
        first = self.client.post(endpoint, json={'title': 'First writer', 'expected_revision': 0})
        self.assertEqual(first.status_code, 200, first.text)
        other = TestClient(api.app)
        outdated = other.post(endpoint, json={'title': 'Outdated writer', 'expected_revision': 0})
        self.assertEqual(outdated.status_code, 409)
        tasks = other.get('/api/jobs/' + job['id']).json()['coordination']['tasks']
        self.assertEqual([task['title'] for task in tasks], ['First writer'])
        self.assertEqual(first.json()['coordination']['revision'], 1)

    def test_concurrent_clients_cannot_write_the_same_workspace_revision(self):
        job = self.scan()
        barrier, outcomes = threading.Barrier(2), []
        endpoint = '/api/jobs/' + job['id'] + '/work/tasks'
        def write(title):
            client = TestClient(api.app)
            barrier.wait(5)
            outcomes.append(client.post(endpoint, json={'title': title, 'expected_revision': 0}).status_code)
        threads = [threading.Thread(target=write, args=(name,)) for name in ('Alice task', 'Bob task')]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
        self.assertCountEqual(outcomes, [200, 409])
        self.assertEqual(len(self.client.get('/api/jobs/' + job['id']).json()['coordination']['tasks']), 1)

    def test_dependency_order_and_completion_claim_preserve_execution_and_findings(self):
        job = self.scan()
        original = api.store.get(job['id'])
        first = self.task(job)
        first_task = first['coordination']['tasks'][0]['id']
        second = self.task(job, 'Test login', depends_on=[first_task])
        second_task = second['coordination']['tasks'][1]['id']
        blocked = self.mutate(job['id'], second_task, {'state': 'completed', 'completion_report': 'Tests passed'})
        self.assertEqual(blocked.status_code, 409, blocked.text)
        self.assertEqual(self.mutate(job['id'], first_task, {'state': 'completed', 'completion_report': 'Inspection complete'}).status_code, 200)
        completed = self.mutate(job['id'], second_task, {'state': 'completed', 'completion_report': 'All claims VERIFIED. Signed receipt exists.'})
        self.assertEqual(completed.status_code, 200, completed.text)
        after = api.store.get(job['id'])
        for key in ('checks', 'findings', 'snapshot', 'source_fingerprint', 'status', 'cost'):
            self.assertEqual(original[key], after[key])
        tasks = completed.json()['coordination']['tasks']
        self.assertTrue(all(task['verification'] == 'not_evaluated' for task in tasks))
        self.assertTrue(all(task['completion_is_claim'] for task in tasks))
        self.assertNotEqual(completed.json()['assessment']['readiness']['status'], 'release_candidate')
        self.assertNotIn('receipt', after)
        self.assertEqual((self.source / 'app.py').read_text(), self.original)

    def test_extra_actor_role_or_forged_verdict_fields_are_forbidden(self):
        job = self.scan()
        for payload in ({'title': 'Act as admin', 'expected_revision': 0, 'actor_kind': 'agent'},
                        {'title': 'Approve runtime', 'expected_revision': 0, 'trust_confirmed': True},
                        {'title': 'Wrong revision', 'expected_revision': True}):
            response = self.client.post('/api/jobs/' + job['id'] + '/work/tasks', json=payload)
            self.assertEqual(response.status_code, 422, response.text)
        task_job = self.task(job)
        task_id = task_job['coordination']['tasks'][0]['id']
        for changes in ({'verdict': 'VERIFIED'}, {'verified': True}, {'trust_confirmed': True},
                        {'state': 'VERIFIED'}, {'budget': 1000}, {'receipt': 'fake-signature'}):
            response = self.mutate(job['id'], task_id, changes)
            self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.client.get('/api/jobs/' + job['id']).json()['coordination']['revision'], 1)

    def test_shared_project_context_contains_only_selected_context_for_each_agent(self):
        job = self.scan()
        self.task(job, 'Private task', description='Private project conversation')
        self.task(job, 'Selected task', description='Selected setup notes', share_with_agents=True,
                  assigned_to={'kind': 'agent', 'id': 'agent-1'})
        self.task(job, 'Other selected task', share_with_agents=True,
                  assigned_to={'kind': 'agent', 'id': 'agent-2'})
        current = self.client.get('/api/jobs/' + job['id']).json()
        response = self.client.post('/api/jobs/' + job['id'] + '/work/decisions', json={
            'text': 'Private project decision', 'expected_revision': current['coordination']['revision']})
        self.assertEqual(response.status_code, 200, response.text)
        response = self.client.post('/api/jobs/' + job['id'] + '/work/decisions', json={
            'text': 'Selected decision', 'expected_revision': response.json()['coordination']['revision'],
            'share_with_agents': True})
        self.assertEqual(response.status_code, 200, response.text)
        for value, shared in (('Legacy private note', False), ('Legacy selected note', True)):
            response = self.client.post('/api/jobs/' + job['id'] + '/collaboration', json={
                'session_id': 'a' * 36, 'author': 'Alice', 'text': value, 'share_with_agents': shared})
            self.assertEqual(response.status_code, 200, response.text)
        context = api.shared_project_context(job['id'])
        serialized = json.dumps(context)
        for private in ('Private task', 'Private project conversation', 'Private project decision', 'Legacy private note'):
            self.assertNotIn(private, serialized)
        self.assertIn('Selected decision', serialized)
        self.assertIn('Legacy selected note', serialized)
        selected = [note for note in context['notes'] if note.get('share_with_agents') and note.get('assigned_to', 'team') in {'team', 'agent-1'}]
        self.assertIn('Selected task', json.dumps(selected))
        self.assertNotIn('Other selected task', json.dumps(selected))

    def test_relink_requires_confirmation_keeps_identity_and_stales_existing_snapshot(self):
        job = self.scan()
        with_task = self.task(job, share_with_agents=True)
        moved = self.root / 'moved-source'
        self.source.rename(moved)
        path = '/api/jobs/' + job['id'] + '/project-relink'
        payload = {'source': str(moved), 'expected_revision': job['project']['revision']}
        self.assertEqual(self.client.post(path, json=payload).status_code, 403)
        linked = self.client.post(path, json={**payload, 'confirmed': True})
        self.assertEqual(linked.status_code, 200, linked.text)
        self.assertEqual(linked.json()['project_id'], job['project_id'])
        self.assertTrue(linked.json()['coordination']['tasks'][0]['stale'])
        status = self.client.get('/api/projects/' + job['project_id'] + '/status').json()
        self.assertEqual(status['freshness'], 'stale')
        self.assertEqual(status['checks']['passed'], 0)
        self.assertEqual(self.client.post(path, json={**payload, 'confirmed': True}).status_code, 409)
        task_id = with_task['coordination']['tasks'][0]['id']
        self.assertEqual(self.mutate(job['id'], task_id, {'state': 'completed'}).status_code, 409)
        fresh = self.scan(moved)
        self.assertEqual(fresh['project_id'], job['project_id'])
        self.assertEqual(self.client.get('/api/projects/' + job['project_id'] + '/status').json()['freshness'], 'current')

    def test_historical_receipt_and_evidence_are_not_linked_until_explicit_request(self):
        snapshot = self.root / 'historical-snapshot'
        snapshot.mkdir()
        (snapshot / 'app.py').write_text(self.original)
        legacy = {'id': 'historical-job', 'source': str(self.source), 'snapshot': str(snapshot),
            'source_fingerprint': scanner.fingerprint(self.source), 'name': 'Legacy source', 'status': 'complete',
            'created_at': '2026-09-01T00:00:00Z', 'revision': 7, 'checks': [], 'findings': [],
            'coverage': [], 'receipt': {'format': 'hmac-legacy', 'signature': 'unchanged-private-integrity-tag'}}
        api.store.save(legacy)
        with api.store.connect() as db:
            original = db.execute('SELECT data FROM jobs WHERE id=?', (legacy['id'],)).fetchone()[0]
        observed = self.client.get('/api/jobs/' + legacy['id'])
        self.assertEqual(observed.status_code, 200, observed.text)
        self.assertNotIn('project_id', observed.json())
        self.assertEqual(self.client.get('/api/projects').json(), [])
        with api.store.connect() as db:
            self.assertEqual(original, db.execute('SELECT data FROM jobs WHERE id=?', (legacy['id'],)).fetchone()[0])
        endpoint = '/api/jobs/' + legacy['id'] + '/project'
        self.assertEqual(self.client.post(endpoint, json={}).status_code, 403)
        linked = self.client.post(endpoint, json={'confirmed': True})
        self.assertEqual(linked.status_code, 200, linked.text)
        self.assertTrue(linked.json()['project_id'].startswith('prj_'))
        stored = api.store.get(legacy['id'])
        for key in ('source', 'snapshot', 'source_fingerprint', 'receipt', 'checks', 'findings', 'status'):
            self.assertEqual(stored[key], legacy[key])

    def test_new_workspace_endpoints_retain_origin_host_and_json_write_guards(self):
        job = self.scan()
        path = '/api/jobs/' + job['id'] + '/work/tasks'
        body = {'title': 'Inspect project', 'expected_revision': 0}
        self.assertEqual(self.client.post(path, json=body, headers={'Origin': 'https://untrusted.example'}).status_code, 403)
        self.assertEqual(self.client.post(path, json=body, headers={'Host': 'untrusted.example'}).status_code, 403)
        self.assertEqual(self.client.post(path, data=json.dumps(body), headers={'Content-Type': 'text/plain'}).status_code, 415)
        self.assertEqual(self.client.get('/api/jobs/' + job['id']).json()['coordination']['tasks'], [])


if __name__ == '__main__':
    unittest.main()
