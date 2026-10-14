"""User-level production browser QA; no model calls, mocked API or stored keys."""
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

url, folder = sys.argv[1:]
root = Path(folder)
origin = urlparse(url).scheme + '://' + urlparse(url).netloc


def snapshot(page, name):
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 2'), name + ' has horizontal overflow'
    page.evaluate("scrollTo({top: 0, behavior: 'instant'})")
    page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    page.screenshot(path=str(root / (name + '.png')), full_page=True, animations='disabled')


def completed(context, job_id):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        response = context.request.get(origin + '/api/jobs/' + job_id)
        assert response.ok, response.text()
        job = response.json()
        if job['status'] not in {'scanning', 'analyzing', 'verifying', 'planning_fix', 'fixing'}:
            assert job['status'] == 'complete', job
            return job
        time.sleep(.2)
    raise AssertionError('Review did not finish within the smoke deadline.')


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1280, 'height': 900})
    page = context.new_page()
    errors = []
    event_streams = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('response', lambda response: event_streams.append(response.url) if
            response.status == 200 and '/events' in response.url and
            'text/event-stream' in response.headers.get('content-type', '') else None)
    page.goto(url, wait_until='networkidle')
    unauthenticated = playwright.request.new_context()
    denied = unauthenticated.get(origin + '/api/health')
    assert denied.status == 401, 'The private backend was reachable without a browser session'
    unauthenticated.dispose()
    page.get_by_role('button', name='Local path', exact=True).click()
    page.get_by_label('Project folder path').fill(str(root / 'true-change'))
    page.get_by_label('What should it do?', exact=False).fill('Save an item and independently observe the stored count.')
    page.get_by_role('button', name='Review project', exact=True).click()
    page.wait_for_url(re.compile(r'.*job=.*'))
    job_id = parse_qs(urlparse(page.url).query)['job'][0]
    captured = completed(context, job_id)
    assert captured['review_goal'] == 'Save an item and independently observe the stored count.'
    assert not captured['checks'] and captured['cost'] == 0, 'Source intake executed commands or spent model budget'
    rejected = context.request.post(origin + '/api/jobs/' + job_id + '/verify', data={'trust_confirmed': False})
    assert rejected.status == 403, 'A gateway request bypassed execution consent'
    page.get_by_label('More review sections').select_option('workspace')
    page.get_by_label('What needs doing?', exact=True).fill('Verify stored item behavior')
    page.get_by_label('Context and expected outcome', exact=True).fill('Saving should change the backend count, not only display a success message.')
    page.get_by_label('Assign to', exact=True).select_option('agent:agent-1')
    page.get_by_role('checkbox', name='Share this assignment', exact=False).check()
    page.get_by_role('button', name='Create task', exact=True).click()
    page.locator('.project-task-list summary strong').filter(has_text='Verify stored item behavior').wait_for()
    page.get_by_label('What should future reviewers know?', exact=True).fill('This private note is not shared with model reviewers.')
    page.get_by_role('button', name='Save context', exact=True).click()
    page.get_by_text('This private note is not shared with model reviewers.', exact=True).wait_for()
    page.get_by_label('What needs doing?', exact=True).fill('Plan the independent backend check')
    page.get_by_label('Context and expected outcome', exact=True).fill('Provide exact source files and validation steps; do not change code.')
    page.get_by_label('Assign to', exact=True).select_option('agent:cli-qa-coder')
    page.get_by_role('checkbox', name='Share this assignment', exact=False).check()
    page.get_by_role('button', name='Create task', exact=True).click()
    assigned = page.locator('.project-task-list details').filter(has=page.get_by_text('Plan the independent backend check', exact=True))
    assigned.locator('summary').click()
    assigned.get_by_role('button', name='Run assigned agent plan', exact=True).click()
    start_agent = assigned.get_by_role('button', name='Start plan run', exact=True)
    assert start_agent.is_disabled(), 'Agent execution bypassed consent'
    assigned.get_by_role('checkbox', name='I trust this coding agent', exact=False).check()
    assert start_agent.is_disabled(), 'Agent execution bypassed separate account-spend consent'
    assigned.get_by_role('checkbox', name='I accept charges', exact=False).check()
    with page.expect_response(lambda response: '/run-agent' in response.url and response.request.method == 'POST') as started_agent:
        start_agent.click()
    assert started_agent.value.ok, started_agent.value.text()
    agent_job = completed(context, job_id)
    assert agent_job['agent_run']['status'] == 'completed' and agent_job['agent_run']['exit_code'] == 0, agent_job
    assert agent_job['agent_run']['verification'] == 'not_evaluated', agent_job
    assert not agent_job['checks'] and agent_job['cost'] == 0, 'A plan fabricated execution proof or changed the model budget'
    page.get_by_label('Coding agent result', exact=True).get_by_text('Plan: inspect server.js', exact=False).wait_for()
    snapshot(page, 'workspace-desktop')
    page.set_viewport_size({'width': 390, 'height': 844}); snapshot(page, 'workspace-mobile')
    page.get_by_role('navigation', name='Review sections').get_by_role('button', name='Checks', exact=True).click()
    page.get_by_role('button', name='Run checks', exact=True).click()
    dialog = page.get_by_role('dialog')
    dialog.get_by_label('Execution environment').select_option('host')
    dialog.get_by_label('Browser start command', exact=False).fill('node server.js')
    dialog.get_by_role('checkbox', name='Observe a user workflow', exact=False).check()
    dialog.get_by_label('Workflow depth').select_option('structured')
    dialog.get_by_label('Journey name', exact=True).fill('Save an item')
    dialog.get_by_label('Step 2 action', exact=True).select_option('fill')
    step = dialog.locator('.journey-steps > li').nth(1)
    step.get_by_label('Accessible name', exact=True).fill('Title')
    step.get_by_label('Test input', exact=False).fill('QA item')
    dialog.get_by_label('Step 3 action', exact=True).select_option('click')
    dialog.locator('.journey-steps > li').nth(2).get_by_label('Accessible name', exact=True).fill('Save')
    dialog.get_by_role('button', name='Add step', exact=True).click()
    dialog.locator('.journey-steps > li').nth(3).get_by_label('Text that should become visible', exact=True).fill('Saved')
    dialog.get_by_role('button', name='Add state check', exact=True).click()
    dialog.get_by_label('What should change?', exact=True).fill('Stored item count')
    dialog.get_by_label('Local API route', exact=True).fill('/api/items')
    dialog.get_by_label('JSON value path', exact=False).fill('/count')
    dialog.get_by_label('Value type', exact=True).select_option('number')
    dialog.get_by_label('Expected value', exact=True).fill('1')
    dialog.get_by_role('checkbox', name='I trust this project', exact=False).check()
    snapshot(page, 'journey-editor-mobile')
    page.set_viewport_size({'width': 1280, 'height': 900}); snapshot(page, 'journey-editor-desktop')
    dialog.get_by_role('button', name='Run authorized checks', exact=True).click()
    dialog.wait_for(state='hidden')
    true_job = completed(context, job_id)
    journey = next(check for check in true_job['checks'] if check['name'] == 'Save an item')
    assert journey['status'] == 'passed' and journey['evidence_scope'] == 'user_journey', journey
    assert 'QA item' not in json.dumps(true_job), 'Transient input leaked into public job'
    page.get_by_role('navigation', name='Review sections').get_by_role('button', name='Checks', exact=True).click()
    page.get_by_text('Save an item', exact=False).first.wait_for()
    snapshot(page, 'true-journey-result')
    page.get_by_label('More review sections').select_option('evidence')
    page.get_by_role('heading', name='Evidence beyond the review copy', exact=True).wait_for()
    snapshot(page, 'evidence-panel')

    response = context.request.post(origin + '/api/scans', data={'source': str(root / 'false-success'), 'ai_review': False, 'run_checks': False})
    assert response.ok, response.text()
    false_id = response.json()['id']; completed(context, false_id)
    spec = {'name': 'False save report', 'steps': [{'action': 'navigate', 'path': '/'},
        {'action': 'fill', 'role': 'textbox', 'control_name': 'Title', 'value': 'QA false input'},
        {'action': 'click', 'role': 'button', 'control_name': 'Save'}, {'action': 'assert_text', 'text': 'Saved'}],
        'state_assertions': [{'name': 'Stored item count', 'path': '/api/items', 'json_pointer': '/count', 'expected': 1, 'require_change': True}]}
    response = context.request.post(origin + '/api/jobs/' + false_id + '/verify', data={'trust_confirmed': True, 'runtime_mode': 'host', 'start_command': 'node server.js', 'journey': spec})
    assert response.ok, response.text()
    false_job = completed(context, false_id)
    result = next(check for check in false_job['checks'] if check['name'] == 'False save report')
    assert result['status'] == 'failed' and result.get('false_success'), result
    assert result['evidence_scope'] != 'user_journey', result
    assert false_job['assessment']['readiness']['status'] != 'release_candidate'
    page.goto(origin + '/?job=' + false_id, wait_until='domcontentloaded')
    page.get_by_role('navigation', name='Review sections').get_by_role('button', name='Checks', exact=True).click()
    page.get_by_text('False save report', exact=False).first.wait_for()
    snapshot(page, 'false-success-result')

    page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='Projects', exact=True).click()
    page.get_by_role('button', name='New review', exact=True).click()
    page.get_by_role('button', name='Upload folder', exact=True).click()
    page.get_by_label('Upload project folder', exact=True).set_input_files(str(root / 'upload-project'))
    page.get_by_text('2 files ready', exact=False).wait_for()
    page.get_by_role('button', name='Review project', exact=True).click()
    page.wait_for_url(re.compile(r'.*job=.*'))
    upload_id = parse_qs(urlparse(page.url).query)['job'][0]
    uploaded = completed(context, upload_id)
    assert uploaded['source'].startswith('upload://') and uploaded['files_scanned'] == 2, uploaded
    assert not uploaded['checks'] and uploaded['cost'] == 0, 'Folder intake executed uploaded code or spent model budget'
    assert 'excluded-before-upload' not in json.dumps(uploaded), 'Excluded credential reached the review'
    assert (root / 'upload-project' / '.env').read_text() == 'QA_UPLOAD_SECRET=excluded-before-upload\n'
    assert any(finding['title'] == 'Debug mode is explicitly enabled' for finding in uploaded['findings']), uploaded
    page.get_by_label('More review sections').select_option('source map')
    page.get_by_label('Find source file', exact=True).fill('app.py')
    page.locator('.file-list').get_by_role('button', name='app.py', exact=True).click()
    assert page.locator('.relationship-detail > code').inner_text() == 'app.py'
    page.get_by_role('navigation', name='Review sections').get_by_role('button', name='Overview', exact=True).click()
    page.locator('details.review-share > summary').click()
    page.get_by_role('button', name='Download brief', exact=True).wait_for()
    with page.expect_download() as download_info:
        page.get_by_role('button', name='Download brief', exact=True).click()
    download = download_info.value
    assert not download.failure()
    brief = Path(download.path()).read_text(encoding='utf-8')
    (root / 'upload-agent-brief.txt').write_text(brief, encoding='utf-8')
    assert 'Debug mode is explicitly enabled' in brief and 'No project execution outcome was recorded' in brief
    assert 'excluded-before-upload' not in brief
    page.get_by_role('navigation', name='Review sections').get_by_role('button', name='Findings', exact=True).click()
    page.get_by_label('Search findings', exact=True).fill('Debug mode')
    assert page.get_by_role('button', name='Draft a fix plan', exact=True).is_disabled(), 'The UI fabricated a configured provider'
    snapshot(page, 'upload-findings-desktop')
    page.set_viewport_size({'width': 390, 'height': 844}); snapshot(page, 'upload-findings-mobile')
    assert event_streams, 'The UI never received its real backend event stream'
    assert not errors, errors
    (root / 'result.json').write_text(json.dumps({'true_job': job_id, 'false_job': false_id, 'upload_job': upload_id,
        'true_result': journey, 'false_result': result, 'upload_files': uploaded['files_scanned'],
        'event_stream_observed': bool(event_streams), 'agent_brief_downloaded': True, 'coding_agent_plan_run': True,
        'browser_errors': errors}, indent=2), encoding='utf-8')
    browser.close()
    print('PASS real UI, authentication, trust consent, responsive editor, persistent backend change, false-success detection, folder upload, source map and agent handoff')
