"""Real SQLite pressure tests for project identity and private status projections."""
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from regen.projects import ProjectError, ProjectRegistry
from regen.scanner import fingerprint
from regen.store import Store


class ProjectTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.snapshot = self.root / 'snapshot'
        self.snapshot.mkdir()
        (self.snapshot / 'app.py').write_text('print("source")\n')
        self.store = Store(self.root / 'jobs.sqlite3')
        self.registry = ProjectRegistry(self.store)

    def tearDown(self):
        self.temp.cleanup()

    def job(self, job_id='job-1', **changes):
        record = {'id': job_id, 'source': str(self.source), 'snapshot': str(self.snapshot),
                  'name': 'Source', 'revision': 1, 'created_at': '2026-10-06T00:00:00+00:00',
                  'status': 'complete', 'findings': [], 'checks': [], 'cost': 0, 'budget': 5,
                  'collaboration': {'notes': [{'text': 'private conversation'}]},
                  **changes}
        self.store.save(record)
        return record

    def test_local_github_and_upload_remain_separate_and_opaque(self):
        local = self.registry.register(str(self.source))
        remote = self.registry.register('https://github.com/owner/source.git/')
        upload = self.registry.register('upload://' + 'a' * 32 + '/source')
        self.assertEqual(len({p['id'] for p in (local, remote, upload)}), 3)
        self.assertEqual([p['source_kind'] for p in (local, remote, upload)], ['local', 'github', 'upload'])
        self.assertEqual(remote['id'], self.registry.register('https://github.com/OWNER/SOURCE')['id'])
        self.assertEqual(local['id'], self.registry.register(str(self.source / '..' / 'source'))['id'])
        self.assertTrue(all(p['id'].startswith('prj_') and len(p['id']) == 36 for p in (local, remote, upload)))
        self.assertNotIn(str(self.root), json.dumps(self.registry.all()))
        self.assertNotIn('canonical_identity', json.dumps(local))

    def test_sources_reject_credential_urls_and_nonlocal_paths(self):
        for source in ('https://secret@github.com/owner/repo', 'https://github.com/owner/repo?token=secret',
                       'https://github.com/owner/repo/tree/main', 'https://evil.example/owner/repo',
                       'upload://../project', 'upload://' + 'a' * 32 + '/../../evil',
                       'relative/project'):
            with self.subTest(source=source), self.assertRaises(ProjectError):
                self.registry.register(source)

    def test_concurrent_registration_uses_database_uniqueness(self):
        barrier, results, errors = threading.Barrier(2), [], []
        def register():
            try:
                registry = ProjectRegistry(Store(self.store.path))
                barrier.wait(5)
                results.append(registry.register(str(self.source)))
            except Exception as exc:
                errors.append(exc)
        threads = [threading.Thread(target=register) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
        self.assertFalse(errors)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]['id'], results[1]['id'])
        self.assertEqual(len(self.registry.all()), 1)

    def test_attachment_is_additive_snapshot_bound_and_idempotent(self):
        project = self.registry.register(str(self.source))
        job = self.job()
        with self.store.connect() as db:
            original = db.execute('SELECT data FROM jobs WHERE id=?', (job['id'],)).fetchone()[0]
        linked = self.registry.attach_job(project['id'], job['id'], expected_revision=project['revision'])
        self.assertTrue(linked['latest_snapshot_id'].startswith('snp_'))
        same = self.registry.attach_job(project['id'], job['id'], expected_revision=linked['revision'])
        self.assertEqual(linked, same)
        with self.store.connect() as db:
            self.assertEqual(original, db.execute('SELECT data FROM jobs WHERE id=?', (job['id'],)).fetchone()[0])
        self.assertEqual(self.registry.snapshots(project['id'])[0]['job_id'], job['id'])
        other = self.registry.register('https://github.com/owner/other')
        with self.assertRaises(ProjectError):
            self.registry.attach_job(other['id'], job['id'], expected_revision=other['revision'])

    def test_attachment_hashing_does_not_hold_the_store_write_lock(self):
        project = self.registry.register(str(self.source))
        self.job()
        entered, release, wrote = threading.Event(), threading.Event(), threading.Event()
        outcome = []
        def delayed(path):
            entered.set()
            self.assertTrue(release.wait(5), 'Hashing fixture was not released')
            return fingerprint(path)
        def attach():
            try:
                outcome.append(self.registry.attach_job(project['id'], 'job-1', expected_revision=project['revision']))
            except Exception as exc:
                outcome.append(exc)
        def write():
            self.store.save({'id': 'unrelated', 'created_at': '2026-10-06T00:00:01+00:00'})
            wrote.set()
        with patch('regen.projects.fingerprint', side_effect=delayed):
            worker = threading.Thread(target=attach)
            writer = threading.Thread(target=write)
            worker.start()
            try:
                self.assertTrue(entered.wait(3))
                writer.start()
                self.assertTrue(wrote.wait(2), 'Snapshot hashing blocked an unrelated save')
            finally:
                release.set()
                worker.join(5)
                if writer.ident is not None:
                    writer.join(5)
        self.assertEqual(len(outcome), 1)
        self.assertIsInstance(outcome[0], dict)

    def test_status_rechecks_changed_job_after_hashing_without_blocking_writes(self):
        project = self.registry.register(str(self.source))
        self.job(checks=[{'status': 'passed'}], checks_for=str(self.snapshot))
        self.registry.attach_job(project['id'], 'job-1', expected_revision=project['revision'])
        entered, release = threading.Event(), threading.Event()
        calls, outcome = [0], []
        def delayed(path):
            calls[0] += 1
            if calls[0] == 1:
                entered.set()
                self.assertTrue(release.wait(5), 'Hashing fixture was not released')
            return fingerprint(path)
        def read_status():
            try:
                outcome.append(self.registry.status(project['id'], instance_id='test-instance'))
            except Exception as exc:
                outcome.append(exc)
        with patch('regen.projects.fingerprint', side_effect=delayed):
            worker = threading.Thread(target=read_status)
            worker.start()
            try:
                self.assertTrue(entered.wait(3))
                changed = self.store.get('job-1')
                changed['checks'] = [{'status': 'failed'}]
                self.store.save(changed)
            finally:
                release.set()
                worker.join(5)
        self.assertEqual(len(outcome), 1)
        self.assertIsInstance(outcome[0], dict)
        self.assertEqual(outcome[0]['checks']['passed'], 0)
        self.assertEqual(outcome[0]['checks']['failed'], 1)

    def test_moved_path_requires_explicit_human_relink_and_current_revision(self):
        project = self.registry.register(str(self.source))
        moved = self.root / 'moved'
        self.source.rename(moved)
        for kwargs in ({'confirmed': False}, {'confirmed': True, 'actor_kind': 'agent'}):
            with self.assertRaises(ProjectError):
                self.registry.relink(project['id'], str(moved), expected_revision=project['revision'], **kwargs)
        linked = self.registry.relink(project['id'], str(moved), expected_revision=project['revision'], confirmed=True)
        self.assertEqual(linked['id'], project['id'])
        self.assertGreater(linked['revision'], project['revision'])
        self.assertEqual(self.registry.register(str(moved))['id'], project['id'])
        with self.assertRaises(ProjectError) as stale:
            self.registry.relink(project['id'], str(moved), expected_revision=project['revision'], confirmed=True)
        self.assertEqual(stale.exception.status_code, 409)
        self.assertEqual(len(self.registry.relinks(project['id'])), 1)

    def test_relink_collision_and_wrong_source_kind_are_rejected(self):
        local = self.registry.register(str(self.source))
        occupied = self.root / 'occupied'
        occupied.mkdir()
        self.registry.register(str(occupied))
        for target in (str(occupied), 'https://github.com/owner/repo'):
            with self.assertRaises(ProjectError):
                self.registry.relink(local['id'], target, expected_revision=local['revision'], confirmed=True)

    def test_status_excludes_source_conversation_keys_and_untrusted_status_text(self):
        secret = 'sk-proj-' + 'z' * 32
        project = self.registry.register(str(self.source), name=secret)
        self.job(error=secret, events=[{'message': secret}], source_fingerprint=secret,
                 findings=[{'description': secret, 'severity': 'high'}],
                 checks=[{'name': secret, 'status': 'passed', 'kind': 'command', 'output': secret}],
                 checks_for=str(self.snapshot), team={'goal': 'private conversation'},
                 assessment={'readiness': {'status': 'release_candidate'}})
        linked = self.registry.attach_job(project['id'], 'job-1', expected_revision=project['revision'])
        status = self.registry.status(project['id'], instance_id='instance-1')
        serialized = json.dumps(status)
        for private in (secret, 'private conversation', str(self.root), 'output', 'description', 'canonical_identity'):
            self.assertNotIn(private, serialized)
        self.assertEqual(status['snapshot_id'], linked['latest_snapshot_id'])
        self.assertEqual(status['checks']['passed'], 1)
        self.assertEqual(status['readiness'], 'blocked')
        again = self.registry.status(project['id'], instance_id='instance-1')
        self.assertEqual(status['revision'], again['revision'])

    def test_status_revision_never_regresses_across_jobs_and_reconnect(self):
        project = self.registry.register(str(self.source))
        self.job(revision=100)
        linked = self.registry.attach_job(project['id'], 'job-1', expected_revision=project['revision'])
        first = self.registry.status(project['id'], instance_id='instance-1')
        self.job('job-2', revision=1)
        self.registry.attach_job(project['id'], 'job-2', expected_revision=linked['revision'])
        second = ProjectRegistry(Store(self.store.path)).status(project['id'], instance_id='instance-1')
        self.assertGreater(second['revision'], first['revision'])
        old = self.registry.status(project['id'], instance_id='instance-1', previous_revision=second['revision'] + 10)
        self.assertEqual(old['freshness'], 'stale')
        self.assertEqual(old['readiness'], 'not_established')

    def test_future_client_revision_suppresses_every_healthy_assessment_field(self):
        project = self.registry.register(str(self.source))
        self.job(checks=[{'kind': 'browser', 'status': 'passed', 'evidence_scope': 'user_journey'}],
                 findings=[{'severity': 'low'}])
        self.registry.attach_job(project['id'], 'job-1', expected_revision=project['revision'])
        with patch('regen.projects.review.assessment', return_value={
            'status': 'checked', 'readiness': {'status': 'release_candidate'},
            'implementation': {'status': 'demonstrated'},
        }):
            current = self.registry.status(project['id'], instance_id='instance-1')
            stale = self.registry.status(project['id'], instance_id='instance-1',
                                         previous_revision=current['revision'] + 1)
        self.assertEqual(current['implementation'], 'demonstrated')
        self.assertEqual(stale['freshness'], 'stale')
        self.assertEqual(stale['readiness'], 'not_established')
        self.assertEqual(stale['implementation'], 'not_established')
        self.assertEqual(stale['assessment'], 'incomplete')
        self.assertEqual(stale['checks']['passed'], 0)
        self.assertEqual(stale['findings_count'], 0)

    def test_stale_checks_missing_snapshot_and_missing_source_do_not_show_healthy(self):
        project = self.registry.register(str(self.source))
        self.job(checks=[{'kind': 'browser', 'status': 'passed', 'evidence_scope': 'user_journey'}],
                 checks_for=str(self.root / 'old-snapshot'))
        linked = self.registry.attach_job(project['id'], 'job-1', expected_revision=project['revision'])
        status = self.registry.status(project['id'], instance_id='instance-1')
        self.assertEqual(status['freshness'], 'stale')
        self.assertEqual(status['checks']['passed'], 0)
        self.assertEqual(status['readiness'], 'not_established')
        (self.snapshot / 'app.py').unlink()
        self.snapshot.rmdir()
        self.source.rmdir()
        missing = self.registry.status(project['id'], instance_id='instance-1')
        self.assertEqual(missing['freshness'], 'unavailable')
        self.assertFalse(missing['source_available'])
        self.assertEqual(missing['snapshot_id'], linked['latest_snapshot_id'])

    def test_unbound_project_status_is_explicitly_unavailable(self):
        project = self.registry.register(str(self.source))
        status = self.registry.status(project['id'], instance_id='instance-1')
        self.assertEqual(status['phase'], 'not_started')
        self.assertEqual(status['freshness'], 'unavailable')
        self.assertEqual(status['checks']['passed'], 0)

    def test_same_path_snapshot_change_suppresses_previous_passing_evidence(self):
        project = self.registry.register(str(self.source))
        self.job(checks=[{'kind': 'command', 'status': 'passed', 'name': 'pytest'}], checks_for=str(self.snapshot))
        self.registry.attach_job(project['id'], 'job-1', expected_revision=project['revision'])
        self.assertEqual(self.registry.status(project['id'], instance_id='instance-1')['checks']['passed'], 1)
        (self.snapshot / 'app.py').write_text('raise RuntimeError("changed source")\n')
        changed = self.registry.status(project['id'], instance_id='instance-1')
        self.assertEqual(changed['freshness'], 'stale')
        self.assertEqual(changed['checks']['passed'], 0)
        self.assertEqual(changed['readiness'], 'not_established')

    def test_malformed_historical_job_becomes_unavailable_without_exposing_data(self):
        project = self.registry.register(str(self.source))
        self.job()
        self.registry.attach_job(project['id'], 'job-1', expected_revision=project['revision'])
        job = self.store.get('job-1')
        job['findings'] = ['private source accidentally saved in the wrong shape']
        self.store.save(job)
        unavailable = self.registry.status(project['id'], instance_id='instance-1')
        self.assertEqual(unavailable['freshness'], 'unavailable')
        self.assertNotIn('private source', json.dumps(unavailable))
        self.assertEqual(unavailable['readiness'], 'not_established')


if __name__ == '__main__':
    unittest.main()
