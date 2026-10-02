import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from regen.paths import runtime_paths
from regen import provider
from regen.scanner import child_env


class RuntimePathsTests(unittest.TestCase):
    def test_checkout_defaults_are_unchanged_and_resolution_is_inert(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(runtime_paths(root, {}), (root / '.regen', root / '.env'))
            self.assertEqual(list(root.iterdir()), [])

    def test_explicit_persistent_paths_do_not_migrate_old_data_or_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.env').write_text('fixture-only', encoding='utf-8')
            env = {'PRAXIS_WORKBENCH_DATA_DIR': str(root / 'data'),
                   'PRAXIS_WORKBENCH_ENV_FILE': str(root / 'provider.env')}
            self.assertEqual(runtime_paths(root / 'release', env), (root / 'data', root / 'provider.env'))
            self.assertFalse((root / 'data').exists())
            self.assertFalse((root / 'provider.env').exists())

    def test_relative_configuration_fails_instead_of_using_a_different_store(self):
        for name in ('PRAXIS_WORKBENCH_DATA_DIR', 'PRAXIS_WORKBENCH_ENV_FILE'):
            with self.assertRaisesRegex(ValueError, 'absolute path'):
                runtime_paths(Path.cwd(), {name: '../somewhere'})

    def test_provider_settings_use_the_same_persistent_data_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'provider.json').write_text('{"provider":"groq","model":"fixture-model"}', encoding='utf-8')
            with patch.dict('os.environ', {'PRAXIS_WORKBENCH_DATA_DIR': str(root)}, clear=True):
                self.assertEqual(provider.settings()['provider'], 'groq')
                self.assertEqual(provider.settings()['model'], 'fixture-model')
                # Project execution must not receive the private store or env path.
                self.assertNotIn('PRAXIS_WORKBENCH_DATA_DIR', child_env())
                self.assertNotIn('PRAXIS_WORKBENCH_ENV_FILE', child_env())
