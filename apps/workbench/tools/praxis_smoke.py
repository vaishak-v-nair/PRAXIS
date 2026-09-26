"""Read-only browser/API integration check; no scans, repairs, or paid calls."""
import json
import re
from pathlib import Path

import httpx
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
artifacts = root / '.regen' / 'artifacts'
artifacts.mkdir(parents=True, exist_ok=True)
base = 'http://127.0.0.1:9123'
with httpx.Client(timeout=10) as client:
    health = client.get(base + '/api/health')
    health.raise_for_status()
    response = client.get(base + '/api/jobs')
    response.raise_for_status()
    jobs = response.json()
    assert client.get(base + '/api/health', headers={'host': 'evil.example'}).status_code == 403
    assert client.post(base + '/api/settings', json={}, headers={'origin': 'https://evil.example'}).status_code == 403
    assert client.post(base + '/api/settings', content='provider=groq', headers={'content-type': 'application/x-www-form-urlencoded'}).status_code == 415
    details = [client.get(base + '/api/jobs/' + job['id']).json() for job in jobs]
    repaired = next((job for job in details if job.get('fix')), None)

with sync_playwright() as runtime:
    browser = runtime.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda _: errors.append('JavaScript runtime error'))
    page.goto('http://127.0.0.1:3000', wait_until='networkidle')
    page.get_by_role('heading', name='Built fast? Ship with confidence.').wait_for()
    assert page.title().startswith('PRAXIS Workbench')
    page.get_by_text('Backend connected', exact=True).wait_for()
    measurements = []
    for width in (320, 390, 768, 1024, 1440):
        page.set_viewport_size({'width': width, 'height': 900})
        overflow = page.evaluate('document.documentElement.scrollWidth > innerWidth + 2')
        measurements.append({'width': width, 'overflow': overflow})
        assert not overflow, f'Homepage overflow at {width}px'
    page.screenshot(path=str(artifacts / 'praxis-desktop.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(artifacts / 'praxis-mobile.png'), full_page=True)
    page.get_by_role('button', name='Model settings').click()
    page.get_by_role('dialog').wait_for()
    page.get_by_role('heading', name='Choose your repair model').wait_for()
    page.keyboard.press('Escape')
    if repaired:
        # Choose existing real history; no synthetic jobs are inserted.
        index = next(i for i, job in enumerate(jobs) if job['id'] == repaired['id'])
        page.locator('.history-item').nth(index).click()
        page.get_by_role('heading', name='Let’s make it ship-ready.').wait_for()
        page.get_by_role('tab', name=re.compile('Changes')).click()
        heading = 'Changes, ready for your review' if repaired['status'] == 'complete' else 'Partial changes, preserved for review'
        page.get_by_role('heading', name=heading, exact=True).wait_for()
        if repaired['fix'].get('diff'):
            assert page.locator('.diff-view').inner_text().strip()
        page.set_viewport_size({'width': 1440, 'height': 1000})
        page.screenshot(path=str(artifacts / 'praxis-history.png'), full_page=True)
    assert not errors
    browser.close()

report = {'javascript_errors': errors, 'viewports': measurements,
          'backend_connected': True, 'host_origin_json_guards': 'passed',
          'existing_jobs': len(jobs), 'existing_repair_rendered': bool(repaired),
          'model_calls': 0, 'source_application': False}
(artifacts / 'praxis-smoke.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report))
