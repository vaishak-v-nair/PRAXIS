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
    def test_team_progress_is_durable_and_keeps_runtime_consent_separate(self):
        def collaborative(path, scan, emit, cancelled, budget, *, goal, human_context):
            self.assertEqual(goal, 'Check the setup workflow')
            self.assertEqual(human_context(), {})
            self.assertFalse((path / '.env').exists())
            scan['team'] = {'status': 'running', 'phase': 'inspection', 'agents': [], 'discussions': [], 'goal': goal}
            emit({'message': 'Team inspecting source', **scan})
            stored = api.store.all()[0]
            self.assertEqual(stored['team']['status'], 'running')
            self.assertTrue(stored['findings'])
            scan['team']['status'] = 'complete'
            return scan
        with patch('regen.team.analyze_team', side_effect=collaborative), patch('regen.sandbox.run_checks') as runtime:
            response = self.client.post('/api/scans', json={'source': str(self.source), 'review_mode': 'team',
                                                          'review_goal': 'Check the setup workflow'})
            self.assertEqual(response.status_code, 200)
            job = self.finish(response.json()['id'])
            runtime.assert_not_called()
        self.assertEqual(job['team']['status'], 'complete')
        self.assertEqual((self.source / 'app.py').read_text(), self.original)
        self.assertNotIn(self.secret, json.dumps(job))

    def test_team_budget_pause_retains_published_findings_and_peer_state(self):
        def limited(path, scan, emit, cancelled, budget, **kwargs):
            scan['team'] = {'status': 'paused', 'phase': 'peer_review', 'agents': [], 'discussions': []}
            emit({'message': 'Limit reached', **scan})
            raise provider.BudgetExceeded('Shared limit reached')
        with patch('regen.team.analyze_team', side_effect=limited):
            response = self.client.post('/api/scans', json={'source': str(self.source), 'review_mode': 'team'})
            job = self.finish(response.json()['id'])
        self.assertEqual(job['status'], 'paused')
        self.assertEqual(job['team']['status'], 'paused')
        self.assertTrue(job['findings'])

    def test_team_goal_is_bounded_before_work_starts(self):
        response = self.client.post('/api/scans', json={'source': str(self.source), 'review_mode': 'team', 'review_goal': 'x' * 4001})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(api.store.all(), [])

    def test_two_people_share_durable_notes_without_changing_evidence_or_permissions(self):
        job = self.scan()
        evidence = job['findings']
        for i, name in enumerate(('Alice', 'Bob')):
            response = self.client.post(f"/api/jobs/{job['id']}/collaboration", json={
                'session_id': ('a' if i == 0 else 'b') * 36, 'author': name, 'text': f'{name} asks to inspect setup',
                'kind': 'question', 'assigned_to': 'agent-2', 'share_with_agents': bool(i)})
            self.assertEqual(response.status_code, 200)
        updated = self.client.get(f"/api/jobs/{job['id']}").json()
        self.assertEqual(len(updated['collaboration']['notes']), 2)
        self.assertEqual(len(updated['collaboration']['participants']), 2)
        self.assertEqual(updated['findings'], evidence)
        self.assertEqual(updated['status'], 'complete')
        self.assertFalse(updated['collaboration']['notes'][0]['share_with_agents'])
        self.assertEqual((self.source / 'app.py').read_text(), self.original)

    def test_collaboration_limits_host_origin_and_redaction(self):
        job = self.scan()
        note = {'session_id': 'a' * 36, 'author': 'Alice', 'text': self.secret}
        path = f"/api/jobs/{job['id']}/collaboration"
        response = self.client.post(path, json=note)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(self.secret, response.text)
        self.assertEqual(self.client.post(path, json=note, headers={'Origin': 'https://untrusted.example'}).status_code, 403)
        self.assertEqual(self.client.post(path, json={**note, 'text': 'x' * 2001}).status_code, 422)
        self.assertEqual(self.client.post(path, json={**note, 'text': '  '}).status_code, 422)
        self.assertEqual(self.client.post(path, json={**note, 'assigned_to': '../execute'}).status_code, 422)

    def test_explicit_team_rereview_reads_notes_without_running_commands(self):
        job = self.scan()
        def rereview(path, scan, emit, cancelled, budget, **options):
            self.assertIn('human_context', options)
            return scan
        with patch('regen.team.analyze_team', side_effect=rereview) as agents, patch('regen.sandbox.run_checks') as runtime:
            response = self.client.post(f"/api/jobs/{job['id']}/team-review", json={})
            self.assertEqual(response.status_code, 200)
            self.finish(job['id'])
            agents.assert_called_once()
            runtime.assert_not_called()

    def test_public_history_gets_human_actions_without_mutating_saved_evidence(self):
        original = {'id': 'old-job', 'status': 'complete', 'snapshot': 'private-snapshot',
                    'checks_for': 'private-snapshot', 'assessment': {'version': 1},
                    'checks': [{'name': 'pip install .', 'kind': 'setup', 'status': 'failed',
                                'output': 'Traceback: package read timed out'}]}
        public = api.public_job(original)
        self.assertTrue(public['assessment']['attention_items'])
        self.assertNotIn('snapshot', public)
        self.assertEqual(original['assessment'], {'version': 1})
        self.assertIn('Traceback', public['checks'][0]['output'])
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
            patch.object(provider, 'plan_repair', side_effect=self.plan_repair),
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

    def make_fix(self, path, findings, emit, cancelled, budget, plan=None):
        self.fix_number += 1
        target = path.parent / f'fixed-{self.fix_number}'
        shutil.copytree(path, target)
        before = (path / 'app.py').read_text()
        after = before.replace('DEBUG = True', 'DEBUG = False')
        (target / 'app.py').write_text(after)
        diff = ''.join(difflib.unified_diff(before.splitlines(True), after.splitlines(True), fromfile='a/app.py', tofile='b/app.py'))
        return {'path': str(target), 'diff': diff, 'changes': ['app.py'], 'review': {'approved': True, 'summary': 'Reviewed; runtime checks still required.'}, 'cost': budget.spent, 'agents': [{'name': 'Fixture repair', 'status': 'complete'}]}

    def plan_repair(self, path, findings, source, emit, cancelled, budget):
        budget.reserve(.1)
        budget.settle(.1, .05)
        kind = 'github' if source.startswith('https://') else 'local'
        return {'id': 'a' * 24, 'finding_ids': [item['id'] for item in findings], 'source_kind': kind,
                'objective': 'Disable debug mode without changing normal behavior.', 'assumptions': [],
                'steps': [{'title': 'Change configuration', 'intent': 'Disable debug mode', 'files': ['app.py'],
                           'validation': 'Run the regression suite', 'risk': 'Startup behavior could change'}],
                'user_journeys': ['Start the application and inspect normal output'], 'unresolved': [],
                'delivery': {'method': 'guarded_local_apply' if kind == 'local' else 'patch_or_review_branch',
                             'summary': 'Fixture delivery'},
                'planner': {'provider': 'fixture', 'model': 'fixture'}, 'created_at': 1}

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

    def test_scan_can_skip_ai_and_run_authorized_container_checks(self):
        with patch.object(provider, 'analyze') as model, patch.object(api.sandbox, 'run_checks', return_value=[{'name': 'tests', 'kind': 'command', 'runtime': 'docker', 'status': 'failed', 'output': 'Real failure'}]) as checks:
            body = {'source': str(self.source), 'ai_review': False, 'run_checks': True}
            self.assertEqual(self.client.post('/api/scans', json=body).status_code, 403)
            model.assert_not_called()
            checks.assert_not_called()
            body.update(trust_confirmed=True, allow_network=True)
            response = self.client.post('/api/scans', json=body)
            self.assertEqual(response.status_code, 200)
            job = self.finish(response.json()['id'])
            model.assert_not_called()
            self.assertTrue(checks.call_args.kwargs['allow_network'])
            self.assertNotEqual(checks.call_args.args[0], self.source)
            self.assertEqual(job['assessment']['checks_failed'], 1)
            self.assertEqual(job['assessment']['status'], 'attention')
            self.assertEqual(job['cost'], 0)
            self.assertTrue(job['plan']['graph']['nodes'])

    def test_source_only_review_needs_no_provider_docker_or_execution_consent(self):
        with patch.object(provider, 'analyze') as model, patch.object(provider, 'configured_provider_selections', return_value=[]), \
                patch.object(scanner, 'run_checks') as host, patch.object(api.sandbox, 'run_checks') as container:
            response = self.client.post('/api/scans', json={
                'source': str(self.source), 'ai_review': False, 'run_checks': False})
            self.assertEqual(response.status_code, 200, response.text)
            job = self.finish(response.json()['id'])
            model.assert_not_called()
            host.assert_not_called()
            container.assert_not_called()
        self.assertEqual(job['status'], 'complete')
        self.assertTrue(job['findings'])
        self.assertEqual(job['checks'], [])
        self.assertEqual(job['cost'], 0)
        self.assertEqual(job['assessment']['implementation']['status'], 'not_established')
        self.assertNotEqual(job['assessment']['readiness']['status'], 'release_candidate')

    def test_source_only_and_ultra_review_retain_redacted_intent_without_exposing_fingerprint(self):
        goal = 'Check the checkout workflow. ' + self.secret
        for mode, ai in (('standard', False), ('ultra', True)):
            with self.subTest(mode=mode), patch.object(provider, 'analyze_deep', side_effect=lambda path, scan, *args: scan):
                response = self.client.post('/api/scans', json={
                    'source': str(self.source), 'ai_review': ai, 'review_mode': mode,
                    'review_goal': goal, 'run_checks': False})
                job = self.finish(response.json()['id'])
                self.assertEqual(job['review_goal'], 'Check the checkout workflow. [REDACTED]')
                self.assertNotIn(self.secret, json.dumps(api.store.get(job['id'])))
                self.assertNotIn('source_fingerprint', job)

    def test_missing_requested_provider_preserves_source_review_without_execution(self):
        with patch.object(provider, 'analyze', side_effect=provider.ProviderError('No provider key configured')):
            response = self.client.post('/api/scans', json={
                'source': str(self.source), 'ai_review': True, 'run_checks': False})
            job = self.finish(response.json()['id'])
        self.assertEqual(job['status'], 'complete')
        self.assertTrue(job['findings'])
        self.assertEqual(job['checks'], [])
        self.assertIn('No provider key configured', job['error'])
        model_coverage = next(item for item in job['coverage'] if item['name'] == 'AI contextual review')
        self.assertEqual(model_coverage['status'], 'skipped')

    def test_initial_scan_honors_explicit_trusted_host_and_streams_results_in_copy(self):
        streamed = [{'name': 'python -m unittest', 'kind': 'command', 'runtime': 'host',
                     'network': 'host', 'status': 'failed', 'output': 'Actual assertion failed'}]

        def execute(path, commands, emit, cancelled, **options):
            self.assertNotEqual(path, self.source)
            self.assertFalse((path / '.env').exists())
            options['on_result'](streamed)
            self.assertEqual(api.store.all()[0]['checks'], streamed)
            return streamed

        with patch.object(provider, 'analyze') as model, patch.object(scanner, 'run_checks', side_effect=execute) as host, \
                patch.object(api.sandbox, 'run_checks') as container:
            body = {'source': str(self.source), 'ai_review': False, 'run_checks': True,
                    'runtime_mode': 'host', 'trust_confirmed': False}
            self.assertEqual(self.client.post('/api/scans', json=body).status_code, 403)
            host.assert_not_called()
            body['trust_confirmed'] = True
            response = self.client.post('/api/scans', json=body)
            self.assertEqual(response.status_code, 200, response.text)
            job = self.finish(response.json()['id'])
            host.assert_called_once()
            container.assert_not_called()
            model.assert_not_called()
        self.assertEqual(job['checks'], streamed)
        self.assertEqual(job['assessment']['implementation']['status'], 'contradicted')
        self.assertEqual((self.source / 'app.py').read_text(), self.original)

    def test_invalid_initial_runtime_is_rejected_before_work(self):
        for runtime in ('auto', 'podman', '../host', None):
            with self.subTest(runtime=runtime):
                response = self.client.post('/api/scans', json={
                    'source': str(self.source), 'ai_review': False, 'runtime_mode': runtime})
                self.assertEqual(response.status_code, 422)
        self.assertEqual(api.store.all(), [])

    def test_fix_runtime_keeps_legacy_host_default_and_honors_explicit_docker(self):
        for runtime in (None, 'docker'):
            with self.subTest(runtime=runtime):
                job = self.scan()
                selected = next(f for f in job['findings'] if f['fixable'])['id']
                body = {'finding_ids': [selected], 'run_checks': True, 'trust_confirmed': True}
                if runtime:
                    body['runtime_mode'] = runtime
                results = [{'name': 'test', 'kind': 'command', 'runtime': runtime or 'host',
                            'status': 'passed', 'output': 'Executed tests passed'}]
                with patch.object(scanner, 'run_checks', return_value=results) as host, \
                        patch.object(api.sandbox, 'run_checks', return_value=results) as container:
                    self.assertEqual(self.client.post(f"/api/jobs/{job['id']}/fix", json={**body, 'trust_confirmed': False}).status_code, 403)
                    host.assert_not_called()
                    container.assert_not_called()
                    response = self.client.post(f"/api/jobs/{job['id']}/fix", json=body)
                    self.assertEqual(response.status_code, 200, response.text)
                    done = self.finish(job['id'])
                    chosen, other = (container, host) if runtime == 'docker' else (host, container)
                    chosen.assert_called_once()
                    other.assert_not_called()
                    self.assertNotEqual(chosen.call_args.args[0], self.source)
                    self.assertEqual(done['checks'], results)
        self.assertEqual((self.source / 'app.py').read_text(), self.original)

    def test_failed_host_execution_never_falls_back_to_docker(self):
        unavailable = [{'name': 'npm run test', 'kind': 'command', 'runtime': 'host',
                        'status': 'skipped', 'output': 'Executable unavailable: npm'}]
        with patch.object(scanner, 'run_checks', return_value=unavailable) as host, \
                patch.object(api.sandbox, 'run_checks') as container:
            response = self.client.post('/api/scans', json={
                'source': str(self.source), 'ai_review': False, 'run_checks': True,
                'trust_confirmed': True, 'runtime_mode': 'host'})
            job = self.finish(response.json()['id'])
            host.assert_called_once()
            container.assert_not_called()
        self.assertEqual(job['checks'][0]['status'], 'skipped')
        self.assertEqual(job['assessment']['implementation']['status'], 'not_established')

    def test_initial_host_cancellation_reaches_runner_and_preserves_source(self):
        entered = threading.Event()

        def execute(path, commands, emit, cancelled, **options):
            entered.set()
            self.assertTrue(cancelled.wait(5), 'Host runner did not receive cancellation')
            return [{'name': 'tests', 'kind': 'command', 'runtime': 'host',
                     'status': 'cancelled', 'output': 'Stopped before completion'}]

        with patch.object(scanner, 'run_checks', side_effect=execute), patch.object(api.sandbox, 'run_checks') as container:
            response = self.client.post('/api/scans', json={
                'source': str(self.source), 'ai_review': False, 'run_checks': True,
                'trust_confirmed': True, 'runtime_mode': 'host'})
            job_id = response.json()['id']
            self.assertTrue(entered.wait(5))
            self.assertEqual(self.client.post(f'/api/jobs/{job_id}/cancel', json={}).status_code, 200)
            self.assertEqual(self.finish(job_id)['status'], 'cancelled')
            container.assert_not_called()
        self.assertEqual((self.source / 'app.py').read_text(), self.original)

    def test_docker_verify_never_dispatches_to_host(self):
        job = self.scan()
        with patch.object(scanner, 'run_checks') as host, patch.object(api.sandbox, 'run_checks', return_value=[{'name': 'Docker', 'status': 'skipped', 'output': 'Unavailable'}]) as container:
            response = self.client.post(f"/api/jobs/{job['id']}/verify", json={'trust_confirmed': True, 'runtime_mode': 'docker'})
            self.assertEqual(response.status_code, 200)
            job = self.finish(job['id'])
            host.assert_not_called()
            container.assert_called_once()
            self.assertEqual(job['checks'][0]['status'], 'skipped')

    def test_network_cannot_be_enabled_without_authorized_execution(self):
        response = self.client.post('/api/scans', json={'source': str(self.source), 'allow_network': True})
        self.assertEqual(response.status_code, 422)

    def test_provider_probe_validates_selection_and_keeps_default_settings(self):
        with patch.object(provider, 'probe', return_value={'compatible': True, 'cost': .001}) as probe:
            payload = {'provider': 'groq', 'model': 'fixture-model', 'input_price': .000001, 'output_price': .000001}
            response = self.client.post('/api/providers/probe', json=payload)
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()['compatible'])
            self.assertEqual(probe.call_args.args[0], payload)
            self.assertEqual(self.client.post('/api/providers/probe', json={**payload, 'provider': 'unknown'}).status_code, 422)

    def test_provider_failure_keeps_static_findings_and_runs_requested_checks(self):
        with patch.object(provider, 'analyze', side_effect=provider.ProviderError('Provider unavailable')), patch.object(api.sandbox, 'run_checks', return_value=[{'name': 'test', 'status': 'passed', 'kind': 'command'}]) as checks:
            response = self.client.post('/api/scans', json={'source': str(self.source), 'run_checks': True, 'trust_confirmed': True})
            job = self.finish(response.json()['id'])
            self.assertEqual(job['status'], 'complete')
            self.assertTrue(job['findings'])
            self.assertIn('Provider unavailable', job['error'])
            checks.assert_called_once()

    def test_deep_review_mode_uses_pressure_agents_without_changing_execution_consent(self):
        def deep(path, scan, emit, cancelled, budget):
            return {**scan, 'pressure_tests': [{'agent': 'User journey agent', 'journeys': [], 'gaps': [], 'findings_added': 0}]}
        with patch.object(provider, 'analyze_deep', side_effect=deep) as review:
            response = self.client.post('/api/scans', json={'source': str(self.source), 'review_mode': 'deep'})
            self.assertEqual(response.status_code, 200, response.text)
            job = self.finish(response.json()['id'])
        review.assert_called_once()
        self.assertEqual(job['pressure_tests'][0]['agent'], 'User journey agent')

    def test_ultra_review_mode_uses_the_ensemble_path(self):
        def deep(path, scan, emit, cancelled, budget):
            return {**scan, 'pressure_tests': [{'agent': 'Production architecture agent', 'provider': 'fixture',
                                                'model': 'fixture', 'journeys': [], 'gaps': [], 'findings_added': 0}]}
        with patch.object(provider, 'analyze_deep', side_effect=deep) as review:
            response = self.client.post('/api/scans', json={'source': str(self.source), 'review_mode': 'ultra'})
            self.assertEqual(response.status_code, 200)
            job = self.finish(response.json()['id'])
        review.assert_called_once()
        self.assertEqual(job['pressure_tests'][0]['provider'], 'fixture')
        self.assertEqual(job['checks'], [])

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

    def test_large_folder_uploads_in_bounded_resumable_batches(self):
        size = 1024 * 1024
        begin = self.client.post('/api/uploads/sessions', json={
            'name': 'LargeProject', 'total_files': 21, 'total_bytes': 21 * size, 'skipped_files': 3})
        self.assertEqual(begin.status_code, 200, begin.text)
        token = begin.json()['upload_id']
        for offset in range(0, 21, 7):
            files = [{'path': f'LargeProject/src/file-{index}.js',
                      'content': base64.b64encode(b'x' * size).decode('ascii')}
                     for index in range(offset, min(offset + 7, 21))]
            response = self.client.post(f'/api/uploads/sessions/{token}/files', json={'files': files})
            self.assertEqual(response.status_code, 200, response.text)
        response = self.client.post(f'/api/uploads/sessions/{token}/complete', json={})
        self.assertEqual(response.status_code, 200, response.text)
        uploaded = response.json()
        self.assertEqual(uploaded['accepted_files'], 21)
        self.assertEqual(uploaded['accepted_bytes'], 21 * size)
        self.assertEqual(uploaded['skipped_files'], 3)
        project, name = api.uploaded_project(uploaded['source'], api.DATA)
        self.assertEqual(name, 'LargeProject')
        self.assertEqual((project / 'src/file-20.js').stat().st_size, size)

    def test_upload_session_rejects_cross_batch_duplicates_and_can_cancel(self):
        begin = self.client.post('/api/uploads/sessions', json={
            'name': 'Project', 'total_files': 2, 'total_bytes': 2, 'skipped_files': 0})
        token = begin.json()['upload_id']
        first = {'path': 'Project/app.py', 'content': base64.b64encode(b'a').decode('ascii')}
        self.assertEqual(self.client.post(f'/api/uploads/sessions/{token}/files', json={'files': [first]}).status_code, 200)
        duplicate = {'path': 'Project/APP.py', 'content': base64.b64encode(b'b').decode('ascii')}
        self.assertEqual(self.client.post(f'/api/uploads/sessions/{token}/files', json={'files': [duplicate]}).status_code, 422)
        self.assertEqual(self.client.post(f'/api/uploads/sessions/{token}/cancel', json={}).status_code, 200)
        self.assertFalse((api.DATA / 'upload-staging' / token).exists())

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

    def test_repair_plan_is_ai_generated_before_edits_and_bound_to_selection(self):
        job = self.scan()
        finding = next(item for item in job['findings'] if item['title'] == 'Debug mode is explicitly enabled')
        response = self.client.post(f"/api/jobs/{job['id']}/fix-plan", json={'finding_ids': [finding['id']]})
        self.assertEqual(response.status_code, 200, response.text)
        planned = self.finish(job['id'])
        self.assertEqual(planned['status'], 'complete')
        self.assertEqual(planned['fix_plan']['source_kind'], 'local')
        self.assertEqual(planned['fix_plan']['finding_ids'], [finding['id']])
        self.assertIsNone(planned['fix'])
        mismatch = self.client.post(f"/api/jobs/{job['id']}/fix", json={'finding_ids': [finding['id']], 'plan_id': 'b' * 24})
        self.assertEqual(mismatch.status_code, 409)
        response = self.client.post(f"/api/jobs/{job['id']}/fix", json={'finding_ids': [finding['id']], 'plan_id': planned['fix_plan']['id']})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.finish(job['id'])['status'], 'complete')
        self.assertEqual(provider.fix_project.call_args.kwargs['plan']['id'], planned['fix_plan']['id'])

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
