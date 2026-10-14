"""The project home must not promote old or unbound evidence to success."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from regen.projects import ProjectRegistry
from regen.scanner import fingerprint
from regen.store import Store
from regen.workspace import page


class WorkspaceProjectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = Store(self.root / 'jobs.sqlite3')

    def test_unreviewed_project_is_not_a_verified_result(self):
        source = self.root / 'project'
        source.mkdir()
        registered = ProjectRegistry(self.store).register(str(source))
        result = page(self.store, instance_id='test')
        self.assertEqual(result.total, 1)
        item = result.items[0]
        self.assertEqual(item.id, registered['id'])
        self.assertIsNone(item.latest_job_id)
        self.assertEqual(item.phase, 'not_started')
        self.assertEqual(item.readiness, 'not_established')
        self.assertEqual(item.implementation, 'not_established')
        self.assertEqual(item.checks_passed, 0)
        self.assertNotIn(str(self.root), result.model_dump_json())

    def test_new_run_is_visible_without_borrowing_an_older_snapshot(self):
        source = self.root / 'project'
        source.mkdir()
        (source / 'app.py').write_text('def value(): return 1\n')
        registered = ProjectRegistry(self.store).register(str(source))
        snapshot = self.root / 'review-copy'
        snapshot.mkdir()
        (snapshot / 'app.py').write_text('def value(): return 1\n')
        self.store.save({'id': 'old-job', 'project_id': registered['id'], 'created_at': '2026-10-09T12:00:00Z',
                         'status': 'complete', 'source': str(source), 'snapshot': str(snapshot),
                         'source_fingerprint': fingerprint(source), 'checks': [{'status': 'passed'}],
                         'findings': [], 'coverage': []})
        ProjectRegistry(self.store).attach_job(registered['id'], 'old-job', expected_revision=registered['revision'])
        self.store.save({'id': 'running-job', 'project_id': registered['id'],
                         'created_at': '2026-10-10T12:00:00Z', 'status': 'scanning',
                         'source': str(source), 'checks': [{'status': 'passed'}]})
        result = page(self.store, instance_id='test')
        self.assertEqual(result.total, 1)
        item = result.items[0]
        self.assertEqual(item.latest_job_id, 'old-job')
        self.assertEqual(item.open_job_id, 'running-job')
        self.assertEqual(item.phase, 'scanning')
        self.assertEqual(item.freshness, 'unavailable')
        self.assertEqual(item.readiness, 'not_established')
        self.assertEqual(item.checks_passed, 0)

    def test_quick_home_lists_projects_without_hashing_or_claiming_current_evidence(self):
        source = self.root / 'project'
        source.mkdir()
        (source / 'app.py').write_text('print(1)')
        registered = ProjectRegistry(self.store).register(str(source))
        snapshot = self.root / 'review-copy'
        snapshot.mkdir()
        (snapshot / 'app.py').write_text('print(1)')
        self.store.save({'id': 'job-1', 'project_id': registered['id'],
                         'created_at': '2026-10-10T12:00:00Z', 'status': 'complete',
                         'source': str(source), 'snapshot': str(snapshot),
                         'checks': [{'status': 'passed'}]})
        ProjectRegistry(self.store).attach_job(registered['id'], 'job-1', expected_revision=registered['revision'])
        with patch.object(ProjectRegistry, 'status', side_effect=AssertionError('Home must not hash source')):
            result = page(self.store, instance_id='test', quick=True)
        item = result.items[0]
        self.assertEqual(item.phase, 'complete')
        self.assertEqual(item.freshness, 'checking')
        self.assertEqual(item.readiness, 'not_established')
        self.assertEqual(item.checks_passed, 0)
        self.assertGreater(item.project_revision, registered['revision'])

    def test_legacy_history_is_reachable_but_has_no_inferred_assessment(self):
        self.store.save({'id': 'old-review', 'created_at': '2026-09-01T00:00:00Z',
                         'name': 'sk-private-project', 'source': str(self.root),
                         'status': 'complete', 'checks': [{'status': 'passed'}],
                         'receipt': {'signature': 'historical'}})
        with self.store.lock, self.store.connect() as db:
            db.execute('INSERT INTO jobs(id,data) VALUES(?,?)', ('damaged-review', '{'))
        result = page(self.store, instance_id='test', limit=1)
        self.assertEqual(result.total, 2)
        self.assertEqual(result.next_offset, 1)
        combined = [*result.items, *page(self.store, instance_id='test', offset=1, limit=1).items]
        self.assertEqual({item.id for item in combined}, {'old-review', 'damaged-review'})
        self.assertTrue(all(item.kind == 'legacy_review' for item in combined))
        self.assertEqual(next(item for item in combined if item.id == 'damaged-review').phase, 'unavailable')
        serialized = json.dumps([item.model_dump() for item in combined])
        self.assertNotIn(str(self.root), serialized)
        self.assertNotIn('sk-private-project', serialized)
        self.assertNotIn('historical', serialized)

    def test_project_scope_pages_projects_without_consuming_legacy_history(self):
        registry = ProjectRegistry(self.store)
        for index in range(31):
            source = self.root / f'project-{index:02d}'
            source.mkdir()
            registry.register(str(source))
            self.store.save({'id': f'legacy-{index:02d}', 'created_at': '2026-10-10T12:00:00Z',
                             'status': 'complete', 'source': str(source),
                             'checks': [{'status': 'passed'}]})
        with patch.object(ProjectRegistry, 'status', side_effect=AssertionError('Quick page hashed source')):
            first = page(self.store, instance_id='test', quick=True, scope='projects', limit=30)
            second = page(self.store, instance_id='test', quick=True, scope='projects', offset=30, limit=30)
            mixed = page(self.store, instance_id='test', quick=True, limit=30)
        self.assertEqual((first.total, first.next_offset, len(first.items)), (31, 30, 30))
        self.assertEqual((second.total, second.next_offset, len(second.items)), (31, None, 1))
        self.assertTrue(all(item.kind == 'project' and item.readiness == 'not_established'
                            for item in [*first.items, *second.items]))
        self.assertEqual(len({item.id for item in [*first.items, *second.items]}), 31)
        self.assertEqual(mixed.total, 62)
        mixed_later = page(self.store, instance_id='test', quick=True, offset=31, limit=30)
        self.assertTrue(all(item.kind == 'legacy_review' for item in mixed_later.items))
        self.assertNotIn(str(self.root), first.model_dump_json() + second.model_dump_json())

    def test_invalid_page_parameters_are_rejected(self):
        for offset, limit in ((-1, 30), (0, 0), (0, 101), (True, 30)):
            with self.assertRaises(ValueError):
                page(self.store, instance_id='test', offset=offset, limit=limit)
        with self.assertRaises(ValueError):
            page(self.store, instance_id='test', scope='reviews')


if __name__ == '__main__':
    unittest.main()
