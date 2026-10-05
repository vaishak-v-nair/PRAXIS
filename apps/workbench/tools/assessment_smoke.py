"""Real browser -> API -> explicitly selected runtime. Synthetic projects, no model calls."""
import argparse
import json
import os
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
artifacts = Path(os.environ.get('PRAXIS_SMOKE_ARTIFACT_DIR', str(root / '.regen' / 'artifacts')))
if not artifacts.is_absolute():
    raise ValueError('PRAXIS_SMOKE_ARTIFACT_DIR must be an absolute path')
artifacts.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--runtime', choices=('docker', 'host'), default='docker')
args = parser.parse_args()

with tempfile.TemporaryDirectory(prefix='praxis-assessment-') as directory, sync_playwright() as runtime:
    browser = runtime.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    report = []
    review_requests = []
    def capture_review(route):
        payload = route.request.post_data_json
        review_requests.append(payload)
        assert payload['ai_review'] is False, 'Runtime smoke must not request paid model review'
        route.continue_()
    page.route('**/api/scans', capture_review)
    for label, expected in [('correct', 4), ('broken', 5)]:
        source = Path(directory) / label
        source.mkdir()
        (source / 'package.json').write_text(json.dumps({'name': 'praxis-assessment-fixture', 'private': True, 'scripts': {'test': 'node --test test.js'}}))
        (source / 'sum.js').write_text('exports.sum = (a, b) => a + b;')
        (source / 'test.js').write_text(f"const {{ sum }} = require('./sum'); require('node:assert').equal(sum(2, 2), {expected});")
        original = {path.name: path.read_bytes() for path in source.iterdir()}
        page.goto('http://127.0.0.1:3000', wait_until='networkidle')
        page.get_by_text('Local service connected', exact=True).wait_for()
        page.get_by_role('button', name='Local path', exact=True).click()
        page.locator('#project-source').fill(str(source))
        page.locator('.review-details > summary').click()
        page.get_by_label('Also run project commands', exact=False).check()
        page.get_by_label('Execution environment', exact=True).select_option(args.runtime)
        page.get_by_label('I trust this project and authorize').check()
        with page.expect_response(lambda response: response.url.endswith('/api/scans') and response.request.method == 'POST') as pending:
            page.get_by_role('button', name='Review project', exact=True).click()
        response = pending.value
        assert response.ok, response.text()
        job_id = response.json()['id']
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            job = page.request.get('http://127.0.0.1:9123/api/jobs/' + job_id).json()
            if job['status'] not in {'scanning', 'analyzing', 'verifying'}:
                break
            page.wait_for_timeout(300)
        assert job['status'] == 'complete', job.get('error')
        assert job['cost'] == 0
        commands = [check for check in job['checks'] if check.get('kind') == 'command']
        assert len(commands) == 1, job['checks']
        assert commands[0]['status'] == ('passed' if label == 'correct' else 'failed'), job['checks']
        assert commands[0]['runtime'] == args.runtime, job['checks']
        if args.runtime == 'host':
            assert commands[0]['network'] == 'host', 'Native execution must not claim a blocked network'
        if label == 'correct':
            assert job['assessment']['implementation']['status'] == 'runtime_observed', job['assessment']
            assert job['assessment']['readiness']['status'] == 'not_established', job['assessment']
        else:
            assert job['assessment']['implementation']['status'] == 'contradicted', job['assessment']
            assert job['assessment']['readiness']['status'] == 'blocked', job['assessment']
        assert not (source / 'node_modules').exists()
        assert not (source / 'package-lock.json').exists()
        assert {path.name: path.read_bytes() for path in source.iterdir()} == original
        page.locator('.project-actions').get_by_text('Review finished', exact=True).wait_for()
        page.get_by_role('heading', name='What the project has actually demonstrated', exact=True).wait_for()
        page.get_by_text('Evidence still required', exact=True).wait_for()
        traces = page.locator('details.evidence-trace summary')
        assert traces.count() > 0
        traces.first.click()
        page.screenshot(path=str(artifacts / f'assessment-{label}-overview.png'), full_page=True)
        page.get_by_role('navigation', name='Review sections').get_by_role('button', name='source map', exact=True).click()
        page.locator('.file-list').get_by_role('button', name='test.js', exact=True).click()
        assert 'sum.js' in page.locator('.relationship-detail').inner_text()
        for width in (320, 390, 768, 1024, 1440):
            page.set_viewport_size({'width': width, 'height': 1000})
            page.wait_for_timeout(100)
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 2'), f'Overflow at {width}px'
        page.screenshot(path=str(artifacts / f'assessment-{label}.png'), full_page=True)
        report.append({'scenario': label, 'job': job_id, 'command_status': commands[0]['status'],
                       'implementation': job['assessment']['implementation']['status'],
                       'readiness': job['assessment']['readiness']['status'],
                       'source_untouched': True, 'runtime': args.runtime, 'model_cost': job['cost']})
    assert all(not item['ai_review'] and item['run_checks'] and item['runtime_mode'] == args.runtime
               and item['trust_confirmed'] for item in review_requests), review_requests
    assert not errors, errors
    browser.close()
    (artifacts / 'assessment-smoke.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
