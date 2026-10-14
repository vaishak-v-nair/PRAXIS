"""Real browser -> API -> explicitly selected runtime. Synthetic projects, no model calls."""
import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
artifacts = Path(os.environ.get('PRAXIS_SMOKE_ARTIFACT_DIR', str(root / '.regen' / 'artifacts')))
if not artifacts.is_absolute():
    raise ValueError('PRAXIS_SMOKE_ARTIFACT_DIR must be an absolute path')
artifacts.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--runtime', choices=('docker', 'host'), default='docker')
args = parser.parse_args()


@contextmanager
def isolated_backend(directory):
    """Keep synthetic QA runs out of the person's saved project history."""
    data = directory / 'service-data'
    data.mkdir()
    env_file = directory / 'empty-provider-env'
    env_file.write_text('', encoding='utf-8')
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    env = os.environ.copy()
    env.update(PYTHONPATH=str(root / 'backend'), PRAXIS_WORKBENCH_DATA_DIR=str(data),
               PRAXIS_WORKBENCH_ENV_FILE=str(env_file))
    # A synthetic smoke must never accidentally inherit a live model credential.
    for key in list(env):
        if key.endswith(('_API_KEY', '_TOKEN')) or key in {'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'}:
            env.pop(key)
    service = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'regen.app:app',
                                '--app-dir', str(root / 'backend'), '--host', '127.0.0.1',
                                '--port', str(port), '--log-level', 'error'], cwd=root,
                               env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    address = f'http://127.0.0.1:{port}'
    try:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if service.poll() is not None:
                raise RuntimeError('Isolated smoke API exited before readiness')
            try:
                with urlopen(address + '/api/health', timeout=1) as response:
                    if response.status == 200:
                        break
            except (OSError, TimeoutError):
                time.sleep(.2)
        else:
            raise RuntimeError('Isolated smoke API did not become ready')
        yield address
    finally:
        service.terminate()
        try:
            service.wait(timeout=5)
        except subprocess.TimeoutExpired:
            service.kill()
            service.wait(timeout=5)


with tempfile.TemporaryDirectory(prefix='praxis-assessment-') as directory, isolated_backend(Path(directory)) as api_base, sync_playwright() as runtime:
    browser = runtime.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    report = []
    review_requests = []
    def isolate_api(route):
        parsed = urlsplit(route.request.url)
        if parsed.path == '/api/scans':
            payload = route.request.post_data_json
            review_requests.append(payload)
            assert payload['ai_review'] is False, 'Runtime smoke must not request paid model review'
        route.continue_(url=api_base + parsed.path + ('?' + parsed.query if parsed.query else ''))
    page.route('**/api/**', isolate_api)
    for label, expected in [('correct', 4), ('broken', 5)]:
        source = Path(directory) / label
        source.mkdir()
        (source / 'package.json').write_text(json.dumps({'name': 'praxis-assessment-fixture', 'private': True, 'scripts': {'test': 'node --test test.js'}}))
        (source / 'sum.js').write_text('exports.sum = (a, b) => a + b;')
        (source / 'test.js').write_text(f"const {{ sum }} = require('./sum'); require('node:assert').equal(sum(2, 2), {expected});")
        original = {path.name: path.read_bytes() for path in source.iterdir()}
        page.goto('http://127.0.0.1:3000', wait_until='networkidle')
        page.get_by_text('Connected locally', exact=True).wait_for()
        page.get_by_role('button', name='New review', exact=True).click()
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
            job = page.request.get(api_base + '/api/jobs/' + job_id).json()
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
        page.locator('.project-actions').get_by_text('Review recorded', exact=True).wait_for()
        page.locator('details.review-more > summary').click()
        page.get_by_role('heading', name='What the project has actually demonstrated', exact=True).wait_for()
        page.get_by_text('Evidence still required', exact=True).wait_for()
        traces = page.locator('details.evidence-trace summary')
        assert traces.count() > 0
        traces.first.click()
        page.screenshot(path=str(artifacts / f'assessment-{label}-overview.png'), full_page=True)
        page.get_by_label('More review sections').select_option('source map')
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
