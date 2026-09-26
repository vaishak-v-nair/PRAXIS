import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import httpx

from regen.provider import (Budget, BudgetExceeded, Model, ProviderError, WORKER_HISTORY_BYTES,
                            _history_bytes, analyze, apply_edit, clean, compact_worker_history,
                            create_file, fix_project, read_file, repair_worker, retry_delay, source_context)
from regen.scanner import _process


class RepairModel:
    def __init__(self, *args):
        self.model = 'test-model'

    def call(self, messages, tools=None, max_tokens=2200):
        if not tools:
            return {'role': 'assistant', 'content': json.dumps({'summary': 'Reviewed changes', 'concerns': [], 'approved': True})}
        if messages[-1]['role'] == 'tool':
            return {'role': 'assistant', 'content': '{"summary":"TLS verification enabled."}'}
        return {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'edit-1', 'type': 'function', 'function': {'name': 'edit_file', 'arguments': json.dumps({'path': 'client.py', 'search': 'verify=False', 'replace': 'verify=True'})}}]}


class ProviderSafetyTests(unittest.TestCase):
    def request_model(self):
        model = object.__new__(Model)
        model.budget = Budget(1)
        model._test_clock = [0.0]
        model.cancelled = threading.Event()
        model.model = 'test-model'
        model.base = 'https://provider.invalid/v1'
        model.headers = {}
        model.input_price = model.output_price = .000001
        return model

    def test_rate_limit_retry_releases_budget_and_gate_then_charges_success_once(self):
        model = self.request_model()
        model._dispatch = threading.BoundedSemaphore(1)
        events = []
        def progress(event):
            self.assertEqual(model.budget.reserved, 0)
            self.assertEqual(model.budget.spent, 0)
            self.assertTrue(model._dispatch.acquire(blocking=False))
            model._dispatch.release()
            events.append(event)
        model.emit = progress
        responses = [httpx.Response(429, headers={'Retry-After': '2.5'}, json={'error': 'confidential-quota-details'}),
                     httpx.Response(200, json={'usage': {'prompt_tokens': 100, 'completion_tokens': 10},
                                              'choices': [{'message': {'role': 'assistant', 'content': '{"summary":"done"}'}}]})]
        with patch('regen.provider.httpx.Client') as client, patch.object(model.cancelled, 'wait', side_effect=lambda delay: advance_clock(model, delay)) as wait, patch('regen.provider.time.monotonic', side_effect=lambda: model._test_clock[0]):
            post = client.return_value.__enter__.return_value.post
            post.side_effect = responses
            result = model.call([{'role': 'user', 'content': 'Review source'}])
        self.assertIn('done', result['content'])
        self.assertEqual(post.call_count, 2)
        wait.assert_called_once_with(2.5)
        self.assertAlmostEqual(model.budget.spent, .000110)
        self.assertEqual(model.budget.reserved, 0)
        self.assertEqual([call.kwargs['json']['model'] for call in post.call_args_list], ['test-model', 'test-model'])
        self.assertNotIn('confidential-quota-details', json.dumps(events))

    def test_rate_limit_exhaustion_has_three_requests_two_bounded_waits_and_zero_cost(self):
        model = self.request_model()
        with patch('regen.provider.httpx.Client') as client, patch.object(model.cancelled, 'wait', side_effect=lambda delay: advance_clock(model, delay)) as wait, patch('regen.provider.time.monotonic', side_effect=lambda: model._test_clock[0]):
            post = client.return_value.__enter__.return_value.post
            post.return_value = httpx.Response(429)
            with self.assertRaisesRegex(ProviderError, 'two bounded retries'):
                model.call([{'role': 'user', 'content': 'Review source'}])
        self.assertEqual(post.call_count, 3)
        self.assertEqual([call.args[0] for call in wait.call_args_list], [10, 20])
        self.assertEqual(model.budget.spent, 0)
        self.assertEqual(model.budget.reserved, 0)

    def test_cancellation_interrupts_rate_wait_without_retry_or_cost(self):
        model = self.request_model()
        model.emit = lambda event: model.cancelled.set()
        with patch('regen.provider.httpx.Client') as client, patch.object(model.cancelled, 'wait', wraps=model.cancelled.wait) as wait, patch('regen.provider.time.monotonic', side_effect=lambda: model._test_clock[0]):
            post = client.return_value.__enter__.return_value.post
            post.return_value = httpx.Response(429, headers={'Retry-After': '100000'})
            with self.assertRaisesRegex(ProviderError, 'Cancelled while waiting'):
                model.call([{'role': 'user', 'content': 'Review source'}])
        self.assertEqual(post.call_count, 1)
        wait.assert_called_once_with(60)
        self.assertEqual(model.budget.spent, 0)
        self.assertEqual(model.budget.reserved, 0)

    def test_retry_after_accepts_only_finite_nonnegative_numeric_bounded_delays(self):
        for value in (None, 'bad', 'NaN', 'Infinity', '-1', 'Wed, 01 Jan 2025 12:00:00 GMT'):
            with self.subTest(header=value):
                self.assertEqual(retry_delay(value, 0), 10)
                self.assertEqual(retry_delay(value, 1), 20)
        self.assertEqual(retry_delay('0', 0), 0)
        self.assertEqual(retry_delay('1.5', 0), 1.5)
        self.assertEqual(retry_delay('3600', 0), 60)

    def test_ambiguous_network_failure_is_not_retried_and_retains_conservative_cost(self):
        model = self.request_model()
        with patch('regen.provider.httpx.Client') as client, patch.object(model.cancelled, 'wait') as wait:
            post = client.return_value.__enter__.return_value.post
            post.side_effect = httpx.ReadTimeout('confidential-provider-echo')
            with self.assertRaises(ProviderError) as error:
                model.call([{'role': 'user', 'content': 'Review source'}])
        self.assertEqual(post.call_count, 1)
        wait.assert_not_called()
        self.assertGreater(model.budget.spent, 0)
        self.assertEqual(model.budget.reserved, 0)
        self.assertNotIn('confidential-provider-echo', str(error.exception))

    def test_serial_dispatch_bounds_parallel_remote_requests(self):
        model = self.request_model()
        model._dispatch = threading.BoundedSemaphore(1)
        first_started = threading.Event()
        release_first = threading.Event()
        lock = threading.Lock()
        state = {'active': 0, 'peak': 0, 'calls': 0}
        def request(*args):
            with lock:
                state['active'] += 1
                state['calls'] += 1
                state['peak'] = max(state['peak'], state['active'])
                first = state['calls'] == 1
            if first:
                first_started.set()
                release_first.wait(2)
            with lock:
                state['active'] -= 1
            return {'role': 'assistant', 'content': 'done'}
        with patch.object(model, '_call_once', side_effect=request), ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(model.call, [{'role': 'user', 'content': 'first'}])
            self.assertTrue(first_started.wait(1))
            second = pool.submit(model.call, [{'role': 'user', 'content': 'second'}])
            release_first.set()
            self.assertEqual(first.result()['content'], 'done')
            self.assertEqual(second.result()['content'], 'done')
        self.assertEqual(state['calls'], 2)
        self.assertEqual(state['peak'], 1)

    def test_explicit_payload_rejection_releases_reservation_without_cost_or_echo(self):
        model = object.__new__(Model)
        model.budget = Budget(1)
        model._test_clock = [0.0]
        model.cancelled = threading.Event()
        model.model = 'test-model'
        model.base = 'https://provider.invalid/v1'
        model.headers = {}
        model.input_price = model.output_price = .000001
        with patch('regen.provider.httpx.Client') as client:
            client.return_value.__enter__.return_value.post.return_value = httpx.Response(413, json={'error': 'confidential-provider-echo'})
            with self.assertRaises(ProviderError) as error:
                model.call([{'role': 'user', 'content': 'Review repository'}])
        self.assertTrue(error.exception.payload_too_large)
        self.assertEqual(model.budget.spent, 0)
        self.assertEqual(model.budget.reserved, 0)
        self.assertNotIn('confidential-provider-echo', str(error.exception))

    def test_nvidia_requests_disable_thinking_for_json_budget(self):
        model = self.request_model()
        model.provider = 'nvidia'
        with patch('regen.provider.httpx.Client') as client:
            post = client.return_value.__enter__.return_value.post
            post.return_value = httpx.Response(200, json={'usage': {'prompt_tokens': 10, 'completion_tokens': 4},
                                                         'choices': [{'message': {'role': 'assistant', 'content': '{"status":"ok"}'}}]})
            result = model.call([{'role': 'user', 'content': 'Return JSON'}], max_tokens=64)
        body = post.call_args.kwargs['json']
        self.assertEqual(result['content'], '{"status":"ok"}')
        self.assertEqual(body['response_format'], {'type': 'json_object'})
        self.assertEqual(body['chat_template_kwargs'], {'enable_thinking': False})

    def test_worker_retries_payload_rejection_once_with_same_model_and_less_context(self):
        class PayloadModel:
            def __init__(self):
                self.requests = []
            def call(self, messages, tools=None, **kwargs):
                self.requests.append(json.loads(json.dumps(messages)))
                if len(self.requests) == 1:
                    error = ProviderError('HTTP 413')
                    error.payload_too_large = True
                    raise error
                return {'role': 'assistant', 'content': '{"summary":"Reviewed compact input."}'}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'app.py').write_text('# source\n' * 1500)
            model = PayloadModel()
            result = repair_worker(model, root, [{'id': 'selected', 'location': {'file': 'app.py'}}], lambda _: None, threading.Event(), 'Specialist')
            self.assertEqual(len(model.requests), 2)
            self.assertLess(_history_bytes(model.requests[1]), _history_bytes(model.requests[0]))
            self.assertEqual(model.requests[1][:2], model.requests[0][:2])
            self.assertIn('compact input', result['summary'])

    def test_second_payload_rejection_and_ambiguous_timeout_are_not_retried(self):
        class FailingModel:
            def __init__(self, payload):
                self.calls = 0
                self.payload = payload
            def call(self, *args, **kwargs):
                self.calls += 1
                error = ProviderError('Request failed')
                if self.payload:
                    error.payload_too_large = True
                raise error
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'app.py').write_text('print(1)\n')
            for payload, expected_calls in ((True, 2), (False, 1)):
                model = FailingModel(payload)
                with self.subTest(payload=payload), self.assertRaises(ProviderError):
                    repair_worker(model, root, [{'location': {'file': 'app.py'}}], lambda _: None, threading.Event(), 'Specialist')
                self.assertEqual(model.calls, expected_calls)

    def test_growing_tool_history_is_bounded_and_preserves_complete_reasoning_cycles(self):
        class CyclingModel:
            def __init__(self):
                self.requests = []
                self.responses = []
            def call(self, messages, tools=None, **kwargs):
                self.requests.append(json.loads(json.dumps(messages)))
                index = len(self.requests)
                if index > 6:
                    return {'role': 'assistant', 'content': '{"summary":"Completed bounded review."}'}
                response = {'role': 'assistant', 'content': None, 'reasoning_content': 'reasoning-' + 'r' * 6000,
                            'tool_calls': [{'id': f'read-{index}', 'type': 'function', 'function': {'name': 'read_file', 'arguments': '{"path":"app.py"}'}}]}
                self.responses.append(response)
                return response
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'app.py').write_text('# source line\n' * 2500)
            model = CyclingModel()
            repair_worker(model, root, [{'location': {'file': 'app.py'}}], lambda _: None, threading.Event(), 'Specialist')
            self.assertEqual(len(model.requests), 7)
            for index, request in enumerate(model.requests):
                self.assertLessEqual(_history_bytes(request), WORKER_HISTORY_BYTES)
                assistants = [item for item in request if item['role'] == 'assistant']
                if index:
                    self.assertEqual(assistants, [model.responses[index - 1]])
                    expected = [call['id'] for call in assistants[0]['tool_calls']]
                    observed = [item['tool_call_id'] for item in request if item['role'] == 'tool']
                    self.assertEqual(observed, expected)
                self.assertEqual(request[:2], model.requests[0][:2])

    def test_incomplete_tool_cycle_cannot_be_compacted_or_sent_as_orphan_history(self):
        messages = [{'role': 'system', 'content': 'Rules'}, {'role': 'user', 'content': 'Selected issues'},
                    {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'missing-tool-result'}]}]
        with self.assertRaises(ProviderError):
            compact_worker_history(messages, set(), force=True)

    def test_force_compaction_can_reduce_already_compacted_latest_cycle(self):
        assistant = {'role': 'assistant', 'content': None, 'reasoning_content': 'r' * 6000,
                     'tool_calls': [{'id': 'read-1', 'type': 'function', 'function': {'name': 'read_file', 'arguments': '{"path":"app.py"}'}}]}
        messages = [{'role': 'system', 'content': 'Rules'}, {'role': 'user', 'content': 'Selected issues'}, assistant,
                    {'role': 'tool', 'tool_call_id': 'read-1', 'content': '# source' * 1000}]
        compact = compact_worker_history(messages, set(), force=True, max_bytes=10000)
        self.assertLess(_history_bytes(compact), _history_bytes(messages))
        self.assertLessEqual(_history_bytes(compact), 10000)
        self.assertEqual(compact[3], assistant)
        self.assertEqual(compact[4]['tool_call_id'], 'read-1')

    def test_selected_files_precede_support_files_in_focused_context(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'a.py').write_text('# unrelated source\n' * 2000)
            (root / 'z.py').write_text('SELECTED_FILE_IS_FIRST = True\n')
            context = source_context(root, limit=1000, priority_paths=['z.py'])
            self.assertTrue(context.startswith('FILE z.py\n'))
            self.assertIn('SELECTED_FILE_IS_FIRST', context)

    def test_small_codebase_context_includes_complete_large_files_and_requirements(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = '# source\n' * 1000 + 'LAST_SOURCE_LINE = True\n'
            (root / 'app.py').write_text(source)
            (root / 'requirements.txt').write_text('streamlit>=1.40.0\n')
            report = {}
            context = source_context(root, report=report)
            self.assertIn(source, context)
            self.assertIn('streamlit>=1.40.0', context)
            self.assertEqual(report['included_files'], 2)
            self.assertEqual(report['truncated_files'], 0)
            self.assertEqual(report['omitted_files'], 0)

    def test_source_context_accepts_relative_project_paths(self):
        with tempfile.TemporaryDirectory(dir='.') as directory:
            root = Path(directory)
            (root / 'app.py').write_text('RELATIVE_PATH_WORKS = True\n')
            self.assertIn('RELATIVE_PATH_WORKS = True', source_context(root))

    def test_bounded_context_reports_omissions_and_never_exposes_partial_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            secret = 'sk-proj-' + 'q' * 32
            (root / 'a.py').write_text('#' * 300 + f'\nAPI_KEY="{secret}"\n' + '#' * 300)
            (root / 'b.py').write_text('SECOND_FILE = True\n' * 100)
            report = {}
            context = source_context(root, limit=500, report=report)
            self.assertNotIn(secret, context)
            self.assertNotIn('q' * 12, context)
            self.assertGreater(report['truncated_files'] + report['omitted_files'], 0)
            self.assertIn('CONTEXT COVERAGE', context)
            self.assertIn('not fully reviewed', context)

    def test_raw_python_parser_rejects_hallucinated_syntax_finding_only(self):
        def finding(title):
            return {'title': title, 'category': 'implementation', 'severity': 'high', 'confidence': 'confirmed',
                    'description': title, 'why': 'Startup would fail', 'fix': 'Repair configuration',
                    'evidence': 'missing.append("GEMINI_API_KEY")', 'location': {'file': 'config.py', 'line': 3}, 'fixable': True}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = 'GEMINI_API_KEY = ""\nmissing = []\nif not GEMINI_API_KEY:\n    missing.append("GEMINI_API_KEY")\n'
            (root / 'config.py').write_text(source)
            model = RepairModel()
            model.call = lambda *args, **kwargs: {'content': json.dumps({'findings': [finding('Configuration contains syntax errors'), finding('Configuration lacks explicit production defaults')]})}
            with patch('regen.provider.Model', return_value=model):
                result = analyze(root, {'findings': [], 'coverage': []}, lambda _: None, threading.Event(), Budget(1))
            self.assertEqual([item['title'] for item in result['findings']], ['Configuration lacks explicit production defaults'])
            self.assertIn('Discarded 1 Python syntax claims', result['coverage'][-1]['detail'])

    def test_actual_invalid_python_syntax_is_not_silently_filtered(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'bad.py').write_text('def broken(:\n')
            item = {'title': 'Python syntax error', 'description': 'Invalid syntax', 'why': 'Cannot start', 'fix': 'Fix function declaration',
                    'location': {'file': 'bad.py', 'line': 1}, 'category': 'implementation', 'evidence': 'def broken(:'}
            model = RepairModel()
            model.call = lambda *args, **kwargs: {'content': json.dumps({'findings': [item]})}
            with patch('regen.provider.Model', return_value=model):
                result = analyze(root, {'findings': []}, lambda _: None, threading.Event(), Budget(1))
            self.assertEqual(len(result['findings']), 1)

    def test_create_file_rejects_traversal_credentials_overwrite_and_invalid_python(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            touched = set()
            for relative in ('../outside.py', '/outside.py', 'C:/outside.py', 'tests/../outside.py', '.env', '.ENV.local', '.git/config', '.GIT/config', '.git./config', 'node_modules/x.py', 'CON.py', 'tests\\bad.py'):
                with self.subTest(path=relative), self.assertRaises(ValueError):
                    create_file(root, {'path': relative, 'content': 'print(1)\n'}, touched)
            with self.assertRaises(ValueError):
                create_file(root, {'path': 'secret.py', 'content': 'API_KEY="sk-proj-' + 'a' * 32 + '"'}, touched)
            with self.assertRaises(ValueError):
                create_file(root, {'path': 'bad.py', 'content': 'def broken(:\n'}, touched)
            create_file(root, {'path': 'tests/test_rules.py', 'content': 'assert True\n'}, touched)
            with self.assertRaises(ValueError):
                create_file(root, {'path': 'tests/test_rules.py', 'content': 'assert False\n'}, touched)
            self.assertEqual((root / 'tests/test_rules.py').read_text(), 'assert True\n')
            self.assertEqual(touched, {'tests/test_rules.py'})

    def test_python_edit_cannot_leave_source_with_invalid_syntax(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'app.py').write_text('def valid():\n    return True\n')
            with self.assertRaises(ValueError):
                apply_edit(root, {'path': 'app.py', 'search': 'def valid():', 'replace': 'def valid(:'}, set())
            self.assertIn('def valid():', (root / 'app.py').read_text())

    def test_large_file_reads_are_redacted_before_chunking_and_have_continuation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            secret = 'sk-proj-' + 'a' * 32
            (root / 'large.py').write_text('#' * 23990 + '\nAPI_KEY="' + secret + '"\nTAIL = True\n')
            first = read_file(root, {'path': 'large.py'})
            second = read_file(root, {'path': 'large.py', 'offset': 24000})
            self.assertIn('continue read_file with offset=24000', first)
            self.assertNotIn(secret, first + second)
            self.assertNotIn('a' * 12, first + second)
            self.assertIn('TAIL = True', second)

    def test_assistant_reasoning_is_preserved_for_next_tool_turn(self):
        class ReasoningModel:
            def __init__(self):
                self.first_response = {'role': 'assistant', 'content': None, 'reasoning_content': 'Read the source before editing.',
                                       'tool_calls': [{'id': 'read-1', 'type': 'function', 'function': {'name': 'read_file', 'arguments': '{"path":"client.py"}'}}]}
            def call(self, messages, tools=None, **kwargs):
                if messages[-1]['role'] == 'tool':
                    self.history = messages[-2]
                    return {'role': 'assistant', 'content': '{"summary":"Reviewed source."}'}
                return self.first_response
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'client.py').write_text('print(1)\n')
            model = ReasoningModel()
            repair_worker(model, root, [{'location': {'file': 'client.py'}}], lambda _: None, threading.Event(), 'Specialist')
            self.assertEqual(model.history, model.first_response)

    def test_new_agent_files_are_in_integrated_diff_and_review_branch(self):
        class CreatingModel(RepairModel):
            def call(self, messages, tools=None, **kwargs):
                if tools and messages[-1]['role'] != 'tool':
                    return {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'create-1', 'type': 'function', 'function': {'name': 'create_file', 'arguments': json.dumps({'path': 'tests/test_client.py', 'content': 'import unittest\nclass ClientTests(unittest.TestCase):\n    def test_contract(self):\n        self.assertEqual(2 + 2, 4)\n'})}}]}
                return super().call(messages, tools, **kwargs)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'project'
            root.mkdir()
            (root / 'client.py').write_text('print(1)\n')
            with patch('regen.provider.Model', CreatingModel):
                result = fix_project(root, [{'location': {'file': 'client.py'}}], lambda _: None, threading.Event(), Budget(1))
            self.assertEqual(result['changes'], ['tests/test_client.py'])
            self.assertIn('--- /dev/null', result['diff'])
            self.assertIn('+++ b/tests/test_client.py', result['diff'])
            self.assertTrue((Path(result['path']) / 'tests/test_client.py').is_file())
            self.assertFalse((root / 'tests/test_client.py').exists())
            self.assertTrue((Path(result['branch_path']) / 'tests/test_client.py').is_file())

    def test_empty_new_package_files_are_listed_and_exported_in_patch(self):
        class EmptyFileModel(RepairModel):
            def call(self, messages, tools=None, **kwargs):
                if tools and messages[-1]['role'] != 'tool':
                    return {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'create-1', 'type': 'function', 'function': {'name': 'create_file', 'arguments': '{"path":"tests/__init__.py","content":""}'}}]}
                return super().call(messages, tools, **kwargs)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'project'
            root.mkdir()
            (root / 'app.py').write_text('print(1)\n')
            with patch('regen.provider.Model', EmptyFileModel):
                result = fix_project(root, [{'location': {'file': 'app.py'}}], lambda _: None, threading.Event(), Budget(1))
            self.assertEqual(result['changes'], ['tests/__init__.py'])
            self.assertIn('new file mode 100644', result['diff'])
            self.assertTrue((Path(result['branch_path']) / 'tests/__init__.py').is_file())
            patch_path = Path(result['path']).parent / (Path(result['path']).name + '.patch')
            check = _process(['git', 'apply', '--check', str(patch_path)], root, threading.Event(), 30)
            self.assertEqual(check['status'], 'passed', check['output'])
            applied = _process(['git', 'apply', str(patch_path)], root, threading.Event(), 30)
            self.assertEqual(applied['status'], 'passed', applied['output'])
            self.assertTrue((root / 'tests/__init__.py').is_file())

    def test_secret_line_can_be_fixed_without_disclosing_secret_to_agent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            secret = 'sk-proj-' + 'a' * 32
            file = root / 'config.py'
            file.write_text('API_KEY = "' + secret + '"\n')
            redacted = clean(file.read_text())
            self.assertNotIn(secret, redacted)
            touched = set()
            apply_edit(root, {'path': 'config.py', 'search': redacted, 'replace': 'API_KEY = os.environ["PROJECT_API_KEY"]\n'}, touched)
            self.assertNotIn(secret, file.read_text())
            self.assertEqual(touched, {'config.py'})

    def test_provider_tool_rejection_recovers_with_same_model_json_edits(self):
        class RecoveringModel(RepairModel):
            def call(self, messages, tools=None, **kwargs):
                if tools:
                    error = ProviderError('Tool syntax rejected')
                    error.tool_generation_failed = True
                    raise error
                if 'Repair only selected' in messages[-1]['content']:
                    return {'content': json.dumps({'edits': [{'path': 'client.py', 'search': 'verify=False', 'replace': 'verify=True'}], 'summary': 'TLS verification enabled.'})}
                return super().call(messages, **kwargs)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'project'
            root.mkdir()
            (root / 'client.py').write_text('verify=False\n')
            with patch('regen.provider.Model', RecoveringModel):
                result = fix_project(root, [{'location': {'file': 'client.py'}}], lambda _: None, threading.Event(), Budget(1))
            self.assertNotIn('error', result)
            self.assertEqual(result['changes'], ['client.py'])
            self.assertIn('verify=True', (Path(result['path']) / 'client.py').read_text())

    def test_json_credentials_embedded_private_keys_and_nim_keys_are_redacted(self):
        secret = 'nvapi-' + 'q' * 40
        text = '{"password":"private-password"}\n' + secret + '\n-----BEGIN PRIVATE KEY-----\nPRIVATECONTENTS\n-----END PRIVATE KEY-----'
        output = clean(text)
        self.assertNotIn('private-password', output)
        self.assertNotIn(secret, output)
        self.assertNotIn('PRIVATECONTENTS', output)

    def test_concurrent_requests_cannot_overreserve_budget(self):
        budget = Budget(1)
        barrier = threading.Barrier(3)
        def reserve():
            barrier.wait()
            try:
                budget.reserve(.6)
                return True
            except BudgetExceeded:
                return False
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(lambda _: reserve(), range(3)))
        self.assertEqual(sum(results), 1)
        self.assertLessEqual(budget.reserved, budget.limit)

    def test_full_artifact_redaction_preserves_length(self):
        text = 'x' * 30000 + 'sk-proj-' + 'a' * 32
        self.assertTrue(clean(text).startswith('x' * 30000))
        self.assertNotIn('sk-proj-', clean(text))

    def test_invalid_ai_findings_do_not_break_report_or_escape_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'client.py').write_text('print("safe")')
            bad = {'findings': [{'location': {'file': '../private.env', 'line': 1}, 'title': 'bad'}, {'location': {'file': 'client.py', 'line': 1}, 'title': {'invalid': True}}]}
            model = RepairModel()
            model.call = lambda *args, **kwargs: {'content': json.dumps(bad)}
            with patch('regen.provider.Model', return_value=model):
                result = analyze(root, {'findings': [], 'coverage': []}, lambda _: None, threading.Event(), Budget(1))
            self.assertEqual(result['findings'], [])

    def test_real_edits_isolated_and_patch_handles_missing_final_newline(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'project'
            root.mkdir()
            original = 'result = requests.get(url, verify=False)'
            (root / 'client.py').write_text(original)
            finding = {'id': 'tls', 'location': {'file': 'client.py'}, 'title': 'Unsafe TLS'}
            with patch('regen.provider.Model', RepairModel):
                result = fix_project(root, [finding], lambda _: None, threading.Event(), Budget(1))
            self.assertEqual((root / 'client.py').read_text(), original)
            self.assertIn('verify=True', (Path(result['path']) / 'client.py').read_text())
            self.assertIn('\\ No newline at end of file', result['diff'])
            self.assertEqual(result['changes'], ['client.py'])
            self.assertTrue(result['review']['approved'])

    def test_budget_failure_preserves_already_generated_edits(self):
        class PausingModel(RepairModel):
            def call(self, messages, tools=None, **kwargs):
                if messages[-1]['role'] == 'tool':
                    raise BudgetExceeded('Cap reached')
                return super().call(messages, tools, **kwargs)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'project'
            root.mkdir()
            (root / 'client.py').write_text('verify=False\n')
            with patch('regen.provider.Model', PausingModel):
                result = fix_project(root, [{'location': {'file': 'client.py'}}], lambda _: None, threading.Event(), Budget(1))
            self.assertTrue(result['paused'])
            self.assertIn('verify=True', (Path(result['path']) / 'client.py').read_text())
            self.assertIn('verify=False', (root / 'client.py').read_text())



def advance_clock(model, delay):
    model._test_clock[0] += delay
    return False


class SharedCooldownTests(unittest.TestCase):
    request_model = ProviderSafetyTests.request_model

    def test_queued_call_respects_shared_cooldown_without_gate_or_budget_held(self):
        model = self.request_model()
        model._dispatch = threading.BoundedSemaphore(1)
        model._cooldown_lock = threading.Lock()
        model._not_before = 5.0
        def wait(delay):
            self.assertEqual(model.budget.reserved, 0)
            self.assertTrue(model._dispatch.acquire(blocking=False))
            model._dispatch.release()
            return advance_clock(model, delay)
        with patch('regen.provider.time.monotonic', side_effect=lambda: model._test_clock[0]), patch.object(model.cancelled, 'wait', side_effect=wait) as pause, patch.object(model, '_call_once', return_value={'content': 'done'}) as dispatch:
            self.assertEqual(model.call([{'role': 'user', 'content': 'queued'}])['content'], 'done')
        pause.assert_called_once_with(5)
        dispatch.assert_called_once()

    def test_rate_cooldown_is_recorded_before_releasing_dispatch_gate(self):
        model = self.request_model()
        observed = []
        class Gate:
            def acquire(self, **kwargs):
                return True
            def release(self):
                observed.append(model._not_before)
        model._dispatch = Gate()
        error = ProviderError('rate limited')
        error.rate_limited = True
        error.retry_after = '5'
        with patch('regen.provider.time.monotonic', return_value=0), patch.object(model, '_call_once', side_effect=error):
            with self.assertRaises(ProviderError):
                model._dispatch_once([], None, 10)
        self.assertEqual(observed, [5])

    def test_shared_cooldown_cancellation_prevents_dispatch(self):
        model = self.request_model()
        model._cooldown_lock = threading.Lock()
        model._not_before = 10.0
        model.cancelled.set()
        with patch('regen.provider.time.monotonic', return_value=0), patch.object(model, '_call_once') as dispatch:
            with self.assertRaisesRegex(ProviderError, 'Cancelled while waiting'):
                model.call([])
        dispatch.assert_not_called()
        self.assertEqual(model.budget.reserved, 0)

    def test_groq_primary_repairs_with_one_validated_json_batch_without_tools(self):
        class BatchModel(RepairModel):
            provider = 'groq'
            def __init__(self):
                super().__init__()
                self.calls = 0
            def call(self, messages, tools=None, **kwargs):
                self.assert_no_tools = tools is None
                self.calls += 1
                return {'content': json.dumps({'edits': [{'path': 'client.py', 'search': 'verify=False', 'replace': 'verify=True'}], 'summary': 'Fixed TLS'})}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'client.py').write_text('verify=False\n')
            model = BatchModel()
            result = repair_worker(model, root, [{'location': {'file': 'client.py'}}], lambda _: None, threading.Event(), 'Specialist')
            self.assertTrue(model.assert_no_tools)
            self.assertEqual(model.calls, 1)
            self.assertEqual(result['files'], ['client.py'])
            self.assertEqual((root / 'client.py').read_text(), 'verify=True\n')

    def test_groq_batch_preserves_partial_files_if_correction_hits_budget(self):
        class PausingBatchModel(RepairModel):
            provider = 'groq'
            def __init__(self, *args):
                super().__init__(*args)
                self.calls = 0
            def call(self, messages, tools=None, **kwargs):
                self.calls += 1
                if self.calls > 1:
                    raise BudgetExceeded('budget cap')
                return {'content': json.dumps({'edits': [{'path': 'client.py', 'search': 'verify=False', 'replace': 'verify=True'}, {'path': 'client.py', 'search': 'not in source', 'replace': 'fixed'}], 'summary': 'Partial TLS change'})}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'project'
            root.mkdir()
            (root / 'client.py').write_text('verify=False\n')
            with patch('regen.provider.Model', PausingBatchModel):
                result = fix_project(root, [{'location': {'file': 'client.py'}}], lambda _: None, threading.Event(), Budget(1))
            self.assertTrue(result['paused'])
            self.assertIn('client.py', result['changes'])
            self.assertEqual((Path(result['path']) / 'client.py').read_text(), 'verify=True\n')

    def test_groq_batch_payload_rejection_retries_compact_once_same_model(self):
        class PayloadBatchModel(RepairModel):
            provider = 'groq'
            def __init__(self):
                super().__init__()
                self.requests = []
            def call(self, messages, tools=None, **kwargs):
                self.requests.append(messages)
                if len(self.requests) == 1:
                    error = ProviderError('payload rejected')
                    error.payload_too_large = True
                    raise error
                return {'content': '{"edits":[], "summary":"Compact reviewed"}'}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'client.py').write_text('# source\n' * 1200)
            model = PayloadBatchModel()
            repair_worker(model, root, [{'location': {'file': 'client.py'}}], lambda _: None, threading.Event(), 'Specialist')
            self.assertEqual(len(model.requests), 2)
            self.assertLess(_history_bytes(model.requests[1]), _history_bytes(model.requests[0]))

if __name__ == '__main__':
    unittest.main()
