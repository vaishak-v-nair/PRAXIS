import tempfile
import unittest
from pathlib import Path

from regen.review import assessment, project_plan


class ReviewTests(unittest.TestCase):
    def test_inventory_graph_reads_imports_without_executing_project(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'app.py').write_text('import service\nraise RuntimeError("never execute me")')
            (root / 'service.py').write_text('def work(): return 4')
            (root / 'test_service.py').write_text('import service\nassert service.work() == 4')
            (root / 'README.md').write_text('# Goal\nShip the service')
            (root / '.github' / 'workflows').mkdir(parents=True)
            (root / '.github' / 'workflows' / 'quality.yml').write_text('name: quality')
            (root / 'Dockerfile').write_text('FROM python:3.12-slim')
            (root / '.praxis').mkdir()
            (root / '.praxis' / 'memory.md').write_text('private conversation')
            plan = project_plan(root, [])
        self.assertEqual(plan['test_file_count'], 1)
        self.assertIn({'source': 'app.py', 'target': 'service.py'}, plan['graph']['edges'])
        self.assertEqual(plan['understanding']['continuity']['status'], 'available')
        self.assertIn('README.md', plan['understanding']['planning_files'])
        self.assertNotIn('.praxis/memory.md', plan['graph']['nodes'])
        self.assertEqual(plan['version'], 3)
        self.assertEqual(plan['operations']['deployment_files'], ['Dockerfile'])
        self.assertEqual(plan['operations']['ci_files'], ['.github/workflows/quality.yml'])

    def test_no_tests_or_setup_only_never_means_clean(self):
        for checks in ([], [{'status': 'passed', 'kind': 'setup'}]):
            result = assessment({'status': 'complete', 'checks': checks})
            self.assertEqual(result['status'], 'incomplete')
            self.assertEqual(result['commands_passed'], 0)

    def test_success_keeps_coverage_limits_and_failure_wins(self):
        job = {'status': 'complete', 'checks': [{'status': 'passed', 'kind': 'command'}], 'coverage': [{'name': 'Secrets', 'status': 'skipped', 'detail': 'Tool unavailable'}]}
        result = assessment(job)
        self.assertEqual(result['status'], 'checked')
        self.assertIn('Secrets: Tool unavailable', result['gaps'])
        job['checks'].append({'status': 'failed', 'kind': 'command'})
        self.assertEqual(assessment(job)['status'], 'attention')
        job['checks'].pop()
        job['findings'] = [{'title': 'Possible issue', 'confidence': 'likely'}]
        self.assertEqual(assessment(job)['status'], 'attention')

    def test_earlier_checks_do_not_verify_new_repair(self):
        result = assessment({'status': 'complete', 'snapshot': 'original', 'fix_path': 'repair-two',
                             'checks_for': 'repair-one', 'checks': [{'status': 'passed', 'kind': 'command'}]})
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(result['commands_passed'], 0)
        self.assertTrue(any('earlier snapshot' in gap for gap in result['gaps']))

    def test_false_success_blocks_readiness_and_is_not_called_real(self):
        result = assessment({'status': 'complete', 'plan': {'files': 2, 'test_file_count': 1},
                             'findings': [{'category': 'incomplete', 'severity': 'low',
                                           'title': 'Write-named function returns constant success'}],
                             'coverage': [{'name': 'Local source inspection', 'status': 'passed', 'detail': '2 files'}],
                             'checks': [{'name': 'tests', 'kind': 'command', 'status': 'passed'}]})
        self.assertEqual(result['implementation']['status'], 'placeholder_risk')
        self.assertEqual(result['readiness']['status'], 'blocked')

    def test_failed_behavior_is_contradicted(self):
        result = assessment({'status': 'complete', 'plan': {'files': 3, 'test_file_count': 1},
                             'checks': [{'name': 'tests', 'kind': 'command', 'status': 'failed', 'output': 'assertion'}]})
        self.assertEqual(result['implementation']['status'], 'contradicted')
        self.assertEqual(result['readiness']['status'], 'blocked')

    def test_execution_attention_uses_actual_runtime_without_changing_verdicts(self):
        for runtime, environment in (('host', 'local review copy'), ('docker', 'container'),
                                     (None, 'recorded execution environment')):
            with self.subTest(runtime=runtime):
                check = {'name': 'quality-check', 'kind': 'command', 'status': 'failed', 'output': 'Check failed'}
                if runtime:
                    check['runtime'] = runtime
                result = assessment({'status': 'complete', 'checks': [check]})
                action = next(item for item in result['attention_items'] if item['source'] == 'quality-check')
                self.assertIn(environment, action['title'])
                self.assertEqual(result['implementation']['status'], 'contradicted')
                self.assertEqual(result['readiness']['status'], 'blocked')
                self.assertEqual(result['checks_failed'], 1)
                if runtime == 'host':
                    self.assertNotIn('isolat', str(action))
                    self.assertNotIn('container', str(action))

    def test_host_disk_failure_does_not_invent_container_limits(self):
        result = assessment({'status': 'complete', 'checks': [
            {'name': 'pip install .', 'kind': 'setup', 'runtime': 'host',
             'status': 'failed', 'output': 'No space left on device'}]})
        action = next(item for item in result['attention_items'] if item['source'] == 'pip install .')
        self.assertIn('local review copy', action['summary'])
        self.assertNotIn('container', str(action))
        self.assertNotIn('isolated disk limit', str(action))
        self.assertEqual(result['implementation']['status'], 'not_established')

    def test_source_only_next_action_offers_checks_without_claiming_setup_failure(self):
        result = assessment({'status': 'complete', 'checks': []})
        action = next(item for item in result['attention_items'] if item['source'] == 'behavioral tests')
        self.assertIn('Run checks', action['action'])
        self.assertIn('trusted project', action['action'])
        self.assertNotIn('Resolve setup or test failures', action['action'])
        self.assertEqual(result['commands_passed'], 0)

    def test_setup_failure_is_not_a_behavioral_contradiction_or_raw_log_in_main_summary(self):
        raw = 'Traceback (most recent call last):\nTimeoutError: package read timed out\nraw-private-looking-json'
        result = assessment({'status': 'complete', 'checks': [
            {'name': 'pip install .', 'kind': 'setup', 'status': 'failed', 'output': raw},
            {'name': 'pytest', 'kind': 'command', 'status': 'skipped', 'output': 'A required setup step failed.'}]})
        self.assertEqual(result['implementation']['status'], 'not_established')
        self.assertEqual(result['readiness']['status'], 'blocked')
        self.assertTrue(any(item['title'] == 'Dependencies could not finish downloading' for item in result['attention_items']))
        for display in [result['attention_items'], result['readiness']['blockers']]:
            self.assertNotIn('Traceback', str(display))
            self.assertNotIn('raw-private-looking-json', str(display))
        self.assertIn('Traceback', str(result['gaps']), 'Raw evidence remains available')

    def test_missing_tool_timeout_and_cancellation_never_prove_broken_behavior(self):
        for status, output in [('failed', 'sh: 1: uv: not found'), ('failed', 'sh: 1: tsc: Permission denied'),
                               ('failed', 'OCI runtime exec failed: unable to start container process: permission denied'),
                               ('timeout', 'still running'), ('cancelled', 'stopped')]:
            result = assessment({'status': 'complete', 'checks': [{'name': 'tests', 'kind': 'command', 'status': status, 'output': output}]})
            self.assertEqual(result['implementation']['status'], 'not_established')

    def test_unavailable_docker_explains_how_to_retry_saved_review(self):
        result = assessment({'status': 'complete', 'checks': [
            {'name': 'Container runtime', 'kind': 'infrastructure', 'status': 'skipped',
             'output': 'Linux Docker engine unavailable. failed to connect to API at npipe:////./pipe/dockerDesktopLinuxEngine'}]})
        action = next(item for item in result['attention_items'] if item['source'] == 'Container runtime')
        self.assertIn('Docker', action['title'])
        self.assertIn('saved review', action['action'])
        self.assertNotIn('npipe', str(result['attention_items']))

    def test_failed_test_summary_translates_recorded_counts_without_stack_trace(self):
        result = assessment({'status': 'complete', 'checks': [
            {'name': 'uv run pytest tests', 'kind': 'command', 'status': 'failed',
             'output': 'Traceback: raw internals\n== 9 failed, 33 passed, 1 skipped in 3.0s =='}]})
        action = next(item for item in result['attention_items'] if item['source'] == 'uv run pytest tests')
        self.assertIn('9 failed, 33 passed', action['summary'])
        self.assertNotIn('Traceback', str(action))

    def test_provider_failures_are_actionable_without_machine_response_dump(self):
        result = assessment({'status': 'complete', 'coverage': [
            {'name': 'Architecture agent · openrouter', 'status': 'skipped', 'detail': 'HTTP 402 {"provider_error": "billing declined"}'},
            {'name': 'Security agent · gemini', 'status': 'skipped', 'detail': 'HTTP 429 {"error": "quota exhausted"}'},
            {'name': 'User journey agent · groq', 'status': 'limited', 'detail': 'Pressure-tested 4 of 200 files.'}]})
        actions = result['attention_items']
        self.assertTrue(any('billing or access' in item['title'] for item in actions))
        self.assertTrue(any('request limit' in item['title'] for item in actions))
        self.assertTrue(any('4 of 200' in item['title'] for item in actions))
        self.assertNotIn('provider_error', str(actions))
        self.assertTrue(all(item['action'] and item['source'] and item['id'] for item in actions))

    def test_stale_evidence_has_first_priority_recovery_action(self):
        result = assessment({'status': 'complete', 'snapshot': 'new', 'checks_for': 'old',
                             'checks': [{'name': 'tests', 'kind': 'command', 'status': 'passed'}]})
        self.assertEqual(result['attention_items'][0]['source'], 'snapshot binding')

    def test_release_candidate_requires_static_runtime_and_browser_evidence(self):
        result = assessment({'status': 'complete', 'plan': {'files': 3, 'test_file_count': 1},
                             'coverage': [{'name': 'Local source inspection', 'status': 'passed', 'detail': '3 files'}],
                             'checks': [{'name': 'tests', 'kind': 'command', 'status': 'passed'},
                                        {'name': 'Checkout journey', 'kind': 'browser', 'evidence_scope': 'user_journey', 'status': 'passed'}]})
        self.assertEqual(result['implementation']['status'], 'demonstrated')
        self.assertEqual(result['readiness']['status'], 'release_candidate')
        self.assertEqual(next(item for item in result['dimensions'] if item['id'] == 'e2e')['status'], 'passed')

    def test_homepage_smoke_and_lint_do_not_become_user_journey_or_release_candidate(self):
        result = assessment({'status': 'complete', 'plan': {'files': 3, 'test_file_count': 1},
                             'coverage': [{'name': 'Local source inspection', 'status': 'passed', 'detail': '3 files'}],
                             'checks': [{'name': 'npm run lint', 'kind': 'command', 'status': 'passed'},
                                        {'name': 'Browser checks', 'kind': 'browser',
                                         'evidence_scope': 'homepage_smoke', 'status': 'passed',
                                         'output': 'Homepage reached at two viewports.'}]})
        self.assertEqual(result['tests_passed'], 0)
        self.assertEqual(result['implementation']['status'], 'partially_demonstrated')
        self.assertEqual(result['readiness']['status'], 'not_established')
        self.assertIn('behavioral test', ' '.join(result['readiness']['requirements']))
        e2e = next(item for item in result['dimensions'] if item['id'] == 'e2e')
        self.assertEqual(e2e['status'], 'smoke_passed')
        self.assertEqual(e2e['evidence_count'], 1)
        self.assertEqual(e2e['evidence'][0]['label'], 'Browser checks')

    def test_dimension_counts_are_actual_inspectable_records(self):
        result = assessment({'status': 'complete',
                             'plan': {'files': 20, 'manifests': ['package.json'], 'test_file_count': 1,
                                      'test_files': ['test.js'], 'understanding': {'entrypoints': ['app.js']},
                                      'graph': {'edges': [{'source': 'test.js', 'target': 'app.js'}],
                                                'indexed_files': 2},
                                      'operations': {'deployment_files': ['Dockerfile'],
                                                     'ci_files': ['.github/workflows/quality.yml'],
                                                     'observability_files': []}},
                             'coverage': [{'name': 'Local source inspection', 'status': 'passed', 'detail': '20 of 20 files'},
                                          {'name': 'OSV dependencies', 'status': 'passed', 'detail': 'Checked 4 versions'},
                                          {'name': 'Semgrep', 'status': 'skipped', 'detail': 'Not installed'}],
                             'checks': [{'name': 'npm test', 'kind': 'command', 'status': 'passed'}]})
        dimensions = {item['id']: item for item in result['dimensions']}
        self.assertEqual(dimensions['understanding']['evidence_count'], len(dimensions['understanding']['evidence']))
        self.assertEqual(dimensions['source']['evidence'][0]['detail'], '20 of 20 files')
        self.assertEqual(dimensions['security']['status'], 'limited')
        self.assertTrue(any(item['label'] == 'OSV dependencies' for item in dimensions['security']['evidence']))
        self.assertEqual(dimensions['operations']['evidence_count'], 2)

    def test_non_applicable_checks_and_authorship_limit_are_classified_precisely(self):
        result = assessment({'status': 'complete', 'coverage': [
            {'name': 'Python syntax', 'status': 'skipped', 'detail': '0 Python files were available for raw-source syntax parsing.'},
            {'name': 'Python behavioral AST patterns', 'status': 'skipped', 'detail': 'Python-only checks were not applicable.'},
            {'name': 'OSV dependencies', 'status': 'skipped', 'detail': 'No supported exact-version npm lockfile or Python requirements found.'},
            {'name': 'AI authorship and production data', 'status': 'limited', 'detail': 'Authorship cannot be proven from code.'},
            {'name': 'AI contextual review', 'status': 'skipped', 'detail': 'Disabled for this scan. No model request was made.'},
        ]})
        dimensions = {item['id']: item for item in result['dimensions']}
        self.assertNotIn('Python syntax:', '\n'.join(result['gaps']))
        self.assertNotIn('Python behavioral AST patterns:', '\n'.join(result['gaps']))
        self.assertNotIn('OSV dependencies:', '\n'.join(result['gaps']))
        self.assertTrue(any(item['label'] == 'AI authorship and production data'
                            for item in dimensions['source']['evidence']))
        self.assertEqual([item['label'] for item in dimensions['analysis']['evidence']],
                         ['AI contextual review'])
