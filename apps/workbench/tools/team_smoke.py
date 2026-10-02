"""Explicit, cost-bounded real provider/Docker and two-browser demonstration.

Creates labelled disposable demo projects; no existing project is modified.
Calls configured model APIs under one $0.60 job limit. Not an offline CI test.
"""
import hashlib
import json
import time
from pathlib import Path

import httpx
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.regen' / 'artifacts'
PROJECTS = OUT / 'presentation-projects'
API = 'http://127.0.0.1:9123/api'
UI = 'http://127.0.0.1:3000'

CORRECT = '''def create_order(connection, customer, total):
    if not customer or total <= 0:
        raise ValueError("A customer and positive total are required")
    connection.execute("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, customer TEXT, total REAL)")
    cursor = connection.execute("INSERT INTO orders(customer, total) VALUES (?, ?)", (customer, total))
    connection.commit()
    return {"success": True, "order_id": cursor.lastrowid}
'''
BROKEN = '''def create_order(connection, customer, total):
    return {"success": True, "order_id": "demo-order"}
'''
TESTS = '''import sqlite3
import unittest
from orders import create_order

class OrderJourneyTests(unittest.TestCase):
    def test_success_creates_a_real_order(self):
        with sqlite3.connect(":memory:") as db:
            response = create_order(db, "Course demo customer", 12)
            self.assertTrue(response["success"])
            self.assertEqual(db.execute("SELECT customer, total FROM orders").fetchall(), [("Course demo customer", 12.0)])
    def test_invalid_order_is_rejected(self):
        with sqlite3.connect(":memory:") as db:
            with self.assertRaises(ValueError):
                create_order(db, "", -1)
'''


def project(name, source):
    folder = PROJECTS / name
    (folder / 'tests').mkdir(parents=True, exist_ok=True)
    (folder / 'orders.py').write_text(source, encoding='utf-8')
    (folder / 'requirements.txt').write_text('', encoding='utf-8')
    (folder / 'tests' / 'test_orders.py').write_text(TESTS, encoding='utf-8')
    (folder / 'README.md').write_text('# Order service — course demonstration\n\nThe intended behavior is to save orders in SQLite and reject invalid input. These small projects demonstrate PRAXIS against real source and real tests, not a production deployment.\n', encoding='utf-8')
    return folder


def fingerprint(folder):
    return hashlib.sha256(b''.join(f.relative_to(folder).as_posix().encode() + f.read_bytes()
        for f in sorted(folder.rglob('*')) if f.is_file())).hexdigest()


def call(method, path, body=None):
    response = httpx.request(method, API + path, json=body, timeout=35)
    response.raise_for_status()
    return response.json()


def finish(job_id, limit=300):
    until = time.monotonic() + limit
    while time.monotonic() < until:
        job = call('GET', '/jobs/' + job_id)
        if job['status'] in {'complete', 'paused', 'error', 'cancelled'}:
            return job
        time.sleep(1)
    call('POST', f'/jobs/{job_id}/cancel', {})
    raise AssertionError('Timed out; cancelled the owned demonstration review')


def main():
    health = call('GET', '/health')
    assert health['docker']['ready'], health['docker']['detail']
    good = project('OrderService-working', CORRECT)
    bad = project('OrderService-false-success', BROKEN)
    before = {folder.name: fingerprint(folder) for folder in (good, bad)}
    good_job = call('POST', '/scans', {'source': str(good), 'budget': .2, 'ai_review': False,
        'run_checks': True, 'trust_confirmed': True, 'allow_network': False})
    good_job = finish(good_job['id'])
    assert any(c.get('status') == 'passed' and 'unittest' in json.dumps(c) for c in good_job['checks']), good_job.get('error')
    bad_job = call('POST', '/scans', {'source': str(bad), 'budget': .6, 'ai_review': True,
        'review_mode': 'team', 'review_goal': 'Check that order creation saves a real SQLite row and rejects invalid input. Never accept a success response as proof of persistence.',
        'run_checks': True, 'trust_confirmed': True, 'allow_network': False})
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        owner = browser.new_context(viewport={'width': 1440, 'height': 1000})
        reviewer = browser.new_context(viewport={'width': 1440, 'height': 1000})
        first, second = owner.new_page(), reviewer.new_page()
        url = UI + '/?job=' + bad_job['id']
        for page in (first, second):
            page.goto(url, wait_until='domcontentloaded')
            page.get_by_role('heading', name=bad.name, exact=True).wait_for(timeout=30000)
            page.get_by_role('navigation', name='Review sections').get_by_role('button', name='workspace', exact=True).click()
        first.get_by_label('Your name', exact=True).fill('Project owner')
        first.get_by_label('Your contribution', exact=True).fill('Please check that a saved response corresponds to a real database row.')
        first.get_by_label('Share this note with configured models', exact=False).check()
        first.get_by_role('button', name='Post contribution', exact=True).click()
        second.get_by_text('Please check that a saved response corresponds to a real database row.', exact=True).wait_for(timeout=15000)
        second.get_by_label('Your name', exact=True).fill('Peer reviewer')
        second.get_by_label('Note type', exact=True).select_option('decision')
        second.get_by_label('Your contribution', exact=True).fill('Keep the original source unchanged. A passing response alone cannot approve release.')
        second.get_by_role('button', name='Post contribution', exact=True).click()
        first.get_by_text('Keep the original source unchanged. A passing response alone cannot approve release.', exact=True).wait_for(timeout=15000)
        first.screenshot(path=str(OUT / 'team-two-contributors.png'), full_page=True)
        bad_job = finish(bad_job['id'])
        first.screenshot(path=str(OUT / 'team-real-workspace.png'), full_page=True)
        browser.close()
    assert bad_job['status'] == 'complete', bad_job.get('error')
    assert bad_job.get('team') and any(a['status'] == 'complete' for a in bad_job['team']['agents']), 'No real provider completed review'
    assert any(c.get('status') == 'failed' and 'unittest' in json.dumps(c) for c in bad_job['checks']), 'False success was not caught by executed tests'
    assert bad_job['assessment']['readiness']['status'] != 'release_candidate'
    assert len(bad_job['collaboration']['participants']) == 2
    assert sum(n['share_with_agents'] for n in bad_job['collaboration']['notes']) == 1
    assert before == {folder.name: fingerprint(folder) for folder in (good, bad)}, 'Original demo source changed'
    result = {'working_job': good_job['id'], 'broken_job': bad_job['id'], 'source_paths': [str(good), str(bad)],
        'real_model_status': bad_job['team']['status'], 'agent_statuses': [{k: a[k] for k in ('agent', 'provider', 'model', 'status', 'peer_status')} for a in bad_job['team']['agents']],
        'model_cost_usd': bad_job['cost'], 'checks': [c['status'] for c in bad_job['checks']],
        'two_browser_collaboration': True, 'source_preserved': True}
    (OUT / 'team-smoke.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
