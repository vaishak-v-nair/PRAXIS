"""Real Windows batch/npm launches; no registry dependencies or model calls."""
import json
import os
import shutil
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from regen.scanner import _process, discover_commands, run_checks


@unittest.skipUnless(os.name == 'nt', 'Windows batch launch regression')
class WindowsRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='praxis runtime spaces ')
        self.root = Path(self.temp.name)
        self.cancelled = threading.Event()

    def tearDown(self):
        self.temp.cleanup()

    def test_batch_path_and_argument_spaces_are_preserved_once(self):
        launcher = self.root / 'capture launcher.cmd'
        launcher.write_text('@echo off\nsetlocal disabledelayedexpansion\n'
                            'echo [%~1]\necho [%~2]\necho [%~3]\necho [%~4]\nexit /b 7\n')
        result = _process([str(launcher), 'project path with spaces', '()!literal!', '', 'C:\\path with spaces\\'],
                          self.root, self.cancelled, 20)
        self.assertEqual(result['status'], 'failed', result)
        self.assertEqual(result['exit_code'], 7)
        self.assertEqual(result['output'].splitlines(),
                         ['[project path with spaces]', '[()!literal!]', '[]', '[C:\\path with spaces\\]'])

    def test_batch_input_and_resolved_launcher_cannot_add_shell_commands(self):
        launcher = self.root / 'safe.cmd'
        launcher.write_text('@echo off\necho EXECUTED\nexit /b 0\n')
        for argument in ('one&two', 'one|two', '>output.txt', '<input.txt', '^escape',
                         '%PATH%', 'quote"break', 'line\nbreak', 'line\rbreak', 'nul\x00break'):
            with self.subTest(argument=argument):
                result = _process([str(launcher), argument], self.root, self.cancelled, 20)
                self.assertEqual(result['status'], 'skipped', result)
                self.assertIsNone(result['exit_code'])
                self.assertIn('Unsafe shell characters', result['output'])
                self.assertNotIn('EXECUTED', result['output'])
        unsafe = self.root / 'unsafe&launcher.cmd'
        unsafe.write_text(launcher.read_text())
        with patch('regen.scanner.shutil.which', return_value=str(unsafe)):
            result = _process(['alias'], self.root, self.cancelled, 20)
        self.assertEqual(result['status'], 'skipped', result)
        self.assertIn('Unsafe shell characters', result['output'])

    def test_real_npm_setup_and_correct_or_broken_node_tests(self):
        npm = shutil.which('npm')
        node = shutil.which('node')
        if not npm or not npm.lower().endswith(('.cmd', '.bat')) or not node:
            self.skipTest('Installed Windows npm launcher and Node are required')
        for expected, outcome in ((4, 'passed'), (5, 'failed')):
            project = self.root / f'project with spaces {expected}'
            project.mkdir()
            (project / 'package.json').write_text(json.dumps({
                'name': 'praxis-windows-runtime-fixture', 'private': True,
                'scripts': {'test': 'node --test test.js'}}), encoding='utf-8')
            (project / 'sum.js').write_text('exports.sum = (a, b) => a + b;', encoding='utf-8')
            (project / 'test.js').write_text(
                "const { test } = require('node:test'); const assert = require('node:assert/strict');\n"
                "const { sum } = require('./sum');\n"
                "test('real changed code path and stripped credentials', () => {\n"
                "assert.equal(process.env.PRAXIS_WINDOWS_RUNTIME_API_KEY, undefined);\n"
                f"assert.equal(sum(2, 2), {expected});\n" + '});\n', encoding='utf-8')
            with patch.dict(os.environ, {'PRAXIS_WINDOWS_RUNTIME_API_KEY': 'private-runtime-fixture'}):
                results = run_checks(project, discover_commands(project)['commands'],
                                     lambda _: None, self.cancelled)
            self.assertEqual([result['status'] for result in results], ['passed', outcome], results)
            self.assertTrue(all(result['runtime'] == 'host' and result['network'] == 'host'
                                for result in results))
            self.assertEqual(results[-1]['exit_code'], 0 if expected == 4 else 1)
            self.assertIn('real changed code path', results[-1]['output'])
            self.assertNotIn('private-runtime-fixture', json.dumps(results))


if __name__ == '__main__':
    unittest.main()
