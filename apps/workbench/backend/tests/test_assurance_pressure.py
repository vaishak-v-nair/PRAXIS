"""Independent pressure tests for the additive Approach C trust boundaries.

No real provider or remote MCP calls are made. Every runtime target is a local,
test-owned HTTP server; SQLite, project copies and browser contexts are temporary.
"""
import json
import importlib
import tempfile
import threading
import unittest
import socket
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from playwright.sync_api import sync_playwright

from regen import journey, scanner
from regen.coordination import Coordination
from regen.projects import ProjectRegistry
from regen.store import Store

api = importlib.import_module('regen.app')


class SourceFreshnessPressureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.snapshot = self.root / 'snapshot'
        self.source.mkdir()
        self.snapshot.mkdir()
        for directory in (self.source, self.snapshot):
            (directory / 'app.py').write_text('def save():\n    return "saved"\n', encoding='utf-8')
        self.store = Store(self.root / 'jobs.sqlite3')
        self.registry = ProjectRegistry(self.store)
        self.project = self.registry.register(str(self.source))
        self.job = {'id': 'pressure-job', 'source': str(self.source), 'snapshot': str(self.snapshot),
                    'source_fingerprint': scanner.fingerprint(self.source), 'status': 'complete',
                    'revision': 1, 'created_at': '2026-10-07T00:00:00Z', 'findings': [],
                    'checks': [{'name': 'pytest', 'kind': 'command', 'status': 'passed'}],
                    'checks_for': str(self.snapshot)}
        self.store.save(self.job)
        self.project = self.registry.attach_job(self.project['id'], self.job['id'], expected_revision=0)

    def tearDown(self):
        self.temp.cleanup()

    def status(self):
        return self.registry.status(self.project['id'], instance_id='pressure-instance')

    def test_original_source_drift_is_visible_separately_from_unchanged_copy(self):
        initial = self.status()
        self.assertEqual(initial.get('source_freshness'), 'current')
        (self.source / 'app.py').write_text('def save():\n    raise RuntimeError("broken after review")\n', encoding='utf-8')
        changed = self.status()
        self.assertEqual(changed.get('source_freshness'), 'stale')
        self.assertEqual(changed['freshness'], 'current', 'Unchanged review-copy evidence has its own scope')
        self.assertGreater(changed['revision'], initial['revision'])
        self.assertNotIn(str(self.source), json.dumps(changed))
        self.assertNotIn('broken after review', json.dumps(changed))

    def test_historical_job_without_original_digest_does_not_infer_current_source(self):
        self.job.pop('source_fingerprint')
        self.store.save(self.job)
        observed = self.status()
        self.assertEqual(observed.get('source_freshness'), 'unknown')
        self.assertEqual(observed['freshness'], 'current')

    def test_missing_original_folder_is_source_unavailable(self):
        (self.source / 'app.py').unlink()
        self.source.rmdir()
        observed = self.status()
        self.assertEqual(observed.get('source_freshness'), 'unavailable')
        self.assertFalse(observed['source_available'])
        self.assertNotEqual(observed['readiness'], 'release_candidate')

    def test_agent_context_drops_private_and_superseded_snapshot_work(self):
        board = Coordination(self.store, registry=self.registry)
        private = board.create_task(self.project['id'], job_id=self.job['id'], title='Private strategy',
                                    expected_revision=0, actor_kind='human', actor_id='owner')
        shared = board.create_task(self.project['id'], job_id=self.job['id'], title='Selected current task',
                                  expected_revision=private['revision'], actor_kind='human', actor_id='owner',
                                  assigned_to={'kind': 'agent', 'id': 'agent-1'}, share_with_agents=True)
        self.assertNotIn('Private strategy', json.dumps(board.agent_context(self.project['id'], 'agent-1')))
        self.assertIn('Selected current task', json.dumps(board.agent_context(self.project['id'], 'agent-1')))
        (self.snapshot / 'app.py').write_text('def save():\n    return "copy changed"\n', encoding='utf-8')
        superseded = board.agent_context(self.project['id'], 'agent-1')
        self.assertEqual(superseded['tasks'], [])
        self.assertNotIn('Selected current task', json.dumps(superseded['notes']))
        with self.assertRaises(ValueError):
            board.claim_task(self.project['id'], shared['tasks'][1]['id'], expected_revision=shared['revision'], actor_id='agent-1')

    def test_browser_job_assessment_cannot_keep_release_candidate_after_copy_changes(self):
        self.job.update(project_id=self.project['id'], project_snapshot_id=self.project['latest_snapshot_id'],
                        checks=[{'name': 'npm test', 'kind': 'command', 'status': 'passed'},
                                {'name': 'Save order', 'kind': 'browser', 'status': 'passed',
                                 'evidence_scope': 'user_journey'}],
                        coverage=[{'name': 'Local source inspection', 'status': 'passed'}],
                        plan={'test_file_count': 1, 'operations': {'deployment_files': ['Dockerfile']}})
        self.store.save(self.job)
        with self.store.connect() as database:
            stored_before = database.execute('SELECT data FROM jobs WHERE id=?', (self.job['id'],)).fetchone()[0]
        with patch.object(api, 'store', self.store), patch.object(api, 'DATA', self.root / 'test-job-data'), TestClient(api.app) as client:
            initial = client.get('/api/jobs/' + self.job['id'])
            self.assertEqual(initial.status_code, 200, initial.text)
            self.assertEqual(initial.json()['assessment']['readiness']['status'], 'release_candidate')
            (self.snapshot / 'app.py').write_text('def save():\n    raise RuntimeError("copy no longer works")\n', encoding='utf-8')
            status = client.get('/api/projects/' + self.project['id'] + '/status')
            self.assertEqual(status.json()['freshness'], 'stale')
            observed = client.get('/api/jobs/' + self.job['id'])
            self.assertEqual(observed.status_code, 200, observed.text)
            self.assertNotEqual(observed.json()['assessment']['readiness']['status'], 'release_candidate',
                                'Browser API and shared status must agree on changed-copy evidence')
            self.assertNotEqual(observed.json()['assessment']['implementation']['status'], 'demonstrated')
        with self.store.connect() as database:
            stored_after = database.execute('SELECT data FROM jobs WHERE id=?', (self.job['id'],)).fetchone()[0]
        self.assertEqual(stored_after, stored_before, 'Stale-evidence presentation must preserve historical job data byte for byte')


