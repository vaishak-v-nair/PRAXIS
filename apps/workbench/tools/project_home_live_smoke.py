"""Read-only browser test of the production project home and its live API.

Run with the local Workbench service. It never starts scans, models, or project
commands. Screenshots are machine-local artifacts under ignored .regen state.
"""
import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.regen' / 'artifacts' / 'project-home-live'
OUT.mkdir(parents=True, exist_ok=True)
BASE = 'http://127.0.0.1:3000'

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
    errors, writes, reads = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def inspect(route):
        if route.request.method not in {'GET', 'HEAD', 'OPTIONS'}:
            writes.append(route.request.url)
            route.abort()
        else:
            reads.append(route.request.url)
            route.continue_()

    page.route('**/api/**', inspect)
    started = time.monotonic()
    page.goto(BASE, wait_until='domcontentloaded')
    page.get_by_role('heading', name='Your projects').wait_for(timeout=10000)
    page.locator('.project-list-row').first.wait_for(timeout=10000)
    first_paint = round(time.monotonic() - started, 2)
    assert first_paint < 10, f'Project home took {first_paint}s to show saved work'
    assert any('/api/workspace?scope=projects&quick=true' in url for url in reads), 'Home did not use project-only quick paging'
    projected = page.request.get(BASE + '/api/workspace?scope=projects&quick=true&limit=30').json()
    assert all(item['kind'] == 'project' for item in projected['items'])
    assert all(item['readiness'] == 'not_established' and item['checks_passed'] == 0
               for item in projected['items']), 'Quick projection advertised unchecked success'
    if projected['next_offset'] is None:
        assert page.locator('.project-list-row').count() == projected['total']
        assert page.get_by_role('button', name='Load more projects', exact=False).count() == 0
    for width in (320, 390, 768, 1024, 1440):
        page.set_viewport_size({'width': width, 'height': 900})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 2'), width
        if width in (390, 1440):
            page.screenshot(path=str(OUT / f'home-{width}.png'))
    page.add_script_tag(path=str(ROOT / 'node_modules' / 'axe-core' / 'axe.min.js'))
    for theme in ('light', 'dark'):
        page.evaluate('(value) => document.documentElement.dataset.theme = value', theme)
        violations = page.evaluate("async () => (await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations")
        assert not violations, [(item['id'], [node['target'] for node in item['nodes']]) for item in violations]
    first_name = page.locator('.project-list-main strong').first.inner_text()
    page.keyboard.press('Control+k')
    page.get_by_role('searchbox', name='Search loaded projects').fill(first_name)
    page.keyboard.press('Enter')
    page.get_by_role('heading', name=first_name, exact=True).wait_for()
    page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='Projects').click()
    page.locator('.project-list-row').first.wait_for()
    page.get_by_role('button', name='New review').click()
    page.get_by_role('heading', name='Start a review').wait_for()
    page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='Projects').click()
    page.locator('.project-list-row').first.wait_for()
    assert not writes, writes
    assert not errors, errors
    browser.close()

result = {'passed': True, 'first_paint_seconds': first_paint, 'widths': [320, 390, 768, 1024, 1440],
          'api_reads': len(reads), 'api_writes': len(writes), 'javascript_errors': len(errors)}
(OUT / 'result.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result))
