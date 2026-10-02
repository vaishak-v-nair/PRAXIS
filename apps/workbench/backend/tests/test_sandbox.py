"""Container boundary tests, plus explicitly enabled real Docker regression."""
import json
import os
import tarfile
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from regen import sandbox, scanner


class SandboxTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'package.json').write_text(json.dumps({'scripts': {'test': 'node test.js'}}))
        (self.root / 'test.js').write_text("require('node:assert').equal(2 + 2, 4)")
        self.cancelled = threading.Event()
        self.calls = []

    def tearDown(self):
        self.temp.cleanup()

    def fake_docker(self, argv, cwd, cancelled, timeout, **kwargs):
        self.calls.append(argv)
        self.assertEqual(argv[0], 'docker', 'Never execute project commands on the host')
        if argv[1] != 'context':
            self.assertEqual(kwargs['env']['DOCKER_HOST'], 'unix:///var/run/docker.sock')
        output = 'unix:///var/run/docker.sock' if argv[1] == 'context' else 'linux' if argv[1] == 'info' else 'sha256:' + 'a' * 64 if argv[1:3] == ['image', 'inspect'] else ''
        return {'status': 'passed', 'output': output, 'exit_code': 0}

    def run_checks(self, commands=None, **kwargs):
        return sandbox.run_checks(self.root, commands or [['npm', 'run', 'test']], lambda _: None, self.cancelled, **kwargs)

    def test_archive_excludes_credentials_and_redacts_recognizable_secrets(self):
        secret = 'sk-proj-' + 'abcd' * 12
        for name in ('.env', '.npmrc', '.pypirc', 'private.pem'):
            (self.root / name).write_text(secret)
        (self.root / 'config.js').write_text('export const api_key = "' + secret + '"')
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'source.tar'
            sandbox.archive_source(self.root, target, self.cancelled)
            with tarfile.open(target) as archive:
                self.assertEqual(set(archive.getnames()), {'package.json', 'test.js', 'config.js'})
                self.assertNotIn(secret.encode(), archive.extractfile('config.js').read())
                self.assertTrue(all(member.uid == 1000 and member.isfile() for member in archive))

    def test_archived_python_reference_remains_executable_and_literal_is_redacted(self):
        source = 'runtime_key = "example-key"\npayload = dict(api_key=runtime_key)\nassert payload["api_key"] == runtime_key\n'
        (self.root / 'llm.py').write_text(source + 'other = dict(api_key="opaquecredential123456")\n')
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'source.tar'
            sandbox.archive_source(self.root, target, self.cancelled)
            with tarfile.open(target) as archive:
                archived = archive.extractfile('llm.py').read().decode()
        self.assertIn(source, archived.replace('\r\n', '\n'))
        self.assertNotIn('opaquecredential123456', archived)
        exec(compile(archived, 'llm.py', 'exec'), {})

    def test_missing_engine_never_falls_back(self):
        with patch.object(scanner, '_process', return_value={'status': 'failed', 'output': 'unavailable'}) as process:
            results = self.run_checks()
        self.assertEqual(results[0]['status'], 'skipped')
        self.assertEqual(process.call_count, 1)

    def test_health_reports_local_linux_engine_and_required_images_without_mutation(self):
        def inspect(argv, *args, **kwargs):
            if argv[1] == 'context':
                output = 'npipe:////./pipe/dockerDesktopLinuxEngine'
            elif argv[1] == 'info':
                output = 'linux'
            else:
                output = 'sha256:' + 'a' * 64
            return {'status': 'passed', 'output': output, 'exit_code': 0}
        sandbox._health_cache = (0.0, None)
        with patch.object(scanner, '_process', side_effect=inspect) as process:
            result = sandbox.health()
        self.assertTrue(result['ready'])
        self.assertTrue(result['engine'])
        self.assertTrue(all(item['ready'] for item in result['images'].values()))
        self.assertEqual(process.call_count, 4)

    def test_limits_network_image_identity_and_cleanup(self):
        with patch.object(scanner, '_process', side_effect=self.fake_docker):
            results = self.run_checks()
        create = next(argv for argv in self.calls if argv[1] == 'create')
        self.assertEqual(create[create.index('--network') + 1], 'none')
        for flag in ('--read-only', '--cap-drop', '--security-opt', '--memory', '--cpus', '--pids-limit', '--user'):
            self.assertIn(flag, create)
        self.assertNotIn('--volume', create)
        self.assertNotIn('--mount', create)
        self.assertTrue(any(arg.startswith('/workspace:') and ',exec,' in arg for arg in create))
        self.assertIn('HTTP_PROXY=', create)
        self.assertIn('UV_CACHE_DIR=/workspace/.regen-runtime/uv-cache', create)
        self.assertEqual(create[create.index('--pull') + 1], 'never')
        self.assertEqual(create[-2], 'sha256:' + 'a' * 64)
        self.assertEqual(self.calls[-1][1:3], ['rm', '-f'])
        self.assertEqual(results[0]['kind'], 'command')
        self.assertEqual(results[0]['network'], 'none')

    def test_remote_docker_context_is_refused_before_copying(self):
        with patch.object(scanner, '_process', return_value={'status': 'passed', 'output': 'tcp://remote.example:2376'}) as process:
            results = self.run_checks()
        self.assertEqual(results[0]['status'], 'skipped')
        self.assertIn('remote engine', results[0]['output'])
        self.assertEqual(process.call_count, 1)

    def test_failed_install_skips_dependent_tests(self):
        def execute(argv, *args, **kwargs):
            result = self.fake_docker(argv, *args, **kwargs)
            return dict(result, status='failed', exit_code=1) if 'install' in argv else result
        with patch.object(scanner, '_process', side_effect=execute):
            results = self.run_checks([['npm', 'install'], ['npm', 'run', 'test']])
        self.assertEqual([r['status'] for r in results], ['failed', 'skipped'])
        self.assertFalse(any('test' in call for call in self.calls))

    def test_timeout_stops_container_and_skips_remaining_commands(self):
        def execute(argv, *args, **kwargs):
            result = self.fake_docker(argv, *args, **kwargs)
            return dict(result, status='timeout', exit_code=-1) if 'test' in argv else result
        with patch.object(scanner, '_process', side_effect=execute):
            results = self.run_checks([['npm', 'run', 'test'], ['npm', 'run', 'build']])
        self.assertEqual([r['status'] for r in results], ['timeout', 'skipped'])
        self.assertFalse(any('build' in call for call in self.calls))
        self.assertTrue(any(call[1:3] == ['rm', '-f'] for call in self.calls))

    def test_cancel_removes_container_with_uncancelled_cleanup(self):
        def execute(argv, cwd, cancelled, timeout, **kwargs):
            if argv[1] == 'rm':
                self.assertFalse(cancelled.is_set())
            result = self.fake_docker(argv, cwd, cancelled, timeout, **kwargs)
            if 'test' in argv:
                self.cancelled.set()
            return result
        with patch.object(scanner, '_process', side_effect=execute):
            with self.assertRaises(RuntimeError):
                self.run_checks([['npm', 'run', 'test'], ['npm', 'run', 'build']])
        self.assertEqual(self.calls[-1][1:3], ['rm', '-f'])

    def test_network_requires_explicit_option_and_browser_stays_unverified(self):
        with patch.object(scanner, '_process', side_effect=self.fake_docker):
            results = self.run_checks(allow_network=True, start_command=['npm', 'start'])
        create = next(argv for argv in self.calls if argv[1] == 'create')
        self.assertEqual(create[create.index('--network') + 1], 'bridge')
        self.assertEqual(results[-1]['status'], 'skipped')

    def test_python_translation_and_unsupported_runtime(self):
        self.assertEqual(sandbox.command_runtime(['C:\\Python312\\python.exe', '-m', 'venv', '.regen-runtime'])[1][0], 'python')
        self.assertEqual(sandbox.command_runtime(['.regen-runtime/Scripts/python.exe', '-m', 'pytest'])[1][0], '/workspace/.regen-runtime/bin/python')
        self.assertEqual(sandbox.command_runtime(['powershell', '-Command', 'bad']), (None, []))

    def test_uv_setup_and_nested_npm_setup_are_classified_in_their_runtime(self):
        commands = [['npm', '--prefix', 'web', 'ci', '--ignore-scripts'],
                    ['uv', 'sync', '--frozen', '--no-progress'], ['uv', 'run', 'pytest', 'tests']]
        with patch.object(scanner, '_process', side_effect=self.fake_docker):
            results = self.run_checks(commands)
        self.assertEqual([item['kind'] for item in results], ['setup', 'setup', 'command'])
        executed = [call for call in self.calls if call[1:2] == ['exec']]
        self.assertTrue(any('/workspace/.regen-runtime/bin/uv' in call and 'sync' in call for call in executed))
        self.assertTrue(any('/workspace/.regen-runtime/bin/uv' in call and 'pytest' in call for call in executed))

    def test_results_stream_independently_of_mutable_internal_list(self):
        partial = []
        with patch.object(scanner, '_process', side_effect=self.fake_docker):
            results = self.run_checks([['npm', 'run', 'test'], ['npm', 'run', 'build']], on_result=partial.append)
        self.assertEqual(len(partial), 2)
        self.assertEqual(len(partial[0]), 1)
        self.assertEqual(partial[-1], results)

    @unittest.skipUnless(os.environ.get('PRAXIS_TEST_DOCKER') == '1', 'Set PRAXIS_TEST_DOCKER=1 for real Docker execution')
    def test_real_container_pass_failure_and_boundary(self):
        # Project code tests its own container boundary; no model or external network.
        (self.root / 'test.js').write_text("""
const assert = require('node:assert'); const fs = require('node:fs');
assert.equal(process.getuid(), 1000);
assert.equal(process.env.PRAXIS_SANDBOX_SENTINEL, undefined);
assert.equal(fs.existsSync('.env'), false);
assert.equal(fs.existsSync('/var/run/docker.sock'), false);
assert.throws(() => fs.writeFileSync('/host-write-test', 'bad'));
assert.equal(Object.keys(require('node:os').networkInterfaces()).join(','), 'lo');
fs.writeFileSync('container-only.txt', 'local');
fs.writeFileSync('runtime-tool', '#!/bin/sh\\necho runtime-executable\\n', {mode: 0o755});
assert.equal(require('node:child_process').execFileSync('./runtime-tool').toString().trim(), 'runtime-executable');
console.log('Container boundary assertions passed');
""")
        (self.root / '.env').write_text('PRAXIS_SANDBOX_SENTINEL=private')
        with patch.dict(os.environ, {'PRAXIS_SANDBOX_SENTINEL': 'private'}):
            results = self.run_checks()
        self.assertEqual(results[0]['status'], 'passed', results)
        self.assertFalse((self.root / 'container-only.txt').exists())
        (self.root / 'test.js').write_text("require('node:assert').equal(2 + 2, 5)")
        results = self.run_checks()
        self.assertEqual(results[0]['status'], 'failed', results)
        self.assertIn('AssertionError', results[0]['output'])

    @unittest.skipUnless(os.environ.get('PRAXIS_TEST_DOCKER') == '1', 'Set PRAXIS_TEST_DOCKER=1 for real Docker execution')
    def test_real_python_discovered_commands(self):
        (self.root / 'package.json').unlink()
        (self.root / 'requirements.txt').write_text('')
        (self.root / 'test_math.py').write_text('import unittest\nclass Math(unittest.TestCase):\n def test_sum(self): self.assertEqual(2 + 2, 4)\n')
        commands = scanner.discover_commands(self.root)['commands']
        results = self.run_checks(commands)
        self.assertEqual([r['status'] for r in results], ['passed', 'passed', 'passed'], results)
        self.assertEqual([r['kind'] for r in results], ['setup', 'setup', 'command'])
        self.assertFalse((self.root / '.regen-runtime').exists())