class ServiceWorkerPressureTests(unittest.TestCase):
    """A worker can bypass context.route unless the caller blocks it explicitly."""
    def test_existing_service_worker_cannot_leave_local_origin_and_pass_journey(self):
        remote_hits = []
        state = {'count': 0}

        class OutsideHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                remote_hits.append(self.path)
                self.send_response(200)
                self.send_header('Content-Length', '0')
                self.end_headers()

            def log_message(self, *_):
                pass

        outside = ThreadingHTTPServer(('127.0.0.1', 0), OutsideHandler)
        outside_url = f'http://127.0.0.1:{outside.server_port}/unexpected-external-request'

        class Handler(BaseHTTPRequestHandler):
            def reply(self, body, content_type):
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if self.path == '/worker.js':
                    script = ("self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));"
                              "self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));"
                              "self.addEventListener('message', e => e.waitUntil("
                              "fetch('" + outside_url + "',{mode:'no-cors'})"
                              ".then(()=>fetch('/api/save',{method:'POST'}))"
                              ".then(()=>e.source.postMessage('saved'))));")
                    self.reply(script.encode(), 'application/javascript')
                elif self.path == '/api/state':
                    self.reply(json.dumps(state).encode(), 'application/json')
                else:
                    body = ("<!doctype html><button onclick=\"navigator.serviceWorker.controller.postMessage('save')\">Save</button>"
                            "<div id=result></div><script>navigator.serviceWorker.onmessage=()=>document.querySelector('#result').textContent='Saved';</script>")
                    self.reply(body.encode(), 'text/html')

            def do_POST(self):
                if self.path == '/api/save':
                    state['count'] += 1
                self.reply(b'{}', 'application/json')

            def log_message(self, *_):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        for owned in (outside, server):
            threading.Thread(target=owned.serve_forever, daemon=True).start()
        origin = f'http://127.0.0.1:{server.server_port}'
        value = {'name': 'Persist via worker', 'timeout_seconds': 5,
                 'steps': [{'action': 'navigate', 'path': '/'},
                           {'action': 'click', 'control_name': 'Save'},
                           {'action': 'assert_text', 'text': 'Saved'}],
                 'state_assertions': [{'name': 'Saved count', 'path': '/api/state',
                                       'json_pointer': '/count', 'expected': 1}]}
        try:
            with sync_playwright() as runtime:
                browser = runtime.chromium.launch(headless=True)
                context = browser.new_context(service_workers='allow')
                page = context.new_page()
                page.goto(origin)
                page.evaluate("async () => {await navigator.serviceWorker.register('/worker.js'); await navigator.serviceWorker.ready;}")
                page.reload()
                page.wait_for_function('!!navigator.serviceWorker.controller')
                self.assertTrue(context.service_workers, 'Fixture must contain a real controlling worker')
                with patch.object(journey, 'LOCAL_ORIGIN', origin):
                    result = journey.run(page, value, threading.Event())
                context.close()
                browser.close()
            self.assertEqual(remote_hits, [], f'Journey request guard was bypassed: {result}')
            self.assertNotEqual(result['evidence_scope'], 'user_journey')
            self.assertIn(result['status'], {'failed', 'skipped'})
        finally:
            for owned in (outside, server):
                owned.shutdown()
                owned.server_close()


