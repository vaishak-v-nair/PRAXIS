import json
import tempfile
import threading
import unittest
from pathlib import Path

from regen.harness import ExecutionHarness, verify_evidence


class HarnessTests(unittest.TestCase):
    def test_real_edit_has_hash_evidence_without_source_or_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file = root / 'app.py'
            file.write_text('private original source')
            harness = ExecutionHarness(root, 'Implementation repair',
                {'edit_file': lambda args: file.write_text(args['replace'])},
                lambda path: root / path, threading.Event())
            harness.execute('edit_file', {'path': 'app.py', 'replace': 'private replacement source'})
            records = harness.evidence
            self.assertNotEqual(records[0]['before'], records[0]['after'])
            self.assertEqual(records[0]['status'], 'completed')
            self.assertNotIn('private', json.dumps(records))
            self.assertTrue(verify_evidence(records))
            records[0]['status'] = 'invented_success'
            self.assertFalse(verify_evidence(records))
            self.assertEqual(harness.evidence[0]['status'], 'completed')

    def test_external_paths_and_ungranted_shell_are_denied_and_not_executed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'copy'
            root.mkdir()
            called = []
            harness = ExecutionHarness(root, 'Security repair', {'read_file': called.append},
                lambda path: root / path, threading.Event())
            for tool, path in [('run_shell', 'app.py'), ('read_file', '../private.py')]:
                with self.assertRaises(PermissionError):
                    harness.execute(tool, {'path': path, 'secret': 'must-never-be-recorded'})
            self.assertEqual(called, [])
            self.assertTrue(verify_evidence(harness.evidence))
            self.assertNotIn('must-never-be-recorded', json.dumps(harness.evidence))
            self.assertTrue(all(row['status'] == 'denied' for row in harness.evidence))

    def test_cancel_and_tool_limit_prevent_side_effects(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            event = threading.Event()
            called = []
            harness = ExecutionHarness(root, 'UI repair', {'read_file': called.append},
                lambda path: root / path, event, max_steps=1)
            harness.execute('read_file', {'path': 'app.py'})
            with self.assertRaises(RuntimeError):
                harness.execute('read_file', {'path': 'app.py'})
            event.set()
            with self.assertRaises(RuntimeError):
                harness.execute('read_file', {'path': 'app.py'})
            self.assertEqual(len(called), 1)

    def test_failures_are_recorded_without_exception_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            def fail(_):
                raise ValueError('a confidential credential in the exception')
            root = Path(directory)
            harness = ExecutionHarness(root, 'Data repair', {'create_file': fail},
                lambda path: root / path, threading.Event())
            with self.assertRaises(ValueError):
                harness.execute('create_file', {'path': 'app.py'})
            row = harness.evidence[0]
            self.assertEqual(row['status'], 'failed')
            self.assertEqual(row['error_category'], 'ValueError')
            self.assertNotIn('confidential', json.dumps(row))
