"""Real WebAssembly scanner, real file picker, no stubbed review responses."""
import functools
import json
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
ARTIFACTS = Path(os.environ.get('PRAXIS_SMOKE_ARTIFACT_DIR', str(ROOT / 'apps/workbench/.regen/artifacts')))
if not ARTIFACTS.is_absolute():
    raise ValueError('PRAXIS_SMOKE_ARTIFACT_DIR must be an absolute path')
BASE = os.environ.get('PRAXIS_BROWSER_BASE', 'http://127.0.0.1:4188').rstrip('/')


def audit(page, state):
    page.wait_for_load_state('load')
    assert page.evaluate('getComputedStyle(document.body).backgroundColor') != 'rgba(0, 0, 0, 0)', 'Product stylesheet did not load'
    # DevTools injection audits the real DOM without relaxing the product CSP.
    axe = ROOT / 'apps/workbench/node_modules/axe-core/axe.min.js'
    page.evaluate(axe.read_text(encoding='utf-8'))
    violations = page.evaluate("async () => (await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations")
    assert not violations, (state, [{'id': item['id'], 'targets': [node['target'] for node in item['nodes']]} for item in violations], page.locator('.skip-link').evaluate('(node) => ({focused: node === document.activeElement, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, top: node.getBoundingClientRect().top, clip: getComputedStyle(node).clipPath})'))
    for width in [320, 390, 768, 1024, 1440]:
        page.set_viewport_size({'width': width, 'height': 900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (state, width)


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(ROOT / 'web'))
    server = ThreadingHTTPServer(('127.0.0.1', 4188), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    errors, requests, results = [], [], []
    with TemporaryDirectory(prefix='praxis-browser-') as temp, sync_playwright() as p:
        folder = Path(temp) / 'project'
        folder.mkdir()
        (folder / 'app.py').write_text('def create_order():\n    return {"success": True}\n', encoding='utf-8')
        (folder / 'broken.py').write_text('def broken(:\n    pass\n', encoding='utf-8')
        (folder / '.env').write_text('API_KEY=never-show-private-key\n', encoding='utf-8')
        (folder / 'package.json').write_text('{"name":"browser-smoke","scripts":{"test":"node --test"}}', encoding='utf-8')
        (folder / 'node_modules').mkdir()
        (folder / 'node_modules/dummy.py').write_text('def invalid(:\n', encoding='utf-8')
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(permissions=['clipboard-read','clipboard-write'])
        bypass = os.environ.get('PRAXIS_PREVIEW_BYPASS')
        if bypass:
            # Deployment-scoped share link establishes a same-origin cookie.
            # The setup URL and cookies never enter the browser request log or
            # get forwarded to the Pyodide CDN.
            assert BASE.startswith('https://') and BASE.endswith('.vercel.app')
            access = context.request.get(BASE + '/?_vercel_share=' + bypass)
            assert access.ok and 'Test Your Project' in access.text(), 'Owned preview is not accessible'
        page = context.new_page()
        context.on('request', lambda request: requests.append({'url': request.url, 'method': request.method}))
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE + '/')
        page.get_by_role('link', name='Test Your Project').click()
        page.get_by_role('heading', name='Test your project', exact=True).wait_for()
        audit(page, 'empty')
        page.locator('#folder').set_input_files(str(folder))
        page.locator('#run').click()
        try:
            page.locator('#results:not([hidden]), #error:not([hidden])').wait_for(timeout=130000)
            assert page.locator('#error').is_hidden(), page.locator('#error').inner_text()
            assert page.get_by_text('Python source cannot be parsed', exact=True).count() == 1
            assert page.get_by_text('Write-named function returns constant success', exact=True).count() == 1
            prompt = page.locator('#prompt').input_value()
            assert 'never-show-private-key' not in prompt
            assert 'node_modules/dummy.py' not in prompt
            assert 'app.py:2' in prompt and 'broken.py:1' in prompt
            assert 'NOT EXECUTED' in prompt and 'Confirm the plan with me' in prompt
            page.get_by_role('button', name='Copy agent prompt').click()
            page.get_by_text('Agent prompt copied. Review and confirm the plan in your agent.', exact=True).wait_for()
            assert page.evaluate('navigator.clipboard.readText()').replace('\r\n', '\n') == prompt.replace('\r\n', '\n')
            audit(page, 'broken-source findings')
            page.set_viewport_size({'width': 1440, 'height': 1000})
            page.screenshot(path=str(ARTIFACTS / 'browser-review-findings.png'), full_page=True)
            results.append({'scenario': 'real broken source', 'findings': page.locator('.finding').count(), 'copy': True, 'excluded_credentials_and_dependencies': True})
            page.get_by_role('button', name='Clear review').click()
            assert page.locator('#results').is_hidden()
            (folder / 'app.py').write_text('def total(a, b):\n    return a + b\n', encoding='utf-8')
            (folder / 'broken.py').unlink()
            page.locator('#folder').set_input_files(str(folder))
            page.locator('#run').click()
            page.get_by_role('heading', name='No matches in the completed source checks').wait_for(timeout=130000)
            assert 'remains unestablished' in page.locator('#result-summary').inner_text()
            assert page.locator('.finding').count() == 0
            assert 'Do not invent a defect' in page.locator('#prompt').input_value()
            audit(page, 'clean-source findings')
            results.append({'scenario':'real clean source','findings':0,'runtime_not_claimed':True})
            # Clipboard rejection cannot be presented as a successful transfer.
            page.evaluate("() => { navigator.clipboard.writeText = () => Promise.reject(new DOMException('Clipboard blocked', 'NotAllowedError')); }")
            page.get_by_role('button', name='Copy agent prompt').click()
            page.get_by_text('Clipboard access was blocked. The prompt is selected; copy it manually.', exact=True).wait_for()
            assert page.locator('#prompt').evaluate('(node) => node.selectionEnd - node.selectionStart === node.value.length')
            results.append({'scenario': 'clipboard denied', 'manual_copy_available': True})
            page.get_by_role('button', name='Clear review').click()
            assert not page.locator('#prompt').input_value()
            assert page.locator('#findings').inner_text() == ''
            # Stop during real initialization; no result is substituted.
            page.locator('#folder').set_input_files(str(folder))
            page.locator('#run').click()
            page.get_by_role('button', name='Stop inspection').click()
            assert page.locator('#results').is_hidden()
            assert 'No result was produced' in page.locator('#progress').inner_text()
            results.append({'scenario': 'cancelled inspection', 'result_absent': True})
            # A real engine integrity failure must stop before source checking.
            manifest = json.loads((ROOT / 'web/test-your-project/engine/manifest.json').read_text())
            manifest['files']['scanner.py'] = '0' * 64
            context.route('**/test-your-project/engine/manifest.json', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps(manifest)))
            page.get_by_role('button', name='Inspect source').click()
            page.get_by_text('Analysis engine version mismatch. Refresh before reviewing.', exact=True).wait_for(timeout=130000)
            assert page.locator('#results').is_hidden()
            audit(page, 'integrity failure')
            results.append({'scenario': 'engine hash mismatch', 'result_absent': True})
            assert all(item['method'] == 'GET' for item in requests), requests
            assert not errors, errors
            ARTIFACTS.mkdir(parents=True, exist_ok=True)
            (ARTIFACTS / 'browser-review-smoke.json').write_text(json.dumps({'results':results,'network':requests,'javascript_errors':errors}, indent=2), encoding='utf-8')
            print(json.dumps({'base': BASE, 'results':results,'axe_violations':0,'javascript_errors':errors,'source_upload_requests':0}))
        finally:
            browser.close()
            server.shutdown()


if __name__ == '__main__':
    main()