class OccupiedBrowserPortPressureTests(unittest.TestCase):
    def test_unrelated_listener_is_neither_driven_nor_stopped(self):
        requests = []

        class ExistingApp(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                body = b'unrelated test-owned application'
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_):
                pass

        try:
            server = ThreadingHTTPServer(('127.0.0.1', 4173), ExistingApp)
        except OSError as error:
            self.skipTest('A pre-existing non-test listener occupies 4173; it is not touched: ' + type(error).__name__)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with tempfile.TemporaryDirectory() as folder, patch.object(scanner.subprocess, 'Popen') as spawn, patch.object(scanner, '_kill') as stop:
                result = scanner._browser_check(Path(folder), ['unrelated-start-command'], lambda _: None, threading.Event(),
                                                {'name': 'Should not run', 'control_name': 'Delete', 'expected_text': 'Done'})
            self.assertEqual(result['status'], 'skipped')
            self.assertIn('already in use', result['output'])
            self.assertEqual(result['evidence_scope'], 'homepage_smoke')
            self.assertNotIn('journey_result', result)
            spawn.assert_not_called()
            stop.assert_not_called()
            self.assertEqual(requests, [], 'No existing application page should be driven by the scanner')
            with httpx.Client(trust_env=False, timeout=2) as client:
                self.assertEqual(client.get('http://127.0.0.1:4173/health').text, 'unrelated test-owned application')
            self.assertEqual(requests, ['/health'], 'The test-owned app remains available after the skipped scanner check')
        finally:
            server.shutdown()
            server.server_close()

    def test_competing_listener_after_precheck_cannot_verify_an_exited_owned_app(self):
        try:
            with socket.create_connection(('127.0.0.1', 4173), timeout=.1):
                self.skipTest('A non-test app already occupies 4173; it is not touched')
        except OSError:
            pass
        requests = []
        servers = []

        class Competitor(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                body = b'<!doctype html><title>Unrelated app</title><h1>Unrelated application</h1>'
                self.send_response(200)
                self.send_header('Content-Type', 'text/html')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_):
                pass

        original_spawn = scanner.subprocess.Popen

        def spawn_after_competitor_binds(*args, **kwargs):
            if not servers:
                # The first scanner precheck already observed a free port. A
                # competing listener binds precisely in the release/start gap.
                server = ThreadingHTTPServer(('127.0.0.1', 4173), Competitor)
                servers.append(server)
                threading.Thread(target=server.serve_forever, daemon=True).start()
            return original_spawn(*args, **kwargs)

        try:
            with tempfile.TemporaryDirectory() as folder, patch.object(scanner.subprocess, 'Popen', side_effect=spawn_after_competitor_binds):
                result = scanner._browser_check(Path(folder), [sys.executable, '-c', 'pass'], lambda _: None, threading.Event())
            self.assertNotEqual(result['status'], 'passed', f'Exited owned app was confused with an unrelated listener: {result}')
            self.assertEqual(requests, [], 'The unrelated app must not be driven after the owned foreground process exits')
            self.assertEqual(len(servers), 1)
            with httpx.Client(trust_env=False, timeout=2) as client:
                self.assertEqual(client.get('http://127.0.0.1:4173/health').status_code, 200)
        finally:
            for server in servers:
                server.shutdown()
                server.server_close()


if __name__ == '__main__':
    unittest.main()
