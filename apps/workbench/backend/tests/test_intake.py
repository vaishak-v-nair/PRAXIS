import os
import threading
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from regen import scanner


class GithubIntakeTests(unittest.TestCase):
    def test_network_and_auth_failures_are_distinct_and_redacted(self):
        network = scanner.clone_failure({'status': 'failed', 'output': 'fatal: Failed to connect to github.com:443: Could not connect to server'})
        self.assertIn('unreachable', network)
        self.assertIn('restricted coding-agent', network)
        self.assertIn('upload', network)
        self.assertNotIn('Git credentials', network)
        auth = scanner.clone_failure({'status': 'failed', 'output': 'fatal: Authentication failed for https://user:secret123@github.com/a/b'})
        self.assertIn('Git credential manager', auth)
        self.assertNotIn('secret123', auth)

    def test_git_preserves_proxy_routing_without_forwarding_provider_secrets(self):
        with patch.dict(os.environ, {'HTTPS_PROXY': 'http://localhost:8888', 'GROQ_API_KEY': 'fixture-secret'}):
            self.assertEqual(scanner.git_env()['HTTPS_PROXY'], 'http://localhost:8888')
            self.assertNotIn('GROQ_API_KEY', scanner.git_env())
            self.assertNotIn('HTTPS_PROXY', scanner.child_env())

    def test_clone_normalizes_url_and_removes_failed_staging(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch.object(scanner, '_process', return_value={'status': 'failed', 'output': 'Failed to connect to github.com'}) as process:
                with self.assertRaisesRegex(ValueError, 'unreachable'):
                    scanner.prepare_project('https://github.com/owner/repo.git/', root / 'job', lambda _: None, threading.Event())
                self.assertEqual(process.call_args.args[0][5], 'https://github.com/owner/repo.git')
                self.assertFalse(list((root / 'job').glob('clone-*')))
