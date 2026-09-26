"""Exercise the requested repository's Instant fix UI and record isolated results."""
import json
import time
from pathlib import Path

import httpx
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / '.regen' / 'artifacts'
baseline = json.loads((ARTIFACTS / 'zentara-pressure.json').read_text('utf-8'))['job']
with sync_playwright() as runtime:
    browser = runtime.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    page.goto('http://127.0.0.1:3000', wait_until='networkidle')
    page.get_by_role('button', name='Your projects').click()
    page.get_by_role('button', name='Select fixable', exact=True).click()
    with page.expect_response(lambda response: response.url.endswith('/fix') and response.request.method == 'POST', timeout=30000) as pending:
        page.get_by_role('button', name='Instant fix', exact=False).click()
    response = pending.value
    if response.status != 200:
        raise RuntimeError(f'Instant fix request failed: HTTP {response.status}')
    with httpx.Client(timeout=20) as client:
        deadline = time.monotonic() + 360
        while time.monotonic() < deadline:
            job = client.get('http://127.0.0.1:9123/api/jobs/' + baseline['id']).json()
            if job['status'] not in {'scanning', 'analyzing', 'fixing', 'verifying'}:
                break
            page.wait_for_timeout(1000)
        else:
            raise RuntimeError('Instant fix pressure job exceeded six minutes.')
        patch = client.get('http://127.0.0.1:9123/api/jobs/' + job['id'] + '/export?format=patch')
        if patch.status_code == 200:
            (ARTIFACTS / 'zentara-instant.patch').write_text(patch.text, encoding='utf-8')
    page.get_by_role('tab', name='Changes', exact=False).click()
    page.wait_for_timeout(1000)
    page.screenshot(path=str(ARTIFACTS / 'zentara-instant-fix.png'), full_page=True)
    (ARTIFACTS / 'zentara-instant.json').write_text(json.dumps(job, indent=2), encoding='utf-8')
    print(json.dumps({'status': job['status'], 'cost': job['cost'], 'error': job.get('error'),
        'changes': (job.get('fix') or {}).get('changes'), 'agents': (job.get('fix') or {}).get('agents'),
        'review': (job.get('fix') or {}).get('review'), 'patch_status': patch.status_code}), flush=True)
    browser.close()
    if job['status'] != 'complete' or job.get('error') or patch.status_code != 200:
        raise SystemExit(1)
