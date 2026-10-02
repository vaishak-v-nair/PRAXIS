import json
import threading
import unittest
from unittest.mock import patch

from regen import provider


class ProviderProbeTests(unittest.TestCase):
    selection = {'provider': 'nvidia', 'model': 'fixture-model', 'input_price': 0, 'output_price': 0}

    def test_probe_checks_exact_response_and_never_persists_settings(self):
        with patch.object(provider, 'Model') as model, patch.object(provider.secrets, 'token_hex', return_value='random-challenge'), patch.object(provider, 'settings') as settings:
            model.return_value._call_once.return_value = {'content': json.dumps({'nonce': 'random-challenge', 'answer': 42})}
            result = provider.probe(self.selection)
            self.assertTrue(result['compatible'])
            self.assertEqual(model.call_args.kwargs['selection'], self.selection)
            self.assertEqual(model.call_args.args[0].limit, .05)
            settings.assert_not_called()
            self.assertNotIn('random-challenge', json.dumps(result))

    def test_static_reply_invalid_json_and_provider_errors_fail(self):
        for reply in ('{"status":"ok"}', '{"nonce":"old","answer":42}', 'not json'):
            with patch.object(provider, 'Model') as model:
                model.return_value._call_once.return_value = {'content': reply}
                self.assertFalse(provider.probe(self.selection)['compatible'])
        with patch.object(provider, 'Model', side_effect=provider.ProviderError('Unavailable')):
            result = provider.probe(self.selection)
            self.assertFalse(result['compatible'])
            self.assertEqual(result['detail'], 'Unavailable')

    def test_explicit_selection_does_not_read_or_mutate_default_settings(self):
        with patch.dict(provider.os.environ, {'NVIDIA_NIM_KEY': 'synthetic-key'}), patch.object(provider.Model, 'verify'), patch.object(provider, 'settings') as settings:
            model = provider.Model(provider.Budget(.05), threading.Event(), selection=self.selection)
            self.assertEqual(model.provider, 'nvidia')
            self.assertEqual(model.model, 'fixture-model')
            settings.assert_not_called()
