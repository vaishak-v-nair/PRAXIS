import tempfile
import unittest
from pathlib import Path

from regen.context import related_source_paths


class ContextRetrievalTests(unittest.TestCase):
    def test_selected_source_dependencies_and_callers_are_prioritized_without_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'config.py').write_text('MODEL = "example"')
            (root / 'rag.py').write_text('import config\nraise RuntimeError("must not execute")')
            (root / 'app.py').write_text('from rag import answer')
            (root / 'unrelated.py').write_text('x = 1')
            result = related_source_paths(root, ['rag.py'])
            self.assertEqual(result['paths'], ['rag.py', 'config.py', 'app.py'])
            self.assertFalse(result['limited'])

    def test_relative_package_imports_and_outside_modules(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / 'pkg'
            package.mkdir()
            (package / '__init__.py').write_text('')
            (package / 'config.py').write_text('x = 1')
            (package / 'app.py').write_text('from . import config\nfrom ... import outside')
            result = related_source_paths(root, ['pkg/app.py'])
            self.assertIn('pkg/config.py', result['dependencies'])
            self.assertTrue(all(not path.startswith('../') for path in result['paths']))

    def test_javascript_imports_resolve_local_extensions_and_index(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'app.tsx').write_text("import { save } from './api'; import '../../private';")
            (root / 'api').mkdir()
            (root / 'api/index.ts').write_text('export const save = () => 1;')
            result = related_source_paths(root, ['app.tsx'])
            self.assertEqual(result['dependencies'], ['api/index.ts'])

    def test_bounded_graph_reports_omissions_and_keeps_selected_first(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('a.py', 'b.py', 'selected.py'):
                (root / name).write_text('x = 1')
            result = related_source_paths(root, ['selected.py'], max_nodes=1)
            self.assertEqual(result['paths'], ['selected.py'])
            self.assertTrue(result['limited'])
            self.assertEqual(result['indexed_files'], 1)
