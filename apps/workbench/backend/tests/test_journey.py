import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from pydantic import ValidationError
from playwright.sync_api import sync_playwright

from regen.app import JourneyInput, VerifyInput, run_project_checks
from regen import journey
from regen.journey import run


SPEC = {'name': 'Open settings', 'path': '/', 'role': 'button',
        'control_name': 'Settings', 'expected_text': 'Account preferences'}


class FakeLocator:
    def __init__(self, page, kind, visible_only=False):
        self.page = page
        self.kind = kind
        self.visible_only = visible_only

    def count(self):
        if self.kind == 'control':
            return self.page.control_count
        return int(self.page.expected_visible) if self.visible_only else 1

    def is_visible(self):
        return self.page.control_visible if self.kind == 'control' else self.page.expected_visible

    def filter(self, *, visible=False):
        return FakeLocator(self.page, self.kind, visible)

    @property
    def first(self):
        return self

    def click(self, *, timeout):
        if self.page.reveal_after_click:
            self.page.expected_visible = True
        if self.page.leave_origin:
            self.page.url = 'https://example.com/elsewhere'

    def wait_for(self, *, state, timeout):
        if not self.page.expected_visible:
            raise TimeoutError('Expected text did not appear')


class FakePage:
    def __init__(self, *, expected_visible=False, reveal_after_click=True,
                 control_count=1, control_visible=True, leave_origin=False):
        self.url = ''
        self.expected_visible = expected_visible
        self.reveal_after_click = reveal_after_click
        self.control_count = control_count
        self.control_visible = control_visible
        self.leave_origin = leave_origin

    def goto(self, url, **_):
        self.url = url

    def get_by_role(self, *_args, **_kwargs):
        return FakeLocator(self, 'control')

    def get_by_text(self, *_args, **_kwargs):
        return FakeLocator(self, 'expected')


class JourneyTests(unittest.TestCase):
    def test_real_browser_distinguishes_observed_change_from_false_and_stale(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                before = 'Account preferences' if self.path == '/stale' else ''
                action = 'document.getElementById("out").textContent="Account preferences"' if self.path == '/true' else ''
                body = (f'<!doctype html><title>Fixture</title><button onclick=\'{action}\'>Settings</button>'
                        f'<div id="out">{before}</div>').encode()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with patch.object(journey, 'LOCAL_ORIGIN', f'http://127.0.0.1:{server.server_port}'):
                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(headless=True)
                    try:
                        page = browser.new_page()
                        self.assertEqual(run(page, {**SPEC, 'path': '/true'}, threading.Event())['status'], 'passed')
                        self.assertEqual(run(page, {**SPEC, 'path': '/false'}, threading.Event())['status'], 'failed')
                        self.assertEqual(run(page, {**SPEC, 'path': '/stale'}, threading.Event())['status'], 'skipped')
                    finally:
                        browser.close()
        finally:
            server.shutdown()
            server.server_close()

    def test_visible_outcome_after_click_is_observed(self):
        result = run(FakePage(), SPEC, threading.Event())
        self.assertEqual(result['status'], 'passed')
        self.assertEqual(result['evidence_scope'], 'ui_interaction')
        self.assertIn('expected_text_became_visible', result['observations'])

    def test_preexisting_text_cannot_count_as_a_pass(self):
        result = run(FakePage(expected_visible=True), SPEC, threading.Event())
        self.assertEqual(result['status'], 'skipped')

    def test_missing_control_or_outcome_fails(self):
        self.assertEqual(run(FakePage(control_count=0), SPEC, threading.Event())['status'], 'failed')
        self.assertEqual(run(FakePage(reveal_after_click=False), SPEC, threading.Event())['status'], 'failed')

    def test_external_navigation_cannot_count_as_local_success(self):
        result = run(FakePage(leave_origin=True), SPEC, threading.Event())
        self.assertEqual(result['status'], 'failed')

    def test_cancelled_journey_is_not_success(self):
        cancelled = threading.Event()
        cancelled.set()
        self.assertEqual(run(FakePage(), SPEC, cancelled)['status'], 'cancelled')

    def test_input_is_bounded_and_browser_scripts_are_not_accepted(self):
        self.assertEqual(VerifyInput(journey=JourneyInput(**SPEC)).journey.path, '/')
        for path in ('//evil.example/', '/../../secret', 'https://evil.example'):
            with self.assertRaises(ValidationError):
                JourneyInput(**{**SPEC, 'path': path})
        with self.assertRaises(ValidationError):
            JourneyInput(**{**SPEC, 'script': 'page.evaluate(1)'})

    def test_container_dispatch_refuses_journey_instead_of_claiming_it_ran(self):
        with self.assertRaisesRegex(ValueError, 'authorized local execution'):
            run_project_checks('.', [], lambda _: None, threading.Event(),
                               runtime_mode='docker', journey_spec=SPEC)


if __name__ == '__main__':
    unittest.main()
