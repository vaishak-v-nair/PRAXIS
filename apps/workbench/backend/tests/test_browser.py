import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from regen.browser import review_project, select_files
from regen.scanner import MAX_FILE_BYTES, MAX_TOTAL_BYTES, scan_project
import threading


class BrowserInspectionTests(unittest.TestCase):
    def test_selection_uses_existing_privacy_limits_before_reading(self):
        names = ['src/app.py', '.env', 'node_modules/vendor.js', '.praxis/memory.md',
                 '.agents/skills.md', 'large.bin', '.env.example']
        selected = select_files([{'path': 'project/' + name, 'size': MAX_FILE_BYTES + 1 if name == 'large.bin' else 30} for name in names])
        self.assertEqual([item['path'] for item in selected['accepted']], ['src/app.py', '.env.example'])
        self.assertEqual(selected['skipped_files'], 5)

    def test_praxis_private_vault(self):
        metadata = [{'path': 'PRAXIS/assets/master.txt', 'size': 5}, {'path': 'PRAXIS/src/cli.js', 'size': 5}]
        self.assertEqual(len(select_files(metadata, praxis_checkout=True)['accepted']), 1)
        self.assertEqual(len(select_files(metadata, praxis_checkout=False)['accepted']), 2)

    def test_invalid_paths_and_duplicate_names_are_rejected(self):
        for paths in [['../bad.py'], ['/bad.py'], ['p/a.py', 'q/a.py'], ['p/a.py', 'p/a.py'], ['C:\\secret.py']]:
            with self.subTest(paths=paths), self.assertRaises(ValueError):
                select_files([{'path': name, 'size': 1} for name in paths])

    def test_larger_selection_does_not_silently_truncate(self):
        with self.assertRaisesRegex(ValueError, '100 MiB'):
            select_files([{'path': f'p/{i}.txt', 'size': MAX_FILE_BYTES} for i in range(MAX_TOTAL_BYTES // MAX_FILE_BYTES + 1)])

    def test_real_scanner_catches_syntax_and_false_success_without_execution(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'broken.py').write_text('def broken(:\n    pass\n', encoding='utf-8')
            (root / 'app.py').write_text('def create_order():\n    return {"success": True}\n', encoding='utf-8')
            (root / 'must_not_execute.py').write_text('raise RuntimeError("submitted code was executed")\n', encoding='utf-8')
            selection = select_files([{'path': 'p/' + file.name, 'size': file.stat().st_size} for file in root.iterdir()])
            with patch('regen.scanner._process', side_effect=AssertionError('process forbidden')), patch('regen.scanner._osv', side_effect=AssertionError('network forbidden')):
                result = review_project(root, selection)
            self.assertIn('Python source cannot be parsed', [item['title'] for item in result['findings']])
            stub = next(item for item in result['findings'] if 'constant success' in item['title'])
            self.assertEqual(stub['confidence'], 'suggestion')
            self.assertEqual(result['runtime_status'], 'not_run')
            self.assertEqual(result['readiness'], 'not_established')
            self.assertEqual(len(result['snapshot']), 64)

    def test_clean_source_is_not_claimed_production_ready(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'sum.py').write_text('def total(a, b):\n    return a + b\n', encoding='utf-8')
            result = review_project(root, select_files([{'path': 'p/sum.py', 'size': 35}]))
            self.assertEqual(result['findings'], [])
            self.assertEqual(result['readiness'], 'not_established')

    def test_binary_only_selection_is_not_a_clean_result(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'data.bin').write_bytes(b'\x00\x01')
            with self.assertRaisesRegex(ValueError, 'No UTF-8'):
                review_project(root, select_files([{'path': 'p/data.bin', 'size': 2}]))

    def test_credential_values_are_not_in_findings_or_goal(self):
        secret = 'sk-' + 'b' * 25
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'app.py').write_text('API_KEY = "' + secret + '"\n', encoding='utf-8')
            result = review_project(root, select_files([{'path': 'p/app.py', 'size': 39}]), secret)
            self.assertNotIn(secret, json.dumps(result))
            self.assertEqual(result['goal'], '[REDACTED]')

    def test_malformed_manifest_is_a_coverage_gap(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'package.json').write_text('{"scripts":[]}', encoding='utf-8')
            result = review_project(root, select_files([{'path': 'p/package.json', 'size': 14}]))
            self.assertEqual(result['commands'], [])
            self.assertTrue(any(item['name'] == 'Command discovery' and item['status'] == 'limited' for item in result['coverage']))

    def test_default_local_scanner_keeps_advisory_and_tool_flow(self):
        with tempfile.TemporaryDirectory() as temp, patch('regen.scanner.shutil.which', return_value=None), patch('regen.scanner._osv', return_value=([], {'name': 'OSV dependencies', 'status': 'passed', 'detail': 'test response'})) as osv:
            (Path(temp) / 'app.py').write_text('x = 1\n', encoding='utf-8')
            result = scan_project(Path(temp), lambda _: None, threading.Event())
            osv.assert_called_once()
            self.assertEqual(next(item for item in result['coverage'] if item['name'] == 'OSV dependencies')['status'], 'passed')
