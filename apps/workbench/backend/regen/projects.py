"""Additive local project identity; job evidence and private memory stay untouched.

The API adapter must derive caller authority itself. ``actor_kind`` is trusted
server context, never a role selected in submitted project or model output.
Only opaque references and allowlisted counters leave the status projection.
"""
from __future__ import annotations

import json
import math
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

from . import review
from .scanner import fingerprint, redact

SCHEMA_VERSION = 1
ID_PATTERN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
PHASES = {'scanning', 'analyzing', 'planning_fix', 'fixing', 'verifying',
          'paused', 'complete', 'error', 'cancelled'}


class ProjectError(ValueError):
    def __init__(self, message, status_code=422):
        super().__init__(message)
        self.status_code = status_code


def opaque_id(prefix):
    return prefix + '_' + uuid.uuid4().hex


def now():
    return datetime.now(timezone.utc).isoformat()


def identifier(value, label='Identifier'):
    if not isinstance(value, str) or not ID_PATTERN.fullmatch(value) or redact(value, limit=None) != value:
        raise ProjectError(label + ' is invalid')
    return value


def revision(value):
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ProjectError('A nonnegative expected revision is required')
    return value


def text(value, label='Text', maximum=2000, *, empty=False):
    if not isinstance(value, str) or len(value) > maximum or (not empty and not value.strip()):
        raise ProjectError(label + ' must be nonempty and at most ' + str(maximum) + ' characters')
    value = re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', '', value.strip())
    if not empty and not value:
        raise ProjectError(label + ' must contain readable text')
    return redact(value, limit=None)


def source_identity(source, source_kind=None):
    """Canonicalize identities without fetching, scanning or executing source."""
    if not isinstance(source, str) or not source.strip() or len(source) > 4096 or re.search(r'[\x00-\x1f\x7f]', source):
        raise ProjectError('A valid source is required')
    source = source.strip()
    parsed = urlparse(source)
    inferred = 'upload' if source.startswith('upload://') else 'github' if parsed.scheme in {'http', 'https'} else 'local'
    kind = inferred if source_kind is None else source_kind
    if not isinstance(kind, str) or kind not in {'local', 'github', 'upload'} or kind != inferred:
        raise ProjectError('The source kind does not match its identity')
    if kind == 'github':
        if parsed.scheme != 'https' or parsed.netloc.lower() != 'github.com' or parsed.query or parsed.fragment or '%' in parsed.path:
            raise ProjectError('Use an HTTPS GitHub repository URL without credentials or extra paths')
        parts = parsed.path.rstrip('/').split('/')
        if len(parts) != 3 or parts[0] or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', parts[1]):
            raise ProjectError('Use a GitHub owner/repository URL')
        repository = parts[2][:-4] if parts[2].lower().endswith('.git') else parts[2]
        if not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', repository) or repository in {'.', '..'}:
            raise ProjectError('Use a GitHub owner/repository URL')
        return kind, f'https://github.com/{parts[1].lower()}/{repository.lower()}', repository
    if kind == 'upload':
        if not re.fullmatch(r'[a-f0-9]{32}', parsed.netloc) or parsed.query or parsed.fragment:
            raise ProjectError('Use a valid uploaded-project reference')
        name = unquote(parsed.path.lstrip('/'))
        if not name or '/' in name or '\\' in name or name in {'.', '..'} or re.search(r'[\x00-\x1f\x7f]', name):
            raise ProjectError('Use a valid uploaded-project reference')
        # An upload token identifies one explicitly selected copy, never a local
        # source with a coincidentally matching filename or GitHub origin.
        return kind, 'upload://' + parsed.netloc, name
    path = Path(source).expanduser()
    if not path.is_absolute():
        raise ProjectError('Local source paths must be absolute')
    try:
        canonical = os.path.normcase(str(path.resolve()))
    except (OSError, ValueError, RuntimeError):
        raise ProjectError('Local source path is unavailable') from None
    return kind, canonical, path.name or 'Project'


def _public(record):
    return {key: record.get(key) for key in ('schema_version', 'id', 'revision', 'source_kind', 'name',
            'created_at', 'updated_at', 'latest_job_id', 'latest_snapshot_id')}


