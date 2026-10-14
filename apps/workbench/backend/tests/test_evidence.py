"""Official adapter boundaries: deterministic offline tests, no paid requests."""
import importlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from regen import evidence
from regen.store import Store

api = importlib.import_module('regen.app')


class EvidenceTests(unittest.TestCase):
    def test_unavailable_bridge_and_no_arbitrary_tools(self):
        with patch.object(evidence.shutil, 'which', return_value=None), patch.dict('os.environ', {}, clear=True):
            self.assertEqual(evidence.availability()['status'], 'unavailable')
        for body in ({'source': 'community', 'operation': 'schema'},
                     {'source': 'supabase', 'operation': 'schema', 'sql': 'DELETE FROM users'},
                     {'source': 'github', 'operation': 'pull-request', 'endpoint': 'https://evil.test'}):
            with self.assertRaises(ValueError):
                evidence.EvidenceInput.model_validate(body)

    def test_redacted_observation_and_snapshot_reference(self):
        secret = 'sk-proj-' + 'x' * 32
        with patch.object(evidence, '_bridge', return_value={'status': 'observed', 'records': [{'excerpt': secret}]}):
            result = evidence.collect(evidence.EvidenceInput(source='playwright', operation='snapshot'), snapshot_ref='snapshot-fixture')
        self.assertNotIn(secret, json.dumps(result))
        self.assertEqual(result['snapshot_ref'], 'snapshot-fixture')

    def test_authorization_and_freshness_preserve_local_verdict(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); source = root / 'copy'; source.mkdir()
            (source / 'app.py').write_text('print("real source")')
            store = Store(root / 'jobs.sqlite3')
            store.save({'id': 'job', 'created_at': '2026-10-06T00:00:00Z', 'source': str(source), 'status': 'complete', 'snapshot': str(source), 'findings': [], 'checks': []})
            with patch.object(api, 'store', store), TestClient(api.app) as client:
                route = '/api/jobs/job/evidence'
                body = {'source': 'playwright', 'operation': 'snapshot'}
                self.assertEqual(client.post(route, json=body).status_code, 403)
                with patch.object(evidence, 'collect', return_value={'status': 'unavailable', 'detail': 'not connected'}):
                    response = client.post(route, json={**body, 'authorized': True})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['external_evidence'][0]['status'], 'unavailable')
                self.assertEqual(store.get('job')['checks'], [])
                self.assertNotEqual(response.json()['assessment']['readiness']['status'], 'release_candidate')
                def changed(*args, **kwargs):
                    (source / 'app.py').write_text('print("source changed")')
                    return {'status': 'observed'}
                with patch.object(evidence, 'collect', side_effect=changed):
                    self.assertEqual(client.post(route, json={**body, 'authorized': True}).status_code, 409)
                self.assertEqual(len(store.get('job')['external_evidence']), 1)

    def test_untrusted_quoted_content_stays_redacted_valid_data(self):
        secret = 'sk-proj-' + 'q' * 32
        raw = {'status': 'observed', 'records': [{'excerpt': 'Quoted: "' + secret + '"\\\n', secret: [secret]}]}
        with patch.object(evidence, '_bridge', return_value=raw):
            result = evidence.collect(evidence.EvidenceInput(source='playwright', operation='snapshot'), snapshot_ref='fixture')
        self.assertNotIn(secret, json.dumps(result))
        self.assertEqual(result['status'], 'observed')
        self.assertEqual(raw['records'][0][secret], [secret], 'Original observation is not mutated')

    def test_service_authentication_is_required_in_protected_mode(self):
        with patch.dict('os.environ', {'PRAXIS_REVIEW_SERVICE_TOKEN': 'test-service-token', 'PRAXIS_REVIEW_SERVICE_INSTANCE': 'instance-fixture'}), TestClient(api.app) as client:
            self.assertEqual(client.get('/api/health').status_code, 401)
            self.assertEqual(client.get('/api/health', headers={'Authorization': 'Bearer wrong-token'}).status_code, 401)
            with patch.object(api.sandbox, 'health', return_value={'ready': False}):
                response = client.get('/api/health', headers={'Authorization': 'Bearer test-service-token'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['service_instance'], 'instance-fixture')
            self.assertNotIn('test-service-token', response.text)

    def test_transient_form_values_are_not_saved_or_reflected_by_validation(self):
        value = 'private form fixture'
        spec = {'name': 'Create item', 'steps': [{'action': 'navigate', 'path': '/'},
                {'action': 'fill', 'role': 'textbox', 'control_name': 'Title', 'value': value},
                {'action': 'click', 'role': 'button', 'control_name': 'Save'},
                {'action': 'assert_text', 'text': 'Saved'}]}
        result = api.durable_options({'journey': spec})
        self.assertNotIn(value, json.dumps(result))
        self.assertEqual(spec['steps'][1]['value'], value)
        with TestClient(api.app) as client:
            response = client.post('/api/jobs/missing/verify', json={'journey': {**spec, 'extra': value}})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(value, response.text)
