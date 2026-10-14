"""HTTP approval/worker handoff with the real browser journey engine.

The browser-start hook supplies a random-port trusted fixture, keeping tests
independent of an already-running project on port 4173. Dispatch, jobs, engine,
browser, backend state reads, and durable-result updates remain real.
"""
import importlib
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from playwright.sync_api import sync_playwright

from regen import journey, provider, scanner
from regen.store import Store

api = importlib.import_module('regen.app')


class JourneyApiTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(__file__).resolve().parents[2] / '.regen' / 'artifacts'
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='journey-api-', dir=scratch)
        self.root = Path(self.temp.name)
        self.snapshot = self.root / 'copy'
        self.snapshot.mkdir()
        (self.snapshot / 'app.txt').write_text('A trusted test project copy.', encoding='utf-8')
        self.data = self.root / 'data'
        self.data.mkdir()
        self.database = self.data / 'state.sqlite3'
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute('CREATE TABLE orders(title TEXT)')
            connection.commit()
        self.transient = 'transient-form-and-state-value'
        self.job_id = 'b' * 32
        self.entered = threading.Event()
        self.release = threading.Event()
        self.mode = 'true'
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == '/api/state':
                    with closing(sqlite3.connect(owner.database)) as connection:
                        row = connection.execute('SELECT title FROM orders ORDER BY rowid LIMIT 1').fetchone()
                    self.reply(json.dumps({'title': row[0] if row else ''}).encode(), 'application/json')
                else:
                    self.reply(b'<!doctype html><title>Order</title><label>Title<input></label>'
                               b'<button onclick="fetch(\'/api/save\',{method:\'POST\',body:document.querySelector(\'input\').value})'
                               b'.then(()=>document.querySelector(\'p\').textContent=\'Saved\')">Save</button><p></p>', 'text/html')

            def do_POST(self):
                value = self.rfile.read(int(self.headers.get('Content-Length', '0'))).decode()
                if owner.mode == 'true':
                    with closing(sqlite3.connect(owner.database)) as connection:
                        connection.execute('INSERT INTO orders VALUES (?)', (value,))
                        connection.commit()
                self.reply(b'{"success":true}', 'application/json')

            def reply(self, body, content_type):
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.patchers = [patch.object(api, 'DATA', self.data),
                         patch.object(api, 'store', Store(self.data / 'jobs.sqlite3')),
                         patch.object(api, 'workers', {}), patch.object(api, 'cancellations', {}),
                         patch.object(provider, 'Model', side_effect=AssertionError('No model call is authorized')),
                         patch.object(scanner, '_browser_check', side_effect=self.actual_browser_check),
                         patch.dict(os.environ, {'PRAXIS_REVIEW_SERVICE_TOKEN': ''})]
        for patcher in self.patchers:
            patcher.start()
        self.client = TestClient(api.app)
        self.client.__enter__()
        api.store.save({'id': self.job_id, 'created_at': api.now(), 'revision': 0,
                        'status': 'complete', 'source': str(self.snapshot), 'snapshot': str(self.snapshot),
                        'source_fingerprint': scanner.fingerprint(self.snapshot), 'name': 'Journey API fixture',
                        'commands': [], 'budget': 1, 'cost': 0, 'findings': [], 'checks': [],
                        'coverage': [], 'events': [], 'plan': {'version': 1}})

    def tearDown(self):
        self.release.set()
        for event in api.cancellations.values():
            event.set()
        for worker in api.workers.values():
            worker.join(30)
        self.client.__exit__(None, None, None)
        for patcher in reversed(self.patchers):
            patcher.stop()
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def actual_browser_check(self, subject, command, emit, cancelled, journey_spec):
        self.assertEqual(Path(subject), self.snapshot)
        self.assertEqual(command, ['fixture-browser'])
        self.assertEqual(journey_spec['steps'][1]['value'], self.transient)
        self.assertEqual(journey_spec['state_assertions'][0]['expected'], self.transient)
        self.entered.set()
        if not self.release.wait(10):
            raise AssertionError('The API fixture was not released within its bound.')
        origin = f'http://127.0.0.1:{self.server.server_port}'
        with patch.object(journey, 'LOCAL_ORIGIN', origin):
            if cancelled.is_set():
                observed = journey.run(None, journey_spec, cancelled)
                status = 'cancelled'
            else:
                with sync_playwright() as runtime:
                    browser = runtime.chromium.launch(headless=True)
                    try:
                        page = browser.new_page(service_workers='block')
                        observed = journey.run(page, journey_spec, cancelled)
                        status = 'passed' if page.url.startswith(origin) else 'failed'
                    finally:
                        browser.close()
        return {'name': 'Browser checks', 'kind': 'browser', 'evidence_scope': 'homepage_smoke',
                'status': status, 'output': 'Loaded the trusted test fixture.', 'journey_result': observed}

    def body(self):
        return {'trust_confirmed': True, 'runtime_mode': 'host', 'start_command': 'fixture-browser',
                'journey': {'name': 'Save order', 'timeout_seconds': 10,
                            'steps': [{'action': 'navigate', 'path': '/'},
                                      {'action': 'fill', 'control_name': 'Title', 'value': self.transient},
                                      {'action': 'click', 'control_name': 'Save'},
                                      {'action': 'assert_text', 'text': 'Saved'}],
                            'state_assertions': [{'name': 'Saved title', 'path': '/api/state',
                                                  'json_pointer': '/title', 'expected': self.transient}]}}

    def request(self, body=None):
        return self.client.post(f'/api/jobs/{self.job_id}/verify', json=body or self.body())

    def finish(self):
        api.workers[self.job_id].join(30)
        self.assertFalse(api.workers[self.job_id].is_alive(), 'Journey worker exceeded its test bound')
        return self.client.get(f'/api/jobs/{self.job_id}').json()

    def test_structured_journey_runs_through_host_dispatch_with_transient_values(self):
        before = scanner.fingerprint(self.snapshot)
        response = self.request()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(self.entered.wait(5))
        stored = api.store.get(self.job_id)
        self.assertEqual(stored['status'], 'verifying')
        self.assertNotIn(self.transient, json.dumps(stored))
        self.assertNotIn('value', stored['resume']['options']['journey']['steps'][1])
        self.assertNotIn('expected', stored['resume']['options']['journey']['state_assertions'][0])
        self.release.set()
        job = self.finish()
        self.assertEqual(job['status'], 'complete', job)
        full = next(row for row in job['checks'] if row.get('evidence_scope') == 'user_journey')
        self.assertEqual(full['status'], 'passed', full)
        self.assertEqual(full['runtime'], 'host')
        self.assertNotIn(self.transient, json.dumps(job))
        self.assertNotIn(self.transient, json.dumps(api.store.get(self.job_id)))
        self.assertEqual(scanner.fingerprint(self.snapshot), before)
        self.assertEqual(job['cost'], 0)
        self.assertNotEqual(job['assessment']['readiness']['status'], 'release_candidate')

    def test_false_backend_success_is_retained_as_failed_evidence(self):
        self.mode = 'false'
        self.release.set()
        self.assertEqual(self.request().status_code, 200)
        job = self.finish()
        observed = next(row for row in job['checks'] if row.get('attempted_scope') == 'user_journey')
        self.assertEqual(observed['status'], 'failed', observed)
        self.assertTrue(observed['false_success'])
        self.assertEqual(job['assessment']['implementation']['status'], 'contradicted')

    def test_invalid_sensitive_inputs_never_echo_values_or_start_work(self):
        for kind in ('fill', 'state', 'script'):
            value = self.body()
            if kind == 'fill':
                value['journey']['steps'][1]['control_name'] = 'Password'
            elif kind == 'state':
                value['journey']['state_assertions'][0]['expected'] = {'secret': self.transient}
            else:
                value['journey']['steps'][1]['script'] = self.transient
            with self.subTest(kind=kind):
                response = self.request(value)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertNotIn(self.transient, response.text)
                self.assertEqual(api.workers, {})
                self.assertNotIn(self.transient, json.dumps(api.store.get(self.job_id)))

    def test_runtime_trust_and_environment_remain_required(self):
        value = self.body()
        value['trust_confirmed'] = False
        self.assertEqual(self.request(value).status_code, 403)
        value['trust_confirmed'] = True
        value['runtime_mode'] = 'docker'
        self.assertEqual(self.request(value).status_code, 422)
        self.assertEqual(api.workers, {})

    def test_cancelled_worker_never_runs_action_or_returns_success(self):
        self.assertEqual(self.request().status_code, 200)
        self.assertTrue(self.entered.wait(5))
        response = self.client.post(f'/api/jobs/{self.job_id}/cancel', json={})
        self.assertEqual(response.status_code, 200)
        self.release.set()
        job = self.finish()
        self.assertEqual(job['status'], 'cancelled', job)
        self.assertFalse(any(row.get('status') == 'passed' for row in job['checks']))
        self.assertNotIn(self.transient, json.dumps(api.store.get(self.job_id)))
        with closing(sqlite3.connect(self.database)) as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM orders').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
