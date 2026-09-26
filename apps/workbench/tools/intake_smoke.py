"""Real folder upload and optional GitHub clone; never calls a model or executes projects."""
import argparse
import json
import tempfile
import threading
import uuid
from pathlib import Path
import sys

import httpx
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'backend'))
from regen.scanner import prepare_project, safe_files

parser = argparse.ArgumentParser()
parser.add_argument('--github', action='store_true')
args = parser.parse_args()
artifacts = root / '.regen' / 'artifacts'
artifacts.mkdir(parents=True, exist_ok=True)
report = {'model_calls': 0, 'source_application': False}
if args.github:
    prepared = prepare_project('https://github.com/vaishak-v-nair/Zentara.git/',
                               artifacts / ('github-intake-' + uuid.uuid4().hex),
                               lambda _: None, threading.Event())
    assert prepared['name'] == 'Zentara'
    assert (Path(prepared['path']) / 'app.py').is_file()
    report['github_clone'] = 'passed'
    report['github_files'] = len(list(safe_files(Path(prepared['path']))))

with tempfile.TemporaryDirectory(prefix='praxis-upload-ui-') as temp, sync_playwright() as runtime:
    folder = Path(temp) / 'BrowserProject'
    folder.mkdir()
    (folder / 'app.py').write_text('DEBUG = True\nprint("upload fixture")\n')
    (folder / '.env').write_text('API_KEY=private-upload-sentinel')
    ignored = folder / 'node_modules'
    ignored.mkdir()
    (ignored / 'dependency.js').write_text('ignored dependency')
    browser = runtime.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors, uploads, scans = [], [], []
    page.on('pageerror', lambda _: errors.append('JavaScript runtime error'))
    def capture(request):
        if request.url.endswith('/api/uploads'):
            uploads.append(request.post_data_json)
    page.on('request', capture)
    def block_model_scan(route):
        scans.append(route.request.post_data_json)
        route.fulfill(status=422, content_type='application/json', body=json.dumps({'detail': 'Intake smoke: model scan deliberately not started.'}))
    page.route('**/api/scans', block_model_scan)
    page.goto('http://127.0.0.1:3000', wait_until='networkidle')
    page.get_by_text('Backend connected', exact=True).wait_for()
    page.get_by_role('tab', name='Upload folder', exact=True).click()
    page.locator('input[type=file]').set_input_files(str(folder))
    page.get_by_role('status').filter(has_text='1 file ready').wait_for()
    assert uploads and len(uploads[0]['files']) == 1
    assert uploads[0]['files'][0]['path'] == 'BrowserProject/app.py'
    assert 'private-upload-sentinel' not in json.dumps(uploads)
    assert page.locator('#project-source').input_value() == 'BrowserProject'
    for width in (320, 390, 768, 1440):
        page.set_viewport_size({'width': width, 'height': 900})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 2'), f'Upload overflow at {width}px'
    page.screenshot(path=str(artifacts / 'praxis-folder-upload.png'), full_page=True)
    page.get_by_role('button', name='Scan project', exact=True).click()
    page.get_by_role('alert').filter(has_text='model scan deliberately not started').wait_for()
    assert scans and scans[0]['source'].startswith('upload://')
    with httpx.Client() as client:
        assert client.post('http://127.0.0.1:9123/api/uploads', json={}, headers={'origin':'https://evil.example'}).status_code == 403
        assert client.post('http://127.0.0.1:9123/api/uploads', content='files=bad', headers={'content-type':'application/x-www-form-urlencoded'}).status_code == 415
    assert not errors
    browser.close()
    report.update(folder_upload='passed', credential_dependency_exclusion='passed', scan_handoff='passed', upload_guards='passed', javascript_errors=errors)
(artifacts / 'intake-smoke.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
