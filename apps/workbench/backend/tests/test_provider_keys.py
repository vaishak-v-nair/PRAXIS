import importlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from regen.provider_keys import save_key, provider_key, stored_keys
from regen import provider

api = importlib.import_module('regen.app')


class ProviderKeysTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = Path(self.temp.name)
        self.env = patch.dict(os.environ, {'PRAXIS_WORKBENCH_DATA_DIR': str(self.data)}, clear=True)
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_saved_key_is_available_to_provider_but_never_exposed_by_health(self):
        secret = 'fixture-credential-not-a-real-key'
        save_key('groq', secret, self.data)
        self.assertEqual(provider_key('groq', self.data), secret)
        result = provider.health()
        self.assertNotIn(secret, json.dumps(result))
        self.assertTrue(next(item for item in result['providers'] if item['name'] == 'groq')['configured'])
        self.assertFalse(next(item for item in result['providers'] if item['name'] == 'groq')['verified'])
        self.assertEqual(provider.clean('tool output ' + secret), 'tool output [REDACTED]')
        if os.name != 'nt':
            self.assertEqual((self.data / 'provider-keys.json').stat().st_mode & 0o777, 0o600)

    def test_environment_key_is_authoritative_and_is_never_overwritten(self):
        with patch.dict(os.environ, {'GROQ_API_KEY': 'original-fixture-key'}):
            with self.assertRaisesRegex(ValueError, 'environment key'):
                save_key('groq', 'replacement-fixture-key', self.data)
            self.assertEqual(provider_key('groq', self.data), 'original-fixture-key')
            self.assertFalse((self.data / 'provider-keys.json').exists())

    def test_invalid_and_corrupt_credentials_fail_without_echoing_values(self):
        for name, key in [('unknown', 'private-fixture-value'), ('groq', 'secret\nnew-line'), ('groq', 'short')]:
            with self.assertRaises(ValueError) as caught:
                save_key(name, key, self.data)
            self.assertNotIn(key, str(caught.exception))
        (self.data / 'provider-keys.json').write_text('not-json-private-value')
        with self.assertRaisesRegex(ValueError, 'could not be read'):
            stored_keys(self.data)

    def test_local_api_is_bounded_and_uses_generic_errors_without_secret_echo(self):
        with patch.object(api, 'DATA', self.data), patch.object(api, 'workers', {}):
            client = TestClient(api.app, base_url='http://127.0.0.1')
            secret = 'another-fixture-credential-not-real'
            response = client.post('/api/providers/key', json={'provider': 'groq', 'api_key': secret})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertNotIn(secret, response.text)
            self.assertEqual(provider_key('groq', self.data), secret)
            invalid = client.post('/api/providers/key', json={'provider': 'groq', 'api_key': 'private\nvalue'})
            self.assertEqual(invalid.status_code, 422)
            self.assertNotIn('private', invalid.text)
            too_large = client.post('/api/providers/key', content='x' * 9000, headers={'Content-Type': 'application/json'})
            self.assertEqual(too_large.status_code, 413)
            blocked = client.post('/api/providers/key', json={'provider': 'groq', 'api_key': secret}, headers={'Origin': 'https://untrusted.example'})
            self.assertEqual(blocked.status_code, 403)

    def test_key_changes_wait_for_active_reviews_and_provider_probes(self):
        class Worker:
            def is_alive(self):
                return True

        with patch.object(api, 'DATA', self.data), patch.object(api, 'workers', {'fixture': Worker()}):
            client = TestClient(api.app, base_url='http://127.0.0.1')
            body = {'provider': 'groq', 'api_key': 'fixture-not-a-real-credential'}
            self.assertEqual(client.post('/api/providers/key', json=body).status_code, 409)
            self.assertFalse((self.data / 'provider-keys.json').exists())
        with patch.object(api, 'DATA', self.data), patch.object(api, 'workers', {}):
            api.probe_slot.acquire()
            try:
                self.assertEqual(client.post('/api/providers/key', json=body).status_code, 409)
                self.assertFalse((self.data / 'provider-keys.json').exists())
            finally:
                api.probe_slot.release()
