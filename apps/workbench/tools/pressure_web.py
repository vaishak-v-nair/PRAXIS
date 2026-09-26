"""Paste the requested public repository into the real ReGen UI; no source writes."""
import json
import time
from pathlib import Path

import httpx
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / '.regen' / 'artifacts'
ARTIFACTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as runtime:
    browser = runtime.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:3000', wait_until='networkidle')
    page.get_by_role('tab', name='GitHub repository', exact=True).click()
    page.get_by_label('GitHub repository URL', exact=True).fill('https://github.com/vaishak-v-nair/Zentara.git')
    with page.expect_response(lambda response: response.url.endswith('/api/scans') and response.request.method == 'POST', timeout=30000) as pending:
        page.get_by_role('button', name='Scan project', exact=True).click()
    response = pending.value
    if response.status != 200:
        raise RuntimeError(f'UI scan request failed: HTTP {response.status}')
    job = response.json()
    print(json.dumps({'started_job': job['id'], 'source': job['source']}), flush=True)
    with httpx.Client(timeout=20) as client:
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            job = client.get('http://127.0.0.1:9123/api/jobs/' + job['id']).json()
            if job['status'] not in {'scanning', 'analyzing', 'fixing', 'verifying'}:
                break
            page.wait_for_timeout(1000)
        else:
            raise RuntimeError('Repository pressure scan exceeded four minutes.')
    page.wait_for_timeout(1500)
    page.screenshot(path=str(ARTIFACTS / 'zentara-pressure-desktop.png'), full_page=True)
    viewports = []
    for width in (320, 390, 768, 1440):
        page.set_viewport_size({'width': width, 'height': 900})
        viewports.append({'width': width, 'overflow': page.evaluate('document.documentElement.scrollWidth > innerWidth + 2')})
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(ARTIFACTS / 'zentara-pressure-mobile.png'), full_page=True)
    result = {'job': job, 'browser_errors': errors, 'viewports': viewports}
    (ARTIFACTS / 'zentara-pressure.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'id': job['id'], 'status': job['status'], 'cost': job['cost'], 'findings': [{'title': f['title'], 'location': f['location'], 'confidence': f['confidence']} for f in job['findings']], 'error': job.get('error'), 'browser_errors': errors, 'viewports': viewports}), flush=True)
    browser.close()
    if job['status'] != 'complete' or job.get('error') or errors or any(item['overflow'] for item in viewports):
        raise RuntimeError('Pressure scan or UI validation failed; inspect the recorded artifact.')
