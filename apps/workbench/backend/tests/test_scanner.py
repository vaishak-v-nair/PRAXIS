import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from regen.scanner import (child_env, discover_commands, fingerprint, prepare_project,
                           redact, run_checks, safe_files, scan_project, _remove_clone, _executable, _process)


class ScannerSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.project = self.root / 'submitted'
        self.project.mkdir()
        self.cancelled = threading.Event()

    def tearDown(self):
        self.temp.cleanup()

    def test_snapshot_preserves_dirty_files_excludes_credentials_and_dependencies(self):
        secret = 'sk-proj-' + 'x' * 32
        (self.project / '.env').write_text('OPENAI_API_KEY=' + secret)
        (self.project / 'app.py').write_text('print("dirty local changes")')
        (self.project / 'node_modules').mkdir()
        (self.project / 'node_modules' / 'junk.js').write_text('ignored')
        result = prepare_project(str(self.project), self.root / 'job', lambda event: None, self.cancelled)
        snapshot = Path(result['path'])
        self.assertEqual((snapshot / 'app.py').read_text(), 'print("dirty local changes")')
        self.assertFalse((snapshot / '.env').exists())
        self.assertFalse((snapshot / 'node_modules').exists())
        self.assertTrue(result['findings'])
        self.assertNotIn(secret, json.dumps(result))
        self.assertFalse(result['findings'][0]['fixable'])

    def test_symlink_escape_is_ignored(self):
        outside = self.root / 'outside.py'
        outside.write_text('private')
        try:
            (self.project / 'escape.py').symlink_to(outside)
        except OSError:
            self.skipTest('Symlink creation unavailable')
        self.assertEqual(list(safe_files(self.project)), [])

    def test_custom_virtual_environment_is_not_scanned_or_fingerprinted(self):
        (self.project / 'app.py').write_text('print("source")')
        env = self.project / '.venv-secure'
        env.mkdir()
        (env / 'pyvenv.cfg').write_text('home = python')
        library = env / 'vendor.py'
        library.write_text('API_KEY="not-project-source"')
        self.assertEqual([file.name for file in safe_files(self.project)], ['app.py'])
        before = fingerprint(self.project)
        library.write_text('changed generated dependency')
        self.assertEqual(fingerprint(self.project), before)

    def test_private_praxis_memory_is_never_scanned_or_snapshotted(self):
        (self.project / 'app.py').write_text('print("source")')
        memory = self.project / '.praxis'
        memory.mkdir()
        (memory / 'memory.md').write_text('private conversation and goals')
        self.assertEqual([file.name for file in safe_files(self.project)], ['app.py'])
        result = prepare_project(str(self.project), self.root / 'job', lambda event: None, self.cancelled)
        self.assertTrue(result['praxis_memory_available'])
        self.assertFalse((Path(result['path']) / '.praxis').exists())

    def test_fingerprint_detects_dirty_source_and_environment_changes(self):
        file = self.project / 'app.py'
        file.write_text('a')
        first = fingerprint(self.project)
        file.write_text('b')
        second = fingerprint(self.project)
        self.assertNotEqual(first, second)
        (self.project / '.env').write_text('API_KEY=local-only')
        self.assertNotEqual(second, fingerprint(self.project))

    def test_secret_redaction_and_environment_isolation(self):
        secret = 'sk-or-v1-' + 'a' * 40
        with patch.dict(os.environ, {'CUSTOM_API_KEY': 'an-arbitrary-private-value', 'REGEN_JOB_ID': 'internal'}):
            output = redact(f'api_key={secret} an-arbitrary-private-value https://user:pass@example.com')
            self.assertNotIn(secret, output)
            self.assertNotIn('an-arbitrary-private-value', output)
            self.assertNotIn('user:pass', output)
            self.assertNotIn('CUSTOM_API_KEY', child_env())
            self.assertNotIn('REGEN_JOB_ID', child_env())

    def test_scan_reports_evidence_without_secret_values_or_fixture_noise(self):
        secret = 'ghp_' + 'a' * 30
        (self.project / 'app.py').write_text(f'TOKEN = "{secret}"\nrequests.get(url, verify=False)\nraise NotImplementedError\n')
        (self.project / 'tests').mkdir()
        (self.project / 'tests' / 'test_app.py').write_text('raise NotImplementedError\n')
        with patch('regen.scanner.shutil.which', return_value=None):
            result = scan_project(self.project, lambda event: None, self.cancelled)
        self.assertNotIn(secret, json.dumps(result))
        self.assertTrue(any(f['category'] == 'secrets' for f in result['findings']))
        self.assertTrue(any(f['title'] == 'TLS certificate verification is disabled' for f in result['findings']))
        self.assertFalse(any(f['location']['file'].startswith('tests/') for f in result['findings']))
        self.assertTrue(any(c['status'] == 'skipped' for c in result['coverage']))

    def test_placeholder_credentials_are_not_findings(self):
        (self.project / 'app.py').write_text('API_KEY="your_placeholder_api_key"\n')
        with patch('regen.scanner.shutil.which', return_value=None):
            result = scan_project(self.project, lambda event: None, self.cancelled)
        self.assertFalse(result['findings'])

    def test_documented_credentials_and_env_templates_are_preserved_without_noise(self):
        example = 'GEMINI_API_KEY=your-key-here\nNVIDIA_API_KEY=your_key_here\n'
        (self.project / '.env.example').write_text(example)
        (self.project / 'README.md').write_text("GEMINI_API_KEY='your-key-here'\n")
        (self.project / 'handson.md').write_text("GEMINI_API_KEY='your-key-here'\n")
        intake = prepare_project(str(self.project), self.root / 'job', lambda event: None, self.cancelled)
        self.assertEqual((Path(intake['path']) / '.env.example').read_text(), example)
        self.assertFalse(intake['findings'])
        with patch('regen.scanner.shutil.which', return_value=None):
            result = scan_project(Path(intake['path']), lambda event: None, self.cancelled)
        self.assertFalse(result['findings'])

    def test_template_actual_credentials_are_reported_and_sanitized(self):
        secret = 'nvapi-' + 'a' * 36
        (self.project / '.env.example').write_text('NVIDIA_API_KEY=' + secret)
        result = prepare_project(str(self.project), self.root / 'job', lambda event: None, self.cancelled)
        self.assertTrue(result['findings'])
        self.assertNotIn(secret, json.dumps(result))
        self.assertNotIn(secret, (Path(result['path']) / '.env.example').read_text())

    def test_provider_infix_template_placeholders_are_not_redacted_or_reported(self):
        content = 'GEMINI_API_KEY=your-gemini-api-key\nNVIDIA_API_KEY=your-nvidia-api-key\n'
        (self.project / '.env.example').write_text(content)
        result = prepare_project(str(self.project), self.root / 'job', lambda event: None, self.cancelled)
        self.assertFalse(result['findings'])
        self.assertEqual((Path(result['path']) / '.env.example').read_text(), content)
        for placeholder in ('PASTE_YOUR_GEMINI_API_KEY_HERE', 'insert-your-nvidia-api-key', 'replace-with-your-api-key'):
            with self.subTest(placeholder=placeholder):
                self.assertEqual(redact('API_KEY=' + placeholder), 'API_KEY=' + placeholder)

    def test_redaction_preserves_config_source_and_reports_only_real_syntax_errors(self):
        source = '''import os
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
def validate_config():
    missing = []
    if not GEMINI_API_KEY:
        missing.append("GEMINI_API_KEY")
    if missing:
        raise ValueError("Missing required environment variables: " + ", ".join(missing))
'''
        self.assertEqual(redact(source), source)
        (self.project / 'config.py').write_text(source)
        (self.project / 'bad.py').write_text('def broken(:\n')
        with patch('regen.scanner.shutil.which', return_value=None):
            result = scan_project(self.project, lambda event: None, self.cancelled)
        self.assertEqual(len(result['findings']), 1)
        self.assertEqual(result['findings'][0]['location']['file'], 'bad.py')
        self.assertEqual(result['findings'][0]['title'], 'Python source cannot be parsed')

    def test_json_and_provider_prefixed_generic_keys_are_redacted(self):
        secret = 'arbitrary-credential-value-123'
        for source in (f'GEMINI_API_KEY="{secret}"', json.dumps({'GEMINI_API_KEY': secret}), f'password: "{secret}"'):
            self.assertNotIn(secret, redact(source))
        self.assertEqual(redact('missing.append("GEMINI_API_KEY")'), 'missing.append("GEMINI_API_KEY")')
        self.assertEqual(redact('API_KEY = fetch_credentials()'), 'API_KEY = fetch_credentials()')

    def test_python_utf8_bom_is_not_reported_as_invalid_syntax(self):
        (self.project / 'app.py').write_bytes(b'\xef\xbb\xbfprint("valid")\n')
        with patch('regen.scanner.shutil.which', return_value=None):
            result = scan_project(self.project, lambda event: None, self.cancelled)
        self.assertFalse(result['findings'])

    def test_python_credential_references_survive_but_literals_and_env_credentials_do_not(self):
        source = 'groq_key = "example-key"\npayload = dict(api_key=groq_key)\n'
        self.assertEqual(redact(source, limit=None, python_source=True), source)
        (self.project / 'llm.py').write_text(source)
        with patch('regen.scanner.shutil.which', return_value=None):
            result = scan_project(self.project, lambda _: None, self.cancelled)
        self.assertFalse(result['findings'])
        literal = 'api_key="opaquecredential123456"\n'
        self.assertNotIn('opaquecredential123456', redact(literal, python_source=True))
        self.assertNotIn('opaquecredential123456', redact('API_KEY=opaquecredential123456'))
        (self.project / 'llm.py').write_text(source + 'payload = dict(api_key=groq_key, password="opaquecredential123456")\n')
        with patch('regen.scanner.shutil.which', return_value=None):
            result = scan_project(self.project, lambda _: None, self.cancelled)
        self.assertTrue(any(item['category'] == 'secrets' for item in result['findings']))

    def test_scan_reports_limits_and_unsupported_formats(self):
        (self.project / 'README.md').write_text('documentation')
        (self.project / 'huge.txt').write_text('x' * 64)
        with patch('regen.scanner.MAX_FILE_BYTES', 32), patch('regen.scanner.shutil.which', return_value=None):
            result = scan_project(self.project, lambda event: None, self.cancelled)
        local = next(c for c in result['coverage'] if c['name'] == 'Local source inspection')
        self.assertEqual(local['limits']['oversized_files'], 1)
        formats = next(c for c in result['coverage'] if c['name'] == 'Format coverage')
        self.assertIn('.md', formats['formats'])

    def test_streamlit_commands_install_into_isolated_environment_without_tests(self):
        (self.project / 'requirements.txt').write_text('streamlit>=1.40.0\n')
        (self.project / 'app.py').write_text('import streamlit as st\nst.title("App")')
        discovered = discover_commands(self.project)
        self.assertEqual(discovered['commands'][0][-3:], ['-m', 'venv', '.regen-runtime'])
        self.assertIn('.regen-runtime', discovered['commands'][1][0])
        self.assertEqual(discovered['commands'][1][1:], ['-m', 'pip', 'install', '--no-cache-dir', '--disable-pip-version-check', '-r', 'requirements.txt'])
        self.assertIn('4173', discovered['start_command'])
        self.assertIn('127.0.0.1', discovered['start_command'])
        self.assertIn('streamlit', discovered['start_command'])

    def test_clone_cleanup_removes_readonly_git_files_and_refuses_unchecked_path(self):
        import stat
        staging = self.root / 'clone-test'
        (staging / '.git').mkdir(parents=True)
        readonly = staging / '.git' / 'packed-refs'
        readonly.write_text('git data')
        readonly.chmod(stat.S_IREAD)
        _remove_clone(staging, self.root)
        self.assertFalse(staging.exists())
        with self.assertRaises(ValueError):
            _remove_clone(self.project, self.root)

    def test_isolated_python_setup_failure_stops_dependent_checks(self):
        with patch('regen.scanner._process', return_value={'status': 'failed', 'output': 'install failure', 'exit_code': 1}) as process:
            result = run_checks(self.project, [['python', '-m', 'venv', '.regen-runtime'], ['python', '-m', 'pytest']], lambda event: None, self.cancelled, ['python', 'app.py'])
        self.assertEqual(process.call_count, 1)
        self.assertEqual(result[-1]['status'], 'skipped')

    def test_host_uv_sync_failure_is_setup_and_stops_test_dispatch(self):
        with patch('regen.scanner._process', return_value={'status': 'failed', 'output': 'sync failed', 'exit_code': 1}) as process:
            result = run_checks(self.project, [['uv', 'sync', '--frozen'], ['uv', 'run', 'pytest']], lambda _: None, self.cancelled)
        self.assertEqual(process.call_count, 1)
        self.assertEqual(result[0]['kind'], 'setup')
        self.assertEqual(result[-1]['status'], 'skipped')

    def test_intake_rejects_external_urls_and_recursive_workspaces(self):
        with self.assertRaises(ValueError):
            prepare_project('https://evil.example/x/y', self.root / 'job', lambda event: None, self.cancelled)
        with self.assertRaises(ValueError):
            prepare_project(str(self.project), self.project / 'output', lambda event: None, self.cancelled)
        result = prepare_project(str(self.project), self.project / '.regen' / 'job', lambda event: None, self.cancelled)
        self.assertTrue(Path(result['path']).is_dir())

    def test_vite_command_uses_local_browser_port(self):
        (self.project / 'package.json').write_text(json.dumps({'scripts': {'dev': 'vite', 'test': 'vitest'}, 'devDependencies': {'vite': '*'}}))
        discovered = discover_commands(self.project)
        self.assertEqual(discovered['commands'][-1], ['npm', 'run', 'test'])
        self.assertIn('--ignore-scripts', discovered['commands'][0])
        self.assertIn('4173', discovered['start_command'])
        self.assertIn('127.0.0.1', discovered['start_command'])

    def test_mixed_uv_and_nested_web_dependencies_precede_all_checks(self):
        (self.project / 'web').mkdir()
        (self.project / 'web/package.json').write_text('{}')
        (self.project / 'web/package-lock.json').write_text('{}')
        (self.project / 'pyproject.toml').write_text('[project]\nname="mixed"')
        (self.project / 'uv.lock').write_text('version = 1')
        (self.project / 'tests').mkdir()
        (self.project / 'tests/test_app.py').write_text('def test_app(): assert True')
        (self.project / 'package.json').write_text(json.dumps({'scripts': {
            'test': 'uv run pytest tests', 'build': 'npm --prefix web run build',
            'dev': 'python start.py', 'unsafe': 'npm --prefix ../outside run test'}}))
        commands = discover_commands(self.project)['commands']
        self.assertIn(['npm', '--prefix', 'web', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], commands)
        self.assertEqual(commands[-2:], [['uv', 'run', 'pytest', 'tests'], ['npm', 'run', 'build']])
        self.assertIn(['uv', 'sync', '--frozen', '--no-progress'], commands[:-2])
        self.assertFalse(any('../outside' in command for command in commands))
        self.assertEqual(discover_commands(self.project)['start_command'], ['uv', 'run', 'python', 'start.py'])

    def test_uv_uses_its_isolated_environment_executable_on_host(self):
        uv = self.project / '.regen-runtime' / ('Scripts/uv.exe' if os.name == 'nt' else 'bin/uv')
        uv.parent.mkdir(parents=True)
        uv.write_text('isolated executable placeholder')
        with patch('regen.scanner.shutil.which', return_value=None):
            self.assertEqual(_executable(['uv', 'run', 'pytest'], self.project), [str(uv.resolve()), 'run', 'pytest'])

    def test_agent_plugins_are_excluded_without_losing_project_instructions(self):
        (self.project / '.agents/impeccable/src').mkdir(parents=True)
        (self.project / '.agents/impeccable/src/app.py').write_text('raise NotImplementedError')
        (self.project / 'AGENTS.md').write_text('Project engineering instructions')
        (self.project / 'app.py').write_text('print("real application")')
        with patch('regen.scanner.shutil.which', return_value=None):
            result = scan_project(self.project, lambda _: None, self.cancelled)
        self.assertFalse(result['findings'])
        local = next(item for item in result['coverage'] if item['name'] == 'Local source inspection')
        self.assertEqual(local['limits']['excluded_agent_tooling_dirs'], 1)
        self.assertEqual({file.name for file in safe_files(self.project)}, {'AGENTS.md', 'app.py'})
        self.assertTrue((self.project / '.agents/impeccable/src/app.py').exists())

    def test_checks_receive_no_api_keys_and_output_is_redacted(self):
        import sys
        with patch.dict(os.environ, {'PRIVATE_API_KEY': 'secret-backend-value'}):
            result = run_checks(self.project, [[sys.executable, '-c', 'import os; print(os.getenv("PRIVATE_API_KEY", "absent"))']], lambda event: None, self.cancelled)
        self.assertEqual(result[0]['status'], 'passed')
        self.assertIn('absent', result[0]['output'])

    def test_host_provenance_and_streamed_results_never_imply_network_isolation(self):
        partial = []
        outcomes = [{'status': 'passed', 'output': 'tests completed', 'exit_code': 0},
                    {'status': 'failed', 'output': 'build failed', 'exit_code': 1}]
        with patch('regen.scanner._process', side_effect=outcomes):
            results = run_checks(self.project, [['python', '-m', 'unittest'], ['npm', 'run', 'build']],
                                 lambda _: None, self.cancelled, on_result=partial.append)
        self.assertEqual(len(partial), 2)
        self.assertEqual(len(partial[0]), 1)
        self.assertEqual(partial[-1], results)
        self.assertEqual([item['status'] for item in results], ['passed', 'failed'])
        self.assertTrue(all(item['runtime'] == 'host' and item['network'] == 'host' for item in results))

    def test_unavailable_host_command_stays_skipped_with_provenance(self):
        with patch('regen.scanner._process', return_value={'status': 'skipped', 'output': 'Executable unavailable: missing', 'exit_code': None}):
            result = run_checks(self.project, [['missing', 'test']], lambda _: None, self.cancelled)
        self.assertEqual(result[0]['status'], 'skipped')
        self.assertEqual(result[0]['runtime'], 'host')

    def test_host_browser_unavailability_retains_homepage_scope_and_provenance(self):
        with patch('regen.scanner._browser_check', return_value={
                'name': 'Browser checks', 'kind': 'browser', 'evidence_scope': 'homepage_smoke',
                'status': 'skipped', 'output': 'Playwright Chromium is not installed'}):
            result = run_checks(self.project, [], lambda _: None, self.cancelled, ['python', 'app.py'])
        self.assertEqual(result[0]['status'], 'skipped')
        self.assertEqual(result[0]['evidence_scope'], 'homepage_smoke')
        self.assertEqual(result[0]['runtime'], 'host')

    def test_host_cancellation_stops_before_any_later_command_or_browser(self):
        def execute(*args, **kwargs):
            self.cancelled.set()
            return {'status': 'cancelled', 'output': 'Stopped', 'exit_code': -1}
        with patch('regen.scanner._process', side_effect=execute) as process, \
                patch('regen.scanner._browser_check') as browser:
            result = run_checks(self.project, [['python', '-m', 'unittest'], ['npm', 'run', 'build']],
                                lambda _: None, self.cancelled, ['python', 'app.py'])
        self.assertEqual(process.call_count, 1)
        browser.assert_not_called()
        self.assertEqual(result[0]['status'], 'cancelled')

    def test_host_time_limit_keeps_timeout_and_stops_dependent_setup(self):
        with patch('regen.scanner._process', return_value={'status': 'timeout', 'output': 'Setup timed out', 'exit_code': -1}) as process:
            result = run_checks(self.project, [['python', '-m', 'venv', '.regen-runtime'], ['python', '-m', 'unittest']],
                                lambda _: None, self.cancelled)
        self.assertEqual(process.call_args.args[3], 600)
        self.assertEqual([item['status'] for item in result], ['timeout', 'skipped'])
        self.assertTrue(all(item['runtime'] == 'host' for item in result))

    def test_long_command_output_keeps_redacted_tail_and_test_summary(self):
        import sys
        secret = 'gsk_' + 'a' * 35
        result = _process([sys.executable, '-c',
                           'print("START"); print("x" * 30000); print("' + secret + '"); print("2 failed, 8 passed in 1.0s")'],
                          self.project, self.cancelled)
        self.assertTrue(result['output_truncated'])
        self.assertTrue(result['output'].startswith('START'))
        self.assertIn('2 failed, 8 passed', result['output'])
        self.assertNotIn(secret, result['output'])
        self.assertLessEqual(len(result['output']), 24000)

    def test_cancellation_prevents_copying(self):
        (self.project / 'app.py').write_text('print(1)')
        self.cancelled.set()
        with self.assertRaises(RuntimeError):
            prepare_project(str(self.project), self.root / 'job', lambda event: None, self.cancelled)


if __name__ == '__main__':
    unittest.main()
