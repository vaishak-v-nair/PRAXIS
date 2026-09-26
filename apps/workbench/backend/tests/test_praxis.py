"""The integrated app must preserve PRAXIS's private local-state boundary."""
import json
import tempfile
import threading
import unittest
from pathlib import Path

from regen.provider import source_context
from regen.scanner import prepare_project


class PraxisIntegrationTests(unittest.TestCase):
    def test_praxis_private_directories_are_not_snapshotted_or_sent_to_models(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / 'praxis'
            root.mkdir()
            (root / 'package.json').write_text(json.dumps({'name': 'praxis-memory'}))
            for relative in ['.praxis/memory.md', '.gstack/session.md', '.obsidian/config.json',
                             '.agents/local.md', '.claude/settings.json',
                             'Praxis Intelligence/private.md', 'assets/source/brand.md']:
                file = root / relative
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('PRIVATE_LOCAL_SENTINEL')
            (root / 'src').mkdir()
            (root / 'src/app.js').write_text('export const behavior = true;')
            (root / 'docs').mkdir()
            (root / 'docs/guide.md').write_text('PUBLIC_GUIDE_SENTINEL')
            prepared = prepare_project(str(root), base / 'job', lambda _: None, threading.Event())
            snapshot = Path(prepared['path'])
            context = source_context(snapshot)
            self.assertNotIn('PRIVATE_LOCAL_SENTINEL', context)
            self.assertIn('PUBLIC_GUIDE_SENTINEL', context)
            self.assertTrue((snapshot / 'src/app.js').is_file())
            self.assertFalse((snapshot / '.praxis').exists())
            self.assertTrue((root / '.praxis/memory.md').is_file(), 'original private data is preserved')

    def test_other_projects_keep_their_normal_assets_and_source(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / 'application'
            (root / 'assets').mkdir(parents=True)
            (root / 'package.json').write_text(json.dumps({'name': 'another-application'}))
            (root / 'assets/config.json').write_text('{"real_asset": true}')
            prepared = prepare_project(str(root), base / 'job', lambda _: None, threading.Event())
            self.assertTrue((Path(prepared['path']) / 'assets/config.json').is_file())


if __name__ == '__main__':
    unittest.main()
