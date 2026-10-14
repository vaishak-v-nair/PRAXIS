"""Read-only navigation and responsive checks against the real local service.

No source scans, model calls, or project commands are submitted by this test.
Run after building and starting the Workbench on 127.0.0.1:3000.
"""
import json
from pathlib import Path
from urllib.parse import quote
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.regen' / 'artifacts' / 'workspace-shell-2026-10-09'
OUT.mkdir(parents=True, exist_ok=True)
BASE = 'http://127.0.0.1:3000'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
    errors, writes = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    def read_only(route):
        if route.request.method not in ('GET', 'HEAD', 'OPTIONS'):
            writes.append(route.request.url)
            route.abort()
        else:
            route.continue_()
    page.route('**/api/**', read_only)
    page.goto(BASE, wait_until='networkidle')
    page.get_by_text('Connected locally', exact=True).wait_for()
    page.get_by_role('heading', name='Your projects', exact=True).wait_for()
    rows = page.locator('.project-list-row')
    assert rows.count() > 0, 'This read-only regression requires saved projects'
    assert rows.first.bounding_box()['y'] < 620, 'Saved work should be visible on arrival'
    assert page.locator('.intake-layout').count() == 0, 'Creation must not displace saved work'
    project_items = page.request.get(BASE + '/api/workspace').json()['items']
    first = next(item for item in project_items if item['kind'] == 'project' and item.get('open_job_id'))
    exact_source = page.request.get(BASE + '/api/jobs/' + first['open_job_id']).json()['source']
    assert exact_source not in rows.first.inner_text(), 'Private source path must not dominate the library'
    assert 'Review finished' not in page.locator('main').inner_text(), 'Worker completion must not be a success verdict'
    page.screenshot(path=str(OUT / 'home-desktop.png'))
    rows.first.click()
    page.locator('.project-heading h1').wait_for()
    page.locator('.source-disclosure summary').click()
    assert page.locator('.source-disclosure code').inner_text() == exact_source
    page.locator('.source-disclosure summary').click()
    page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='Projects', exact=True).click()
    page.locator('.project-list-row').first.click()
    page.locator('.project-heading h1').wait_for()
    assert page.locator('.loading-surface[aria-busy="true"]').count() == 0
    all_jobs = page.request.get(BASE + '/api/jobs').json()
    candidate = next((job for job in all_jobs
                      if len(page.request.get(BASE + '/api/jobs/' + job['id']).json().get('findings', [])) >= 6), None)
    assert candidate, 'A saved review with six findings is required for deep-link regression'
    page.goto(BASE + '/?job=' + quote(candidate['id']), wait_until='networkidle')
    page.locator('.project-heading h1').wait_for()
    job_url = page.url
    nav = page.get_by_role('navigation', name='Review sections')
    nav.get_by_role('button', name='Checks', exact=True).click()
    page.get_by_role('heading', name='Execution results', exact=True).wait_for()
    assert page.get_by_role('button', name='Run checks', exact=True).count() == 1
    assert 'view=execution' in page.url
    page.reload(wait_until='networkidle')
    page.get_by_role('heading', name='Execution results', exact=True).wait_for()
    nav.get_by_role('button', name='Findings', exact=False).click()
    page.get_by_role('heading', name='What PRAXIS found', exact=True).wait_for()
    page.go_back(wait_until='networkidle')
    page.get_by_role('heading', name='Execution results', exact=True).wait_for()
    page.go_forward(wait_until='networkidle')
    page.get_by_role('heading', name='What PRAXIS found', exact=True).wait_for()
    target = page.locator('.finding-row > button').nth(1)
    target.click()
    selected_title = page.locator('.evidence-inspector h2').inner_text()
    assert 'finding=' in page.url
    page.reload(wait_until='networkidle')
    assert page.locator('.evidence-inspector h2').inner_text() == selected_title
    page.screenshot(path=str(OUT / 'findings-desktop.png'))
    # Unknown view input falls back safely to the existing Overview.
    page.goto(job_url + '&view=invalid-section', wait_until='networkidle')
    nav.get_by_role('button', name='Overview', exact=True).wait_for()
    assert nav.get_by_role('button', name='Overview', exact=True).get_attribute('aria-current') == 'page'
    page.get_by_role('button', name='New review', exact=True).click()
    page.get_by_role('heading', name='Start a review', exact=True).wait_for()
    assert page.url.endswith('?new=1')
    assert not page.locator('.review-details').evaluate('(node) => node.open')
    assert page.get_by_role('button', name='Review project', exact=True).is_disabled()
    page.screenshot(path=str(OUT / 'intake-desktop.png'))
    # Desktop's native folder picker still only prefills the form.
    page.goto(BASE + '/?project=' + quote('E:/example/project with spaces'), wait_until='networkidle')
    source = page.get_by_label('Project folder path', exact=False)
    assert source.input_value() == 'E:/example/project with spaces'
    assert 'project=' not in page.url and 'new=1' in page.url
    assert not page.locator('.review-details').evaluate('(node) => node.open')
    page.set_viewport_size({'width': 390, 'height': 900})
    page.goto(job_url + '&view=findings', wait_until='networkidle')
    page.locator('.finding-row > button').first.wait_for()
    assert page.locator('.finding-queue').is_visible()
    assert not page.locator('.evidence-inspector').is_visible()
    page.locator('.finding-row > button').nth(1).click()
    assert page.locator('.evidence-inspector').is_visible()
    assert not page.locator('.finding-queue').is_visible()
    mobile_title = page.locator('.evidence-inspector h2').inner_text()
    page.screenshot(path=str(OUT / 'finding-detail-mobile.png'))
    page.reload(wait_until='networkidle')
    assert page.locator('.evidence-inspector h2').inner_text() == mobile_title
    page.get_by_role('button', name='Back to findings').click()
    assert page.locator('.finding-queue').is_visible()
    assert not page.locator('.evidence-inspector').is_visible()
    assert 'finding=' not in page.url
    lower_row = page.locator('.finding-row > button').nth(5)
    lower_row.scroll_into_view_if_needed()
    list_position = page.evaluate('window.scrollY')
    lower_row.click()
    page.get_by_role('button', name='Back to findings').click()
    page.wait_for_function('(expected) => Math.abs(window.scrollY - expected) <= 20', arg=list_position,
                           timeout=2000)
    page.evaluate('window.scrollTo(0, 0)')
    page.screenshot(path=str(OUT / 'findings-mobile.png'))
    page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='Projects', exact=True).click()
    for width in (320, 390, 768, 1024, 1440):
        page.set_viewport_size({'width': width, 'height': 900})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 2'), width
        assert page.evaluate("""() => [...document.querySelectorAll('.project-list-main strong')].every(title => {
            const column = title.parentElement.getBoundingClientRect();
            const range = document.createRange(); range.selectNodeContents(title);
            return [...range.getClientRects()].every(box => box.right <= column.right + 2);
        })"""), f'Project title collides with review state at {width}px'
        if width == 390:
            page.screenshot(path=str(OUT / 'home-mobile.png'))
    for theme in ('light', 'dark'):
        page.evaluate('(theme) => document.documentElement.dataset.theme = theme', theme)
        page.add_script_tag(path=str(ROOT / 'node_modules' / 'axe-core' / 'axe.min.js'))
        violations = page.evaluate("async () => (await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations")
        assert not violations, [(v['id'], [n['target'] for n in v['nodes']]) for v in violations]
    assert not errors, errors
    assert not writes, writes
    browser.close()
    (OUT / 'result.json').write_text(json.dumps({'passed': True, 'widths': [320,390,768,1024,1440], 'writes': writes, 'errors': errors}, indent=2))
print('PASS project workspace: real saved projects, URL restoration, native prefill, five widths, two-theme accessibility, zero writes')