class ProjectRegistry:
    def __init__(self, store):
        self.store = store
        with store.lock, store.connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS praxis_projects (
                id TEXT PRIMARY KEY, source_kind TEXT NOT NULL, canonical_identity TEXT NOT NULL,
                revision INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(source_kind, canonical_identity))''')
            db.execute('''CREATE TABLE IF NOT EXISTS praxis_project_snapshots (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL,
                subject TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL,
                UNIQUE(project_id, job_id, subject, fingerprint))''')
            db.execute('''CREATE TABLE IF NOT EXISTS praxis_project_relinks (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created_at TEXT NOT NULL)''')
            db.execute('''CREATE TABLE IF NOT EXISTS praxis_project_status (
                project_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL,
                emitted_at TEXT NOT NULL)''')

    @staticmethod
    def _get(db, project_id):
        identifier(project_id, 'Project ID')
        row = db.execute('SELECT data FROM praxis_projects WHERE id=?', (project_id,)).fetchone()
        if not row:
            raise ProjectError('Project not found', 404)
        return json.loads(row[0])

    @staticmethod
    def _expect(record, expected_revision):
        if record['revision'] != revision(expected_revision):
            raise ProjectError('Project changed; refresh before updating it', 409)

    @staticmethod
    def _save(db, record):
        db.execute('UPDATE praxis_projects SET source_kind=?,canonical_identity=?,revision=?,data=? WHERE id=?',
                   (record['source_kind'], record['canonical_identity'], record['revision'], json.dumps(record), record['id']))

    def register(self, source, *, source_kind=None, name=None):
        kind, identity, suggested = source_identity(source, source_kind)
        display_name = text(name if name is not None else suggested, 'Project name', 255)
        with self.store.lock, self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT data FROM praxis_projects WHERE source_kind=? AND canonical_identity=?', (kind, identity)).fetchone()
            if row:
                return _public(json.loads(row[0]))
            timestamp = now()
            record = {'schema_version': SCHEMA_VERSION, 'id': opaque_id('prj'), 'revision': 0,
                      'source_kind': kind, 'canonical_identity': identity, 'name': display_name,
                      'created_at': timestamp, 'updated_at': timestamp,
                      'latest_job_id': None, 'latest_snapshot_id': None}
            db.execute('INSERT INTO praxis_projects(id,source_kind,canonical_identity,revision,data) VALUES(?,?,?,?,?)',
                       (record['id'], kind, identity, 0, json.dumps(record)))
            return _public(record)

    def get(self, project_id, *, private=False):
        with self.store.lock, self.store.connect() as db:
            record = self._get(db, project_id)
        return record if private else _public(record)

    def all(self):
        with self.store.lock, self.store.connect() as db:
            rows = db.execute('SELECT data FROM praxis_projects ORDER BY rowid DESC').fetchall()
        return [_public(json.loads(row[0])) for row in rows]

    def snapshots(self, project_id):
        with self.store.lock, self.store.connect() as db:
            self._get(db, project_id)
            rows = db.execute('SELECT id,job_id,created_at FROM praxis_project_snapshots WHERE project_id=? ORDER BY rowid DESC',
                              (project_id,)).fetchall()
        return [{'id': row[0], 'job_id': row[1], 'created_at': row[2]} for row in rows]

    def relinks(self, project_id):
        with self.store.lock, self.store.connect() as db:
            self._get(db, project_id)
            rows = db.execute('SELECT id,created_at FROM praxis_project_relinks WHERE project_id=? ORDER BY rowid', (project_id,)).fetchall()
        return [{'id': row[0], 'created_at': row[1]} for row in rows]

    def attach_job(self, project_id, job_id, *, expected_revision):
        """Reference an existing prepared job; never rewrite or certify its data.

        An intake without a prepared snapshot must wait. Fingerprinting reads only
        the already bounded review copy and the digest remains private.
        """
        identifier(job_id, 'Job ID')
        # Hash the potentially large review copy without holding the store lock
        # or a SQLite write transaction. The inputs are compared again before
        # the snapshot reference is committed.
        with self.store.lock, self.store.connect() as db:
            record = self._get(db, project_id)
            self._expect(record, expected_revision)
            row = db.execute('SELECT data FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not row:
                raise ProjectError('Job not found', 404)
            job = json.loads(row[0])
            kind, identity, _ = source_identity(job.get('source', ''))
            if kind != record['source_kind'] or identity != record['canonical_identity']:
                raise ProjectError('This job belongs to a different project source', 409)
            subject = job.get('fix_path') or job.get('snapshot')
            if not isinstance(subject, str) or not Path(subject).is_absolute() or not Path(subject).is_dir() or Path(subject).is_symlink():
                raise ProjectError('The prepared review copy is unavailable', 409)
            subject = str(Path(subject).resolve())
        digest = fingerprint(Path(subject))
        with self.store.lock, self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            record = self._get(db, project_id)
            self._expect(record, expected_revision)
            current_job = db.execute('SELECT data FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not current_job or current_job[0] != row[0] or not Path(subject).is_dir() or Path(subject).is_symlink():
                raise ProjectError('The prepared review changed while binding it; retry with current evidence', 409)
            existing = db.execute('SELECT id FROM praxis_project_snapshots WHERE project_id=? AND job_id=? AND subject=? AND fingerprint=?',
                                  (project_id, job_id, subject, digest)).fetchone()
            snapshot_id = existing[0] if existing else opaque_id('snp')
            if not existing:
                db.execute('INSERT INTO praxis_project_snapshots(id,project_id,job_id,subject,fingerprint,created_at) VALUES(?,?,?,?,?,?)',
                           (snapshot_id, project_id, job_id, subject, digest, now()))
            if record['latest_job_id'] != job_id or record['latest_snapshot_id'] != snapshot_id:
                record.update(latest_job_id=job_id, latest_snapshot_id=snapshot_id, updated_at=now(), revision=record['revision'] + 1)
                self._save(db, record)
            return _public(record)

    def relink(self, project_id, source, *, expected_revision, confirmed, actor_kind='human'):
        if actor_kind != 'human' or confirmed is not True:
            raise ProjectError('Moved-folder recovery requires explicit human confirmation', 403)
        kind, identity, _ = source_identity(source)
        if kind != 'local' or not Path(identity).is_dir() or Path(source).is_symlink():
            raise ProjectError('Choose an existing local project folder')
        with self.store.lock, self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            record = self._get(db, project_id)
            self._expect(record, expected_revision)
            if record['source_kind'] != 'local':
                raise ProjectError('Only local projects support moved-folder recovery')
            if identity == record['canonical_identity']:
                return _public(record)
            occupied = db.execute('SELECT id FROM praxis_projects WHERE source_kind=? AND canonical_identity=?', (kind, identity)).fetchone()
            if occupied:
                raise ProjectError('That folder is already linked to another project', 409)
            # A relink retains historical snapshot references. They become stale
            # until a new scan binds evidence to the explicitly selected source.
            record.update(canonical_identity=identity, revision=record['revision'] + 1, updated_at=now())
            self._save(db, record)
            db.execute('INSERT INTO praxis_project_relinks(id,project_id,created_at) VALUES(?,?,?)', (opaque_id('rel'), project_id, now()))
            return _public(record)

    @staticmethod
    def _freshness(project, job, snapshot):
        """Keep the reviewed copy and original local source as separate scopes.

        Hashes cover the same bounded, eligible files used by intake. Remote
        repository/deployment state is never fetched during a status request.
        """
        local = project['source_kind'] == 'local'
        source = Path(project['canonical_identity']) if local else None
        try:
            source_available = not local or (source.is_dir() and not source.is_symlink())
            source_freshness = 'unknown' if source_available else 'unavailable'
            if local and job and source_available:
                kind, identity, _ = source_identity(job.get('source', ''))
                baseline = job.get('source_fingerprint')
                if kind != 'local' or identity != project['canonical_identity']:
                    source_freshness = 'stale'
                elif isinstance(baseline, str) and re.fullmatch(r'[a-f0-9]{64}', baseline):
                    source_freshness = 'current' if fingerprint(source) == baseline else 'stale'
        except (ProjectError, OSError, ValueError, RuntimeError):
            source_available, source_freshness = False, 'unavailable'
        freshness = 'unavailable'
        if job and snapshot:
            try:
                subject = job.get('fix_path') or job.get('snapshot')
                path = Path(snapshot[0])
                if path.is_dir() and not path.is_symlink():
                    kind, identity, _ = source_identity(job.get('source', ''))
                    stale = (kind != project['source_kind'] or identity != project['canonical_identity'] or
                             not isinstance(subject, str) or str(Path(subject).resolve()) != snapshot[0] or
                             bool(job.get('checks') and job.get('checks_for') and job['checks_for'] != subject) or
                             fingerprint(path) != snapshot[1])
                    freshness = 'stale' if stale else 'current'
            except (ProjectError, OSError, ValueError, RuntimeError):
                freshness = 'unavailable'
        return {'freshness': freshness, 'source_freshness': source_freshness,
                'source_available': source_available}

    def job_freshness(self, job):
        """Read one explicitly linked historical job without altering evidence."""
        with self.store.lock, self.store.connect() as db:
            project = self._get(db, job['project_id'])
            snapshot_id = job.get('project_snapshot_id')
            if snapshot_id:
                snapshot = db.execute('SELECT subject,fingerprint FROM praxis_project_snapshots '
                                      'WHERE id=? AND project_id=? AND job_id=?',
                                      (snapshot_id, project['id'], job['id'])).fetchone()
            else:
                snapshot = db.execute('SELECT subject,fingerprint FROM praxis_project_snapshots '
                                      'WHERE project_id=? AND job_id=? ORDER BY rowid DESC LIMIT 1',
                                      (project['id'], job['id'])).fetchone()
        return self._freshness(project, job, snapshot)

    def status(self, project_id, *, instance_id, previous_revision=None):
        """Small, durable, monotonic projection for browser/tray/desktop polling.

        No source excerpts, paths, conversation, provider names/keys, exception
        text, or stored model assessment is accepted as status evidence. Current
        job evidence is assessed deterministically and stale counts are suppressed.
        This projection fingerprints the bounded review copy before using its
        checks. Guarded runtime/apply operations retain their source checks.
        """
        identifier(instance_id, 'Instance ID')
        if previous_revision is not None:
            revision(previous_revision)
        def inputs(db):
            project = self._get(db, project_id)
            row = db.execute('SELECT data FROM jobs WHERE id=?', (project['latest_job_id'],)).fetchone()
            snapshot = db.execute('SELECT subject,fingerprint FROM praxis_project_snapshots WHERE id=? AND project_id=?',
                                  (project['latest_snapshot_id'], project_id)).fetchone()
            return project, row[0] if row else None, snapshot

        for _ in range(3):
            with self.store.lock, self.store.connect() as db:
                project, raw_job, snapshot = inputs(db)
            try:
                job = json.loads(raw_job) if raw_job else None
            except (ValueError, TypeError):
                job = None
            if not isinstance(job, dict):
                job = None
            # Fingerprints and assessment may inspect thousands of files. Neither
            # may hold SQLite's writer reservation or the in-process store lock.
            scope = self._freshness(project, job, snapshot)
            freshness = scope['freshness']
            checks = job.get('checks', []) if job and freshness == 'current' else []
            if not isinstance(checks, list):
                checks = []
            checks = [item for item in checks if isinstance(item, dict)]
            counts = {state: sum(item.get('status') == state for item in checks)
                      for state in ('passed', 'failed', 'skipped', 'error')}
            counts['total'] = len(checks)
            readiness = 'not_established'
            implementation = 'not_established'
            assessment_status = 'incomplete'
            if job and freshness == 'current':
                try:
                    assessed = review.assessment({**job, 'evidence_freshness': scope})
                    value = assessed.get('readiness', {}).get('status')
                    if value in {'not_established', 'blocked', 'release_candidate'}:
                        readiness = value
                    implementation = assessed.get('implementation', {}).get('status', 'not_established')
                    assessment_status = assessed.get('status', 'incomplete')
                except (ValueError, TypeError, AttributeError, KeyError):
                    # Malformed historical data must never become healthy state.
                    freshness = 'unavailable'
                    counts = {key: 0 for key in counts}
            def money(key):
                value = job.get(key) if job else None
                return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None
            job_revision = job.get('revision', 0) if job else 0
            job_revision = job_revision if isinstance(job_revision, int) and not isinstance(job_revision, bool) and job_revision >= 0 else 0
            findings = job.get('findings', []) if job else []
            payload = {'schema_version': SCHEMA_VERSION, 'instance_id': instance_id, 'project_id': project_id,
                       'job_id': project['latest_job_id'], 'snapshot_id': project['latest_snapshot_id'],
                       'project_revision': project['revision'], 'job_revision': job_revision,
                       'phase': job.get('status') if job and job.get('status') in PHASES else 'not_started' if not job else 'unavailable',
                       **scope, 'freshness': freshness, 'checks': counts,
                       'findings_count': len(findings) if isinstance(findings, list) else 0,
                       'readiness': readiness, 'implementation': implementation,
                       'assessment': assessment_status,
                       'model_spend': money('cost'), 'model_budget': money('budget')}
            encoded = json.dumps(payload, sort_keys=True)
            with self.store.lock, self.store.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                # A job, source link, or snapshot can change while hashing. A
                # stale read must never publish its old checks as current.
                if inputs(db) != (project, raw_job, snapshot):
                    continue
                prior = db.execute('SELECT revision,payload,emitted_at FROM praxis_project_status WHERE project_id=?', (project_id,)).fetchone()
                current_revision = (prior[0] + 1) if prior and prior[1] != encoded else prior[0] if prior else 1
                timestamp = prior[2] if prior and prior[1] == encoded else now()
                if not prior or prior[1] != encoded:
                    db.execute('INSERT INTO praxis_project_status(project_id,revision,payload,emitted_at) VALUES(?,?,?,?) '
                               'ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,emitted_at=excluded.emitted_at',
                               (project_id, current_revision, encoded, timestamp))
                result = {**payload, 'revision': current_revision, 'emitted_at': timestamp}
                if previous_revision is not None and previous_revision > current_revision:
                    # A reconnecting client claiming a newer revision must not
                    # receive any assessment field that reads as current proof.
                    result.update(freshness='stale', source_freshness='unknown',
                                  readiness='not_established', implementation='not_established',
                                  assessment='incomplete', findings_count=0,
                                  checks={key: 0 for key in counts})
                return result
        raise ProjectError('Project changed while checking its status; retry the request', 409)
