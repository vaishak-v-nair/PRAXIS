"""Local UI smoke check; snapshots are written only under .regen/artifacts."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parents[1]
artifacts = root / '.regen' / 'artifacts'
artifacts.mkdir(parents=True, exist_ok=True)
with sync_playwright() as runtime:
    browser = runtime.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:3000', wait_until='networkidle')
    page.get_by_role('heading', name='Built fast? Ship with confidence.').wait_for()
    page.screenshot(path=str(artifacts / 'desktop.png'), full_page=True)
    measurements = []
    for width in (320, 390, 768, 1024, 1440):
        page.set_viewport_size({'width': width, 'height': 900})
        measurements.append({'width': width, 'overflow': page.evaluate('document.documentElement.scrollWidth > innerWidth + 2')})
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(artifacts / 'mobile.png'), full_page=True)
    page.get_by_role('button', name='Model settings').click()
    page.get_by_role('dialog').wait_for()
    page.screenshot(path=str(artifacts / 'settings.png'), full_page=True)
    page.keyboard.press('Escape')
    page.get_by_role('button', name='Your projects').click()
    page.get_by_role('heading', name='Let’s make it ship-ready.').wait_for()
    page.get_by_role('tab', name='Changes').click()
    page.get_by_role('heading', name='Changes, ready for your review').wait_for()
    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.screenshot(path=str(artifacts / 'report.png'), full_page=True)
    print(json.dumps({'errors': errors, 'viewports': measurements, 'backend_connected': page.get_by_text('Backend connected', exact=True).is_visible()}))
    browser.close()
