"""Behavioral contracts for collaboration; model agreement is never proof."""
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from regen import provider, team


class TeamTests(unittest.TestCase):
    def run_team(self, respond, *, budget=None, selections=None, cancelled=None, events=None, human_context=lambda: {}):
        events = [] if events is None else events
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'client.py').write_text('verify=False\n')
            class Model:
                def __init__(self, shared, stop, selection=None):
                    self.budget, self.cancelled = shared, stop
                    self.provider, self.model = selection['provider'], selection['model']
                def call(self, messages, max_tokens=2200):
                    return {'content': json.dumps(respond(self, messages[-1]['content']))}
            choices = selections if selections is not None else [{'provider': 'fixture', 'model': 'fixture'}]
            with patch.object(provider, 'Model', Model), patch.object(provider, 'configured_provider_selections', return_value=choices):
                scan = {'findings': [], 'coverage': []}
                result = team.analyze_team(root, scan, events.append, cancelled or threading.Event(), budget or provider.Budget(1), goal='Check the TLS client', human_context=human_context)
        return result, events

    @staticmethod
    def finding():
        return {'category': 'security', 'severity': 'high', 'confidence': 'confirmed',
                'title': 'TLS verification disabled', 'description': 'Certificate checks are disabled.',
                'why': 'Connections can be intercepted.', 'fix': 'Enable certificate checks.', 'fixable': True,
                'location': {'file': 'client.py', 'line': 1}, 'evidence': 'verify=False'}

    def test_parallel_specialists_share_one_budget_and_exchange_source_bound_reviews(self):
        barrier, budget, received = threading.Barrier(4), provider.Budget(1), []
        def respond(model, prompt):
            self.assertIs(model.budget, budget)
            if 'PEER_CHALLENGE' in prompt:
                shared = json.loads(prompt.split('SHARED_FINDINGS\n', 1)[1].split('\nSOURCE\n', 1)[0])
                received.append(shared)
                return {'reviews': [{'finding_id': shared[0]['id'], 'position': 'supports',
                                    'reason': 'The actual client disables verification.',
                                    'location': {'file': 'client.py', 'line': 1}, 'evidence': 'verify=False'}]}
            barrier.wait(timeout=5)
            return {'findings': [self.finding()], 'journeys': [], 'gaps': []}
        result, events = self.run_team(respond, budget=budget)
        self.assertEqual(len(received), 4)
        self.assertEqual(len(result['findings']), 1)
        self.assertEqual(result['findings'][0]['confidence'], 'likely')
        self.assertEqual(len(result['team']['discussions']), 4)
        self.assertEqual(result['team']['status'], 'complete')
        self.assertEqual(len(result['pressure_tests']), 4)
        self.assertTrue(any(event['team']['phase'] == 'peer_review' for event in events))
        self.assertNotIn('VERIFIED', json.dumps(result['team']))

    def test_invented_sources_and_unknown_finding_ids_cannot_become_peer_evidence(self):
        def respond(model, prompt):
            if 'PEER_CHALLENGE' in prompt:
                shared = json.loads(prompt.split('SHARED_FINDINGS\n', 1)[1].split('\nSOURCE\n', 1)[0])
                return {'reviews': [{'finding_id': shared[0]['id'], 'position': 'supports', 'reason': 'Safe',
                                     'location': {'file': '../escape', 'line': 1}, 'evidence': 'verify=False'},
                                    {'finding_id': 'invented', 'position': 'supports', 'reason': 'Safe',
                                     'location': {'file': 'client.py', 'line': 1}, 'evidence': 'verify=False'}]}
            return {'findings': [self.finding(), {**self.finding(), 'location': {'file': 'missing.py', 'line': 1}}],
                    'journeys': [{'name': 'Fake runtime', 'result': 'VERIFIED', 'evidence': 'All tests passed'}]}
        result, _ = self.run_team(respond)
        self.assertEqual(len(result['findings']), 1)
        self.assertEqual(result['team']['discussions'], [])
        self.assertTrue(all(agent['journeys'][0]['result'] == 'uncertain' for agent in result['pressure_tests']))

    def test_peer_disagreement_keeps_original_finding_and_labels_challenge(self):
        def respond(model, prompt):
            if 'PEER_CHALLENGE' in prompt:
                shared = json.loads(prompt.split('SHARED_FINDINGS\n', 1)[1].split('\nSOURCE\n', 1)[0])
                return {'reviews': [{'finding_id': shared[0]['id'], 'position': 'challenges', 'reason': 'May be a fixture.',
                                    'location': {'file': 'client.py', 'line': 1}, 'evidence': 'verify=False'}]}
            return {'findings': [self.finding()]}
        result, _ = self.run_team(respond)
        self.assertEqual(len(result['findings']), 1)
        self.assertEqual({item['position'] for item in result['team']['discussions']}, {'challenges'})

    def test_unavailable_provider_preserves_other_agents_and_static_findings(self):
        def respond(model, prompt):
            if model.provider == 'offline':
                raise provider.ProviderError('Provider unavailable')
            return {'findings': []}
        result, _ = self.run_team(respond, selections=[{'provider': 'online', 'model': 'a'}, {'provider': 'offline', 'model': 'b'}])
        self.assertEqual(result['team']['status'], 'partial')
        self.assertEqual(sum(a['status'] == 'unavailable' for a in result['team']['agents']), 2)
        self.assertTrue(any(c['status'] == 'skipped' for c in result['coverage']))

    def test_no_credentials_and_cancellation_make_no_model_calls(self):
        def unexpected(*args):
            self.fail('No model call was authorized')
        result, _ = self.run_team(unexpected, selections=[])
        self.assertEqual(result['team']['status'], 'unavailable')
        stop = threading.Event(); stop.set()
        result, _ = self.run_team(unexpected, cancelled=stop)
        self.assertEqual(result['team']['status'], 'cancelled')

    def test_budget_pause_publishes_completed_findings_before_raising(self):
        events = []
        # A budget exception must not masquerade as a completed collaboration.
        def respond(model, prompt):
            if 'PEER_CHALLENGE' in prompt:
                raise provider.BudgetExceeded('Limit reached')
            return {'findings': [self.finding()]}
        with self.assertRaises(provider.BudgetExceeded):
            self.run_team(respond, events=events)
        self.assertEqual(events[-1]['team']['status'], 'paused')
        self.assertEqual(len(events[-1]['findings']), 1)
        self.assertTrue(all(a['status'] == 'complete' for a in events[-1]['team']['agents']))

    def test_human_notes_are_shared_only_by_explicit_choice_and_never_become_proof(self):
        seen = []
        def respond(model, prompt):
            seen.append(prompt)
            self.assertNotIn('private-human-discussion', prompt)
            self.assertIn('shared-project-goal', prompt)
            return {'findings': [], 'VERIFIED': True}
        result, _ = self.run_team(respond, human_context=lambda: {'revision': 2, 'notes': [
            {'text': 'private-human-discussion', 'share_with_agents': False},
            {'text': 'shared-project-goal', 'share_with_agents': True}]})
        self.assertEqual(len(seen), 4)
        self.assertEqual(result['findings'], [])
        self.assertNotIn('VERIFIED', json.dumps(result))
        self.assertTrue(all(agent['shared_notes_seen'] == 1 for agent in result['team']['agents']))

    def test_addressed_notes_reach_only_the_chosen_specialist_and_cost_streams(self):
        seen = []
        def respond(model, prompt):
            seen.append(prompt)
            self.assertIn('shared-team-note', prompt)
            return {'findings': []}
        result, events = self.run_team(respond, budget=provider.Budget(1, spent=.12),
            human_context=lambda: {'notes': [
                {'text': 'shared-team-note', 'share_with_agents': True, 'assigned_to': 'team'},
                {'text': 'security-only-note', 'share_with_agents': True, 'assigned_to': 'agent-3'}]})
        self.assertEqual(sum('security-only-note' in prompt for prompt in seen), 1)
        self.assertEqual(result['team']['agents'][2]['shared_notes_seen'], 2)
        self.assertTrue(all(event['cost'] == .12 for event in events))


if __name__ == '__main__':
    unittest.main()
