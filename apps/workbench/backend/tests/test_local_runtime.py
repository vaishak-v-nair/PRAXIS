"""Real, trusted stdlib fixtures: no Docker, models, installs from a registry or source apply."""
import importlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from regen import provider, sandbox, scanner
from regen.store import Store

api = importlib.import_module('regen.app')

TEST = '''import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from app import save_order

class Checkout(unittest.TestCase):
    def test_success_requires_persisted_order(self):
        self.assertIsNone(os.getenv("PRAXIS_RUNTIME_TEST_API_KEY"))
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "orders.sqlite3"
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("CREATE TABLE orders (sku TEXT NOT NULL)")
                connection.commit()
            self.assertEqual(save_order(database), {"success": True})
            with closing(sqlite3.connect(database)) as connection:
                count = connection.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
            self.assertEqual(count, 1, "Success requires a real stored order")
'''
CORRECT = '''import sqlite3
from contextlib import closing

def save_order(database):
    with closing(sqlite3.connect(database)) as connection:
        connection.execute("INSERT INTO orders (sku) VALUES (?)", ("book",))
        connection.commit()
    return {"success": True}
'''
FALSE_SUCCESS = '''def save_order(database):
    return {"success": True}
'''


class LocalRuntimeIntegrationTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(__file__).resolve().parents[2] / '.regen' / 'artifacts'
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='local-runtime-test-', dir=scratch)
        self.root = Path(self.temp.name).resolve()
        self.assertTrue(self.root.is_relative_to(scratch.resolve()))
        self.source = self.root / 'submitted'
        (self.source / 'tests').mkdir(parents=True)
        (self.source / 'requirements.txt').write_text('', encoding='utf-8')
        (self.source / 'tests/test_checkout.py').write_text(TEST, encoding='utf-8')
        (self.source / '.env').write_text('PRAXIS_RUNTIME_TEST_API_KEY=fixture-private-value', encoding='utf-8')
        self.data = self.root / 'jobs'
        self.patchers = [
            patch.object(api, 'DATA', self.data),
            patch.object(api, 'store', Store(self.data / 'jobs.sqlite3')),
            patch.object(api, 'workers', {}),
            patch.object(api, 'cancellations', {}),
            patch.object(provider, 'provider_key', return_value=None),
            patch.object(provider, 'stored_keys', return_value={}),
            patch.object(provider, 'Model', side_effect=AssertionError('No model call is authorized')),
            patch.object(sandbox, 'run_checks', side_effect=AssertionError('Docker was not selected')),
            patch.object(sandbox, 'health', return_value={'ready': False, 'engine': False,
                         'local_context': False, 'images': {}, 'detail': 'Docker is not installed.'}),
            patch.object(scanner.shutil, 'which', return_value=None),
            patch.object(scanner, '_osv', return_value=([], {'name': 'OSV dependencies',
                         'status': 'skipped', 'detail': 'External advisories disabled for this offline regression'})),
            patch.dict(os.environ, {'PRAXIS_RUNTIME_TEST_API_KEY': 'fixture-private-value'}),
        ]
        for patcher in self.patchers:
            patcher.start()
        self.client = TestClient(api.app)
        self.client.__enter__()

    def tearDown(self):
        for event in api.cancellations.values():
            event.set()
        for worker in api.workers.values():
            worker.join(30)
        self.client.__exit__(None, None, None)
        for patcher in reversed(self.patchers):
            patcher.stop()
        self.temp.cleanup()

    def check_fixture(self, source):
        (self.source / 'app.py').write_text(source, encoding='utf-8')
        fingerprint = scanner.fingerprint(self.source)
        health = self.client.get('/api/health').json()
        self.assertFalse(health['docker']['ready'])
        self.assertFalse(any(item['configured'] for item in health['providers']))
        response = self.client.post('/api/scans', json={
            'source': str(self.source), 'review_goal': 'Saving an order must persist it in SQLite.',
            'ai_review': False, 'run_checks': True, 'runtime_mode': 'host', 'trust_confirmed': True})
        self.assertEqual(response.status_code, 200, response.text)
        job_id = response.json()['id']
        api.workers[job_id].join(60)
        self.assertFalse(api.workers[job_id].is_alive(), 'Local fixture exceeded its bounded test wait')
        job = self.client.get('/api/jobs/' + job_id).json()
        self.assertEqual(job['status'], 'complete', job.get('error'))
        self.assertEqual(job['cost'], 0)
        self.assertEqual(len(job['checks']), 3, job['checks'])
        self.assertEqual([check['status'] for check in job['checks'][:2]], ['passed', 'passed'], job['checks'])
        self.assertTrue(all(check['runtime'] == 'host' and check['network'] == 'host' for check in job['checks']))
        self.assertEqual(scanner.fingerprint(self.source), fingerprint)
        self.assertEqual((self.source / 'app.py').read_text(encoding='utf-8'), source)
        self.assertFalse((self.source / '.regen-runtime').exists())
        stored = api.store.get(job_id)
        self.assertEqual(stored['source_fingerprint'], fingerprint)
        self.assertNotEqual(Path(stored['snapshot']), self.source)
        self.assertFalse((Path(stored['snapshot']) / '.env').exists())
        self.assertNotIn('fixture-private-value', json.dumps(job))
        self.assertIn('Ran 1 test', job['checks'][-1]['output'])
        return job

    def test_correct_local_checkout_executes_and_preserves_original_source(self):
        job = self.check_fixture(CORRECT)
        self.assertEqual(job['checks'][-1]['status'], 'passed', job['checks'][-1]['output'])
        self.assertIn('OK', job['checks'][-1]['output'])
        self.assertFalse(any(finding['title'] == 'Write-named function returns constant success'
                             for finding in job['findings']))
        self.assertEqual(job['assessment']['implementation']['status'], 'runtime_observed')
        self.assertNotEqual(job['assessment']['readiness']['status'], 'release_candidate')

    def test_false_success_fails_actual_database_side_effect_check(self):
        job = self.check_fixture(FALSE_SUCCESS)
        self.assertEqual(job['checks'][-1]['status'], 'failed', job['checks'][-1]['output'])
        self.assertIn('Success requires a real stored order', job['checks'][-1]['output'])
        self.assertTrue(any(finding['title'] == 'Write-named function returns constant success'
                            for finding in job['findings']))
        self.assertEqual(job['assessment']['implementation']['status'], 'contradicted')
        self.assertEqual(job['assessment']['readiness']['status'], 'blocked')


if __name__ == '__main__':
    unittest.main()
