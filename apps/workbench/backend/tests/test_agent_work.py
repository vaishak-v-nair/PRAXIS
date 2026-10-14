"""Real API -> Node adapter -> subprocess -> copy -> durable task integration."""
import importlib
import json
import os
from pathlib import Path
import shutil
import unittest
from unittest.mock import patch

import test_project_api as fixtures
from regen import agent_work

api = importlib.import_module('regen.app')
NODE = shutil.which('node')


@unittest.skipUnless(NODE, 'Node required for real installed-agent integration')
class AgentWorkApiTests(unittest.TestCase):
    scan = fixtures.ProjectApiTests.scan
    task = fixtures.ProjectApiTests.task

    def setUp(self):
        fixtures.ProjectApiTests.setUp(self)
        self.entry = self.root / 'agent.cjs'
        self.entry.write_text("let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{if(require('fs').existsSync('.env')||require('fs').existsSync('.mcp.json')||process.env.GROQ_API_KEY||!s.includes('return 42'))process.exit(9);console.log('Plan: inspect app.py, then independently test answer().');});")
        self.env = patch.dict(os.environ, {'PRAXIS_NODE_EXECUTABLE': NODE,
            'PRAXIS_AGENT_ADAPTERS': json.dumps({'fixture': {'plan': [NODE, str(self.entry)]}}),
            'GROQ_API_KEY': 'gsk_' + 'p' * 35})
        self.env.start()

    def tearDown(self):
        fixtures.ProjectApiTests.tearDown(self)
        self.env.stop()

    def assigned(self, **kwargs):
        job = self.scan()
        job = self.task(job, assigned_to={'kind': 'agent', 'id': 'cli-fixture'}, share_with_agents=True, **kwargs)
        return job, job['coordination']['tasks'][0]['id']

    def run_agent(self, job, task_id, **overrides):
        current = self.client.get('/api/jobs/' + job['id']).json()
        return self.client.post(f"/api/jobs/{job['id']}/work/tasks/{task_id}/run-agent", json={
            'expected_revision': current['coordination']['revision'], 'tool': 'fixture',
            'trust_confirmed': True, 'external_spend_confirmed': True, **overrides})

    def finished(self, job):
        api.workers[job['id']].join(12)
        self.assertFalse(api.workers[job['id']].is_alive(), 'Agent worker hung')
        return self.client.get('/api/jobs/' + job['id']).json()

    def test_installed_discovery_and_real_plan_complete_without_claiming_verification(self):
        (self.source / '.mcp.json').write_text('{"mcpServers":{"untrusted":{"command":"never-run"}}}')
        discovery = self.client.get('/api/agents').json()
        self.assertTrue(next(a for a in discovery['agents'] if a['name'] == 'fixture')['installed'])
        self.assertTrue(all(a['authentication'] == 'not_checked' for a in discovery['agents']))
        job, task_id = self.assigned()
        findings, checks = job['findings'], job.get('checks')
        started = self.run_agent(job, task_id)
        self.assertEqual(started.status_code, 200, started.text)
        self.assertNotIn('agent_lease_token', json.dumps(api.store.get(job['id'])))
        done = self.finished(job)
        self.assertEqual(done['agent_run']['status'], 'completed', done.get('error'))
        self.assertEqual(done['agent_run']['exit_code'], 0)
        self.assertEqual(done['agent_run']['verification'], 'not_evaluated')
        self.assertEqual(done['coordination']['tasks'][0]['verification'], 'not_evaluated')
        self.assertEqual(done['coordination']['tasks'][0]['state'], 'completed')
        self.assertTrue(done['agent_run']['work_copy_unchanged'])
        self.assertEqual(done['agent_run']['source_coverage']['included_files'], 1)
        self.assertEqual(done['findings'], findings); self.assertEqual(done.get('checks'), checks)
        self.assertNotIn(self.secret, json.dumps(done))
        self.assertEqual((self.source / 'app.py').read_text(), self.original)
        self.assertFalse(any(self.data.rglob('agent-plan-*')))

    def test_missing_execution_or_spend_consent_and_arbitrary_commands_are_refused(self):
        job, task_id = self.assigned()
        for override in ({'trust_confirmed': False}, {'external_spend_confirmed': False}):
            self.assertEqual(self.run_agent(job, task_id, **override).status_code, 403)
        self.assertEqual(self.run_agent(job, task_id, argv=['powershell']).status_code, 422)
        self.assertEqual(self.run_agent(job, task_id, tool='claude').status_code, 403)
        self.assertEqual(self.client.get('/api/jobs/' + job['id']).json()['coordination']['tasks'][0]['state'], 'open')

    def test_unshared_stale_and_obsolete_revision_assignments_cannot_start(self):
        job, task_id = self.assigned()
        self.assertEqual(self.run_agent(job, task_id, expected_revision=0).status_code, 409)
        board = self.client.post(f"/api/jobs/{job['id']}/work/tasks/{task_id}", json={
            'expected_revision': job['coordination']['revision'], 'changes': {'share_with_agents': False}})
        self.assertEqual(board.status_code, 200, board.text)
        self.assertEqual(self.run_agent(job, task_id).status_code, 403)
        (self.source / 'app.py').write_text('def answer():\n    return -1\n')
        self.assertEqual(self.run_agent(job, task_id).status_code, 409)

    def test_success_looking_output_with_nonzero_exit_is_blocked_not_verified(self):
        self.entry.write_text("console.log('Everything is fixed and tested');process.exit(7)")
        job, task_id = self.assigned()
        self.assertEqual(self.run_agent(job, task_id).status_code, 200)
        done = self.finished(job)
        self.assertEqual(done['agent_run']['status'], 'failed')
        self.assertEqual(done['agent_run']['exit_code'], 7)
        self.assertEqual(done['coordination']['tasks'][0]['state'], 'blocked')
        self.assertEqual(done['agent_run']['verification'], 'not_evaluated')

    def test_adapter_writing_in_plan_mode_is_caught_and_original_preserved(self):
        self.entry.write_text("require('fs').writeFileSync('app.py','unexpected edit');console.log('A beautiful plan')")
        job, task_id = self.assigned()
        self.assertEqual(self.run_agent(job, task_id).status_code, 200)
        done = self.finished(job)
        self.assertEqual(done['agent_run']['status'], 'failed')
        self.assertFalse(done['agent_run']['work_copy_unchanged'])
        self.assertEqual(done['coordination']['tasks'][0]['state'], 'blocked')
        self.assertEqual((self.source / 'app.py').read_text(), self.original)

    def test_cancellation_kills_agent_tree_and_closes_owned_lease(self):
        self.entry.write_text('setInterval(()=>{},1000)')
        job, task_id = self.assigned()
        self.assertEqual(self.run_agent(job, task_id).status_code, 200)
        api.cancellations[job['id']].set()
        done = self.finished(job)
        self.assertEqual(done['status'], 'cancelled')
        self.assertNotEqual(done['coordination']['tasks'][0]['state'], 'completed')

    def test_bridge_failure_is_visible_and_no_agent_is_inferred(self):
        with patch.object(agent_work, 'bridge', side_effect=ValueError('missing bridge')):
            self.assertEqual(agent_work.available()['agents'], [])

    def test_worker_failure_releases_lease_and_never_exposes_resume_token(self):
        job, task_id = self.assigned()
        with patch.object(agent_work, 'run_plan', side_effect=OSError('private failure')):
            self.assertEqual(self.run_agent(job, task_id).status_code, 200)
            done = self.finished(job)
        self.assertEqual(done['agent_run']['status'], 'failed')
        self.assertEqual(done['coordination']['tasks'][0]['state'], 'blocked')
        self.assertIsNone(done['coordination']['tasks'][0]['lease'])
        self.assertIsNone(api.store.get(job['id'])['resume'])
