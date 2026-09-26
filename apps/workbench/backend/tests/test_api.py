"""Offline API integration: real snapshots/static inspection, simulated model calls."""
import difflib
import base64
import importlib
import io
import json
import shutil
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from regen import provider, scanner
from regen.store import Store

api = importlib.import_module('regen.app')


class ApiIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'submitted'
        self.source.mkdir()
        self.original = 'DEBUG = True\nprint("working feature")\n'
        (self.source / 'app.py').write_text(self.original, encoding='utf-8')
        self.secret = 'sk-proj-' + 'x' * 32
        self.env_content = 'OPENAI_API_KEY=' + self.secret
        (self.source / '.env').write_text(self.env_content)
        self.data = self.root / 'jobs'
        self.patchers = [
            patch.object(api, 'DATA', self.data),
            patch.object(api, 'store', Store(self.data / 'jobs.sqlite3')),
            patch.object(api, 'workers', {}),
            patch.object(api, 'cancellations', {}),
            patch.object(provider, 'analyze', side_effect=self.analyze),
            patch.object(provider, 'fix_project', side_effect=self.make_fix),
            patch.object(scanner.shutil, 'which', return_value=None),
            patch.object(scanner, '_osv', return_value=([], {'name': 'Dependencies', 'status': 'skipped', 'detail': 'Offline test'})),
        ]
        for patcher in self.patchers:
            patcher.start()
        self.client = TestClient(api.app)
        self.client.__enter__()
        self.fix_number = 0

    def tearDown(self):
        for event in api.cancellations.values():
            event.set()
        for worker in api.workers.values():
            worker.join(10)
        self.client.__exit__(None, None, None)
        for patcher in reversed(self.patchers):
            patcher.stop()
        self.temp.cleanup()

    def analyze(self, path, scan, emit, cancelled, budget):
        self.assertFalse((path / '.env').exists())
        budget.reserve(.25)
        budget.settle(.25, .125)
        emit({'message': 'Contextual review completed.'})
        return scan

    def make_fix(self, path, findings, emit, cancelled, budget):
        self.fix_number += 1
        target = path.parent / f'fixed-{self.fix_number}'
        shutil.copytree(path, target)
        before = (path / 'app.py').read_text()
        after = before.replace('DEBUG = True', 'DEBUG = False')
        (target / 'app.py').write_text(after)
        diff = ''.join(difflib.unified_diff(before.splitlines(True), after.splitlines(True), fromfile='a/app.py', tofile='b/app.py'))
        return {'path': str(target), 'diff': diff, 'changes': ['app.py'], 'review': {'approved': True, 'summary': 'Reviewed; runtime checks still required.'}, 'cost': budget.spent, 'agents': [{'name': 'Fixture repair', 'status': 'complete'}]}

    def finish(self, job_id):
        api.workers[job_id].join(10)
        self.assertFalse(api.workers[job_id].is_alive(), 'Background work did not finish')
        response = self.client.get('/api/jobs/' + job_id)
        self.assertEqual(response.status_code, 200)
        return response.json()

    def scan(self):
        response = self.client.post('/api/scans', json={'source': str(self.source), 'budget': 5})
        self.assertEqual(response.status_code, 200, response.text)
        return self.finish(response.json()['id'])

    def fix(self, job):
        finding = next(item for item in job['findings'] if item['title'] == 'Debug mode is explicitly enabled')
        response = self.client.post(f"/api/jobs/{job['id']}/fix", json={'finding_ids': [finding['id']]})
        self.assertEqual(response.status_code, 200, response.text)
        return self.finish(job['id'])

    def test_scan_persists_readable_findings_without_source_changes_or_credentials(self):
        job = self.scan()
        self.assertEqual(job['status'], 'complete')
        self.assertEqual(job['languages'], ['Python'])
        self.assertTrue(any(item['location']['file'] == '.env' for item in job['findings']))
        self.assertEqual((self.source / 'app.py').read_text(), self.original)
        self.assertEqual((self.source / '.env').read_text(), self.env_content)
        self.assertNotIn(self.secret, json.dumps(job))
        self.assertNotIn('snapshot', job)
        self.assertNotIn('source_fingerprint', job)
        self.assertGreater(job['cost'], 0)
        self.assertTrue(job['events'])
        stored = api.store.get(job['id'])
        self.assertNotIn(self.secret, json.dumps(stored))
        self.assertEqual(Store(self.data / 'jobs.sqlite3').get(job['id'])['status'], 'complete')
        self.assertEqual(self.client.get('/api/jobs').json()[0]['id'], job['id'])

    def upload(self, files):
        return self.client.post('/api/uploads', json={'files': [
            {'path': path, 'content': base64.b64encode(content).decode('ascii')}
            for path, content in files]})

    def test_folder_upload_is_inert_then_scans_and_exports_without_source_apply(self):
        with patch.object(provider, 'analyze', side_effect=self.analyze) as model:
            response = self.upload([('MyProject/app.py', self.original.encode()),
                                    ('MyProject/.ENV', self.env_content.encode()),
                                    ('MyProject/node_modules/dependency.js', b'ignored')])
            self.assertEqual(response.status_code, 200, response.text)
            model.assert_not_called()
            uploaded = response.json()
            self.assertEqual(uploaded['accepted_files'], 1)
            self.assertEqual(uploaded['skipped_files'], 2)
            self.assertNotIn(self.secret, json.dumps(uploaded))
            response = self.client.post('/api/scans', json={'source': uploaded['source'], 'budget': 5})
            self.assertEqual(response.status_code, 200, response.text)
            job = self.fix(self.finish(response.json()['id']))
            self.assertEqual(job['name'], 'MyProject')
            self.assertTrue(job['source'].startswith('upload://'))
            self.assertIn('+DEBUG = False', self.client.get(f"/api/jobs/{job['id']}/export?format=patch").text)
            self.assertEqual(self.client.post(f"/api/jobs/{job['id']}/apply", json={'confirm': True}).status_code, 422)

    def test_upload_rejects_traversal_windows_aliases_duplicates_and_invalid_encoding(self):
        paths = ['Root/../escape.py', '/absolute.py', 'Root/C:/escape.py',
                 'Root/a\\escape.py', 'Root/CON.py', 'Root/a.py.', 'Root//a.py']
        for path in paths:
            with self.subTest(path=path):
                self.assertEqual(self.upload([(path, b'code')]).status_code, 422)
        self.assertEqual(self.upload([('Root/app.py', b'a'), ('Root/APP.py', b'b')]).status_code, 422)
        self.assertEqual(self.upload([('Root/app.py', b'a'), ('Other/b.py', b'b')]).status_code, 422)
        self.assertEqual(self.upload([('Root/a', b'a'), ('Root/a/b.py', b'b')]).status_code, 422)
        response = self.client.post('/api/uploads', json={'files': [{'path': 'Root/app.py', 'content': 'not base64!'}]})
        self.assertEqual(response.status_code, 422)
        self.assertFalse((self.data / 'uploads').exists(), 'invalid uploads leave no partial folders')

    def test_upload_limits_and_unregistered_source_do_not_start_model_work(self):
        with patch.object(provider, 'analyze') as model:
            with patch.object(api, 'MAX_UPLOAD_BODY', 128, create=True):
                self.assertEqual(self.upload([('Root/app.py', b'x' * 256)]).status_code, 413)
            response = self.client.post('/api/scans', json={'source': 'upload://unknown/Root'})
            self.assertEqual(response.status_code, 422)
            model.assert_not_called()

    def test_fix_exports_and_stale_safe_apply_preserve_dotenv(self):
        job = self.fix(self.scan())
        self.assertEqual(job['status'], 'complete')
        self.assertNotIn('path', job['fix'])
        self.assertEqual((self.source / 'app.py').read_text(), self.original)
        patch_response = self.client.get(f"/api/jobs/{job['id']}/export?format=patch")
        self.assertEqual(patch_response.status_code, 200)
        self.assertIn('+DEBUG = False', patch_response.text)
        archive_response = self.client.get(f"/api/jobs/{job['id']}/export?format=zip")
        with zipfile.ZipFile(io.BytesIO(archive_response.content)) as archive:
            self.assertNotIn('.env', archive.namelist())
            self.assertIn(b'DEBUG = False', archive.read('app.py'))
        endpoint = f"/api/jobs/{job['id']}/apply"
        self.assertEqual(self.client.post(endpoint, json={}).status_code, 403)
        (self.source / '.env').write_text(self.env_content + '\nUPDATED=1')
        self.assertEqual(self.client.post(endpoint, json={'confirm': True}).status_code, 409)
        self.assertEqual((self.source / 'app.py').read_text(), self.original)
        (self.source / '.env').write_text(self.env_content)
        response = self.client.post(endpoint, json={'confirm': True})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['files_changed'], 1)
        self.assertIn('DEBUG = False', (self.source / 'app.py').read_text())
        self.assertEqual((self.source / '.env').read_text(), self.env_content)
        backup = self.data / job['id'] / 'apply-backup' / 'app.py'
        self.assertEqual(backup.read_text(), self.original)

    def test_verification_needs_trust_and_runs_only_in_copy(self):
        job = self.fix(self.scan())
        endpoint = f"/api/jobs/{job['id']}/verify"
        with patch.object(scanner, 'run_checks', return_value=[{'name': 'build', 'status': 'passed'}]) as checks:
            self.assertEqual(self.client.post(endpoint, json={}).status_code, 403)
            checks.assert_not_called()
            response = self.client.post(endpoint, json={'trust_confirmed': True, 'start_command': 'python server.py'})
            self.assertEqual(response.status_code, 200, response.text)
            done = self.finish(job['id'])
            self.assertEqual(done['checks'][0]['status'], 'passed')
            self.assertNotEqual(checks.call_args.args[0], self.source)
            self.assertEqual(checks.call_args.kwargs['start_command'], ['python', 'server.py'])
        selected = next(f for f in job['findings'] if f['fixable'])['id']
        response = self.client.post(f"/api/jobs/{job['id']}/fix", json={'finding_ids': [selected], 'run_checks': True})
        self.assertEqual(response.status_code, 403)

    def test_export_preserves_pdf_data_and_redacts_env_templates(self):
        pdf = b'%PDF-1.7\n\xff\x00API_KEY=not-a-text-document\n%%EOF'
        (self.source / 'knowledge.pdf').write_bytes(pdf)
        (self.source / 'invalid.pdf').write_bytes(b'not a pdf\xff')
        (self.source / '.env.example').write_text('GROQ_API_KEY=' + self.secret)
        job = self.fix(self.scan())
        response = self.client.get(f"/api/jobs/{job['id']}/export?format=zip")
        self.assertEqual(response.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertEqual(archive.read('knowledge.pdf'), pdf)
            self.assertNotIn('invalid.pdf', archive.namelist())
            self.assertNotIn('.env', archive.namelist())
            self.assertIn('.env.example', archive.namelist())
            self.assertNotIn(self.secret.encode(), archive.read('.env.example'))

    def test_new_nested_file_exports_and_applies_without_touching_credentials(self):
        job = self.scan()
        def with_regression(*args):
            result = self.make_fix(*args)
            tests = Path(result['path']) / 'tests'
            tests.mkdir()
            (tests / 'test_debug.py').write_text('assert True\n', newline='')
            result['changes'].append('tests/test_debug.py')
            return result
        with patch.object(provider, 'fix_project', side_effect=with_regression):
            job = self.fix(job)
        response = self.client.get(f"/api/jobs/{job['id']}/export?format=zip")
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertEqual(archive.read('tests/test_debug.py'), b'assert True\n')
        response = self.client.post(f"/api/jobs/{job['id']}/apply", json={'confirm': True})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['files_changed'], 2)
        self.assertEqual((self.source / 'tests/test_debug.py').read_text(), 'assert True\n')
        self.assertEqual((self.source / '.env').read_text(), self.env_content)

    def test_json_origin_and_host_guards(self):
        self.assertEqual(self.client.post('/api/scans', data={'source': str(self.source)}).status_code, 415)
        self.assertEqual(self.client.post('/api/scans', json={'source': str(self.source)}, headers={'origin': 'https://attacker.example'}).status_code, 403)
        self.assertEqual(self.client.get('/api/jobs', headers={'host': 'attacker.example'}).status_code, 403)
        response = self.client.post('/api/scans', json={'source': str(self.source)}, headers={'origin': 'http://localhost:3000'})
        self.assertEqual(response.status_code, 200)
        self.finish(response.json()['id'])

    def test_budget_pause_resume_keeps_scan_and_total_cost(self):
        calls = []
        def expensive_review(path, scan, emit, cancelled, budget):
            calls.append(budget.limit)
            budget.reserve(6)
            budget.settle(6, .5)
            return scan
        with patch.object(provider, 'analyze', side_effect=expensive_review):
            job = self.scan()
            self.assertEqual(job['status'], 'paused')
            self.assertTrue(job['findings'])
            response = self.client.post(f"/api/jobs/{job['id']}/budget", json={'amount': 2})
            self.assertEqual(response.status_code, 200, response.text)
            done = self.finish(job['id'])
        self.assertEqual(calls, [5, 7])
        self.assertEqual(done['status'], 'complete')
        self.assertEqual(done['budget'], 7)
        self.assertEqual(done['cost'], .5)
        self.assertEqual((self.source / 'app.py').read_text(), self.original)

    def test_partial_fix_can_export_while_paused_then_retry(self):
        job = self.scan()
        def partial(path, findings, emit, cancelled, budget):
            result = self.make_fix(path, findings, emit, cancelled, budget)
            result['paused'] = True
            return result
        with patch.object(provider, 'fix_project', side_effect=partial):
            paused = self.fix(job)
        self.assertEqual(paused['status'], 'paused')
        self.assertEqual(self.client.get(f"/api/jobs/{job['id']}/export").status_code, 200)
        self.assertEqual((self.source / 'app.py').read_text(), self.original)
        response = self.client.post(f"/api/jobs/{job['id']}/budget", json={'amount': 1})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.finish(job['id'])['status'], 'complete')

    def test_nonfixable_and_unknown_findings_are_rejected(self):
        job = self.scan()
        endpoint = f"/api/jobs/{job['id']}/fix"
        manual = next(f for f in job['findings'] if not f['fixable'])
        self.assertEqual(self.client.post(endpoint, json={'finding_ids': [manual['id']]}).status_code, 422)
        self.assertEqual(self.client.post(endpoint, json={'finding_ids': ['missing']}).status_code, 422)

    def test_large_patch_is_not_truncated_and_errors_keep_partial_changes(self):
        job = self.scan()
        ending = '+final reviewed line\n'
        def failed_fix(path, findings, emit, cancelled, budget):
            result = self.make_fix(path, findings, emit, cancelled, budget)
            result['diff'] += '+safe source line\n' * 2000 + ending
            result['error'] = 'Independent review unavailable'
            return result
        with patch.object(provider, 'fix_project', side_effect=failed_fix):
            failed = self.fix(job)
        self.assertEqual(failed['status'], 'error')
        response = self.client.get(f"/api/jobs/{job['id']}/export")
        self.assertEqual(response.status_code, 200)
        self.assertGreater(len(response.text), 24000)
        self.assertTrue(response.text.endswith(ending))

    def test_cancel_signals_background_work_without_touching_source(self):
        entered = threading.Event()
        def blocking_review(path, scan, emit, cancelled, budget):
            entered.set()
            self.assertTrue(cancelled.wait(5), 'Cancellation signal was not delivered')
            return scan
        with patch.object(provider, 'analyze', side_effect=blocking_review):
            response = self.client.post('/api/scans', json={'source': str(self.source)})
            self.assertEqual(response.status_code, 200)
            job_id = response.json()['id']
            self.assertTrue(entered.wait(5))
            self.assertEqual(self.client.post(f'/api/jobs/{job_id}/cancel', json={}).status_code, 200)
            self.assertEqual(self.finish(job_id)['status'], 'cancelled')
        self.assertEqual((self.source / 'app.py').read_text(), self.original)

    def test_apply_failure_restores_original_contents(self):
        job = self.fix(self.scan())
        target = self.source / 'app.py'
        original_write = Path.write_bytes
        failed = []
        def fail_once(path, data):
            if path == target and not failed:
                failed.append(True)
                raise OSError('Simulated write failure')
            return original_write(path, data)
        with patch.object(Path, 'write_bytes', new=fail_once):
            response = self.client.post(f"/api/jobs/{job['id']}/apply", json={'confirm': True})
        self.assertEqual(response.status_code, 500)
        self.assertEqual(target.read_text(), self.original)
        self.assertEqual((self.source / '.env').read_text(), self.env_content)


if __name__ == '__main__':
    unittest.main()
