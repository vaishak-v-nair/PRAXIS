"""Frontend contracts and accessibility against the running production app.

Real intake/Docker execution lives in assessment_smoke.py and intake_smoke.py.
This suite uses explicitly synthetic API states for errors/paused/patch controls.
"""
import copy
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / '.regen' / 'artifacts'
ARTIFACTS.mkdir(parents=True, exist_ok=True)
BASE = 'http://127.0.0.1:3000'
reports = []


def audit(page, name):
    previous_theme = page.locator('html').get_attribute('data-theme') or 'light'
    page.add_script_tag(path=str(ROOT / 'node_modules' / 'axe-core' / 'axe.min.js'))
    for theme in ('light', 'dark'):
        # Presentation-only CSS audit. Real appearance interactions are tested
        # separately; these DOM states do not represent backend evidence.
        page.evaluate('(theme) => document.documentElement.dataset.theme = theme', theme)
        result = page.evaluate("async () => (await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations")
        failures = [{'id': item['id'], 'targets': [node['target'] for node in item['nodes']]} for item in result]
        assert not failures, (name, theme, failures)
        for width in (320, 390, 768, 1024, 1440):
            page.set_viewport_size({'width': width, 'height': 1000})
            page.wait_for_timeout(80)
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 2'), (name, theme, width)
            escaped = page.evaluate("""() => {
                const cards = '.metric-strip > article,.pressure-grid > article,.dimension-grid > article,.attention-item,.evidence-inspector,.method-panel,.handoff-option';
                const failures = [];
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                while (walker.nextNode()) {
                    const text = walker.currentNode, parent = text.parentElement, card = parent?.closest(cards);
                    if (!card || !text.textContent.trim() || !parent.checkVisibility() || parent.closest('pre,textarea,svg,[hidden]')) continue;
                    const boundary = card.getBoundingClientRect();
                    const range = document.createRange(); range.selectNodeContents(text);
                    for (const box of range.getClientRects()) if (box.width && (box.right > boundary.right + 2 || box.left < boundary.left - 2)) {
                        failures.push({card: card.className, element: parent.tagName, text: text.textContent.slice(0, 80)}); break;
                    }
                }
                return failures;
            }""")
            assert not escaped, (name, theme, width, escaped)
    page.evaluate('(theme) => document.documentElement.dataset.theme = theme', previous_theme)
    reports.append({'view': name, 'themes': ['light', 'dark'], 'axe_violations': 0, 'widths': [320, 390, 768, 1024, 1440]})


with sync_playwright() as runtime:
    browser = runtime.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce',
                                  permissions=['clipboard-read', 'clipboard-write'])
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE, wait_until='networkidle')
    page.get_by_text('Local service connected', exact=True).wait_for()
    page.get_by_role('button', name='Use light theme').click()
    assert page.locator('html').get_attribute('data-theme') == 'light'
    page.get_by_role('button', name='Use dark theme').click()
    assert page.locator('html').get_attribute('data-theme') == 'dark'
    page.reload(wait_until='networkidle')
    page.get_by_role('button', name='Use light theme').wait_for()
    assert page.locator('html').get_attribute('data-theme') == 'dark', 'Appearance did not survive reload'
    page.get_by_role('button', name='Use light theme').click()
    audit(page, 'home')
    page.screenshot(path=str(ARTIFACTS / 'lab-home-desktop.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(ARTIFACTS / 'lab-home-mobile.png'), full_page=True)
    models = page.get_by_role('button', name='Models', exact=True)
    models.focus(); page.keyboard.press('Enter')
    page.get_by_role('dialog', name='Model connection').wait_for()
    audit(page, 'model-dialog')
    for _ in range(18):
        page.keyboard.press('Tab')
        assert page.evaluate("!!document.activeElement.closest('dialog')"), 'Focus escaped modal'
    page.keyboard.press('Escape')
    page.wait_for_function("document.activeElement?.textContent.includes('Models')")
    assert models.evaluate('(element) => element === document.activeElement'), 'Focus did not restore'
    page.get_by_role('button', name='Guide', exact=True).click()
    audit(page, 'guide-dialog')
    page.keyboard.press('Escape')

    # Deterministic UI-only states; never presented as live backend evidence.
    fixture = {'id': 'ui-fixture', 'name': 'UI contract fixture', 'source': 'E:/synthetic/project', 'status': 'complete', 'revision': 1,
               'budget': 5, 'cost': .02, 'files_scanned': 4, 'languages': ['Python'], 'events': [],
               'commands': [['python', '-m', 'unittest']],
               'findings': [{'id': 'f1', 'title': 'Debug mode enabled', 'category': 'security', 'severity': 'high', 'confidence': 'confirmed',
                             'description': 'Synthetic frontend test data', 'why': 'Debug output may expose details.', 'fix': 'Disable debug mode.',
                             'location': {'file': 'app.py', 'line': 1}, 'evidence': 'DEBUG = True', 'fixable': True}],
               'checks': [{'name': 'python -m unittest', 'kind': 'command', 'runtime': 'docker', 'status': 'failed', 'output': 'Synthetic assertion failed', 'exit_code': 1}],
               'coverage': [{'name': 'Synthetic scanner', 'status': 'skipped', 'detail': 'Testing the skipped state'}],
               'plan': {'manifests': ['requirements.txt'], 'test_file_count': 1, 'test_files': ['test_app.py'],
                        'understanding': {'languages': ['Python'], 'entrypoints': ['app.py'], 'planning_files': ['README.md'],
                                          'commands_discovered': 1, 'continuity': {'status': 'available',
                                          'detail': 'Synthetic local memory signal; contents remain private.'}},
                        'graph': {'nodes': ['app.py', 'test_app.py'], 'edges': [{'source': 'test_app.py', 'target': 'app.py'}],
                                  'indexed_files': 2, 'eligible_files': 2, 'limited': False}},
               'fix_plan': {'id': 'a' * 24, 'finding_ids': ['f1'], 'source_kind': 'local', 'objective': 'Disable debug mode safely.',
                            'assumptions': [], 'steps': [{'title': 'Update configuration', 'intent': 'Disable debug output',
                            'files': ['app.py'], 'validation': 'Run the regression suite', 'risk': 'Startup diagnostics may change'}],
                            'user_journeys': ['Start the app normally'], 'unresolved': [],
                            'delivery': {'method': 'guarded_local_apply', 'summary': 'Fingerprint, backup and rollback before local apply.'},
                            'planner': {'provider': 'fixture', 'model': 'fixture'}},
               'pressure_tests': [{'agent': 'User journey agent', 'journeys': [{'name': 'Start app', 'result': 'works', 'evidence': 'Synthetic UI contract'}],
                                   'gaps': [], 'findings_added': 0}],
               'assessment': {'title': 'Review findings and failed checks', 'status': 'attention', 'commands_passed': 0, 'checks_failed': 1, 'gaps': ['Synthetic coverage gap'],
                              'implementation': {'status': 'contradicted', 'label': 'Observed behavior is failing',
                                                 'detail': 'A synthetic executed check failed.', 'evidence': ['python -m unittest']},
                               'readiness': {'status': 'blocked', 'label': 'Production readiness is blocked',
                                            'detail': 'Resolve the recorded blocker.', 'blockers': ['CHECK: python -m unittest'],
                                            'requirements': ['Run the failed behavioral test successfully.']},
                               'dimensions': [{'id': 'understanding', 'label': 'Project understanding', 'status': 'observed',
                                              'detail': 'Two inspectable inventory records.', 'evidence_count': 2,
                                              'evidence': [{'kind': 'inventory', 'label': 'Reviewable source inventory', 'status': 'observed', 'detail': '4 files indexed.', 'source': 'source snapshot'},
                                                           {'kind': 'source_graph', 'label': 'Resolved local imports', 'status': 'observed', 'detail': '1 relationship.', 'source': 'static import graph'}],
                                              'limits': ['Inventory does not prove runtime behavior.']},
                                             {'id': 'security', 'label': 'Security and leakage', 'status': 'blocked',
                                              'detail': 'One high finding.', 'evidence_count': 1,
                                              'evidence': [{'kind': 'finding', 'label': 'Debug mode enabled', 'status': 'high', 'detail': 'Debug output may expose details.', 'source': 'app.py:1'}],
                                              'limits': []},
                                             {'id': 'runtime', 'label': 'Automated checks', 'status': 'failed',
                                              'detail': 'One check failed.', 'evidence_count': 1,
                                              'evidence': [{'kind': 'command', 'label': 'python -m unittest', 'status': 'failed', 'detail': 'Synthetic assertion failed', 'source': 'docker'}],
                                              'limits': ['A passing command proves only its recorded snapshot.']}]}}
    # Four distinct model reports exercise the balanced grid and preserve the
    # difference between a model hypothesis and executed evidence.
    fixture['pressure_tests'] = [
        {'agent': name, 'provider': 'test-provider', 'model': 'explicit-ui-fixture',
         'journeys': [{'name': 'Recorded fixture journey', 'result': result, 'evidence': 'Synthetic UI evidence, not an executed journey.'}],
         'gaps': ['Context still requires reproduction.'], 'findings_added': index}
        for index, (name, result) in enumerate((('User journey', 'works'), ('Reliability', 'fails'), ('Security', 'uncertain'), ('Production architecture', 'uncertain')))
    ]
    # Long real-world IDs and paths used to escape individual cards even when
    # the page itself had no horizontal scrollbar. This is test-only pressure.
    long_token = 'very_long_identifier_without_spaces_' * 8
    fixture['languages'] = ['Python', long_token]
    fixture['pressure_tests'][0]['provider'] = long_token
    fixture['pressure_tests'][0]['model'] = long_token
    for report in fixture['pressure_tests']:
        report['journeys'][0]['name'] = 'User journey through ' + long_token
        report['journeys'][0]['evidence'] += ' Trace: src/' + long_token + '/route.tsx'
        report['gaps'].append('Inspect src/' + long_token + '/adapter.ts before accepting the behavior.')
    fixture['assessment']['dimensions'][0]['detail'] += ' Reference: ' + long_token
    fixture['assessment']['dimensions'][0]['evidence'][0]['source'] = 'src/' + long_token + '/page.tsx'
    fixture['fix_plan']['steps'][0]['files'] = ['src/' + long_token + '/app.py']
    actions = []
    fixture['assessment']['attention_items'] = [
        {'id': 'ui-action', 'area': 'execution', 'priority': 'high', 'title': 'A project command failed in isolation',
         'summary': 'The command returned a failing result. Its recorded output remains under Execution.',
         'action': 'Inspect the failed test, repair the issue, and rerun checks.', 'source': 'python -m unittest'}]
    for index, area in enumerate(('models', 'findings', 'security'), start=2):
        fixture['assessment']['attention_items'].append({
            'id': f'ui-action-{index}', 'area': area, 'priority': 'medium',
            'title': f'Recorded follow-up action {index}', 'summary': 'Synthetic UI contract evidence.',
            'action': 'Inspect the corresponding evidence.', 'source': 'synthetic fixture'})
    fixture['assessment']['gaps'] = ['Traceback: raw-machine-output-must-not-appear-in-actions']
    fixture_health = {'status': 'ok', 'settings': {'provider': 'groq', 'model': 'fixture-coder'},
                      'providers': [{'name': 'groq', 'configured': True}],
                      'docker': {'ready': True, 'engine': True, 'local_context': True,
                                 'detail': 'Synthetic Docker readiness.',
                                 'images': {'node': {'image': 'node:22-bookworm-slim', 'ready': True}}}}
    def fixture_api(route):
        path = route.request.url.split('/api')[-1]
        if path.endswith('/events'):
            route.fulfill(status=200, content_type='text/event-stream', body=': fixture\n\n')
        elif route.request.method == 'POST':
            actions.append({'path': path, 'body': route.request.post_data_json})
            if path.endswith('/fix'):
                fixture['fix'] = {'diff': '--- a/app.py\n+++ b/app.py\n@@ -1 +1 @@\n-DEBUG = True\n+DEBUG = False\n',
                                  'review': {'approved': False, 'summary': 'Synthetic reviewer concern'}}
            route.fulfill(status=200, content_type='application/json', body=json.dumps(fixture))
        else:
            route.fulfill(status=200, content_type='application/json', body=json.dumps(fixture))
    page.route('**/api/jobs/ui-fixture**', fixture_api)
    page.route('**/api/health', lambda route: route.fulfill(status=200, content_type='application/json',
                                                            body=json.dumps(fixture_health)))
    page.route('**/api/scans', fixture_api)
    page.goto(BASE, wait_until='networkidle')
    page.get_by_label('Project folder path', exact=False).fill('C:/synthetic/project')
    assert page.get_by_role('button', name='Run complete review').is_disabled()
    page.get_by_label('I trust this project and authorize').check()
    page.get_by_role('button', name='Run complete review').click()
    page.get_by_role('heading', name='UI contract fixture', exact=True).wait_for()
    assert actions[-1]['path'] == '/scans'
    assert actions[-1]['body'] == {'source': 'C:/synthetic/project', 'budget': 5, 'ai_review': True,
                                  'review_mode': 'team', 'review_goal': '', 'run_checks': True,
                                  'trust_confirmed': True, 'allow_network': False}
    page.goto(BASE, wait_until='networkidle')
    page.get_by_role('button', name='GitHub URL', exact=True).click()
    page.get_by_label('Repository URL', exact=False).fill('https://github.com/example/synthetic')
    assert page.get_by_role('button', name='Run complete review').is_disabled()
    page.get_by_label('I trust this project and authorize').check()
    page.get_by_role('button', name='Run complete review').click()
    page.get_by_role('heading', name='UI contract fixture', exact=True).wait_for()
    assert actions[-1]['body']['source'] == 'https://github.com/example/synthetic'
    assert actions[-1]['body']['allow_network'] is False
    page.goto(BASE + '/?job=ui-fixture', wait_until='networkidle')
    page.get_by_role('heading', name='UI contract fixture', exact=True).wait_for()
    page.get_by_role('heading', name='Production readiness is blocked', exact=True).wait_for()
    page.get_by_role('heading', name='Observed behavior is failing', exact=True).wait_for()
    page.get_by_text('Evidence still required', exact=True).wait_for()
    page.get_by_role('heading', name='What still needs attention', exact=True).wait_for()
    assert page.locator('.pressure-grid > article').count() == 4
    assert page.get_by_text('Model says works', exact=True).count() == 1
    assert page.get_by_text('Model flags failure', exact=True).count() == 1
    page.get_by_role('heading', name='A project command failed in isolation', exact=True).wait_for()
    assert 'raw-machine-output-must-not-appear-in-actions' not in page.locator('.attention-list').inner_text()
    assert page.locator('.attention-item').count() == 3
    page.get_by_role('button', name='Show all 4 actions').click()
    assert page.locator('.attention-item').count() == 4
    page.get_by_role('button', name='Show fewer actions').click()
    assert page.locator('.attention-item').count() == 3
    page.locator('.attention-item').get_by_role('button', name='Open execution', exact=True).click()
    page.get_by_role('heading', name='Execution results', exact=True).wait_for()
    page.get_by_role('navigation', name='Review sections').get_by_role('button', name='overview', exact=True).click()
    page.get_by_text('2 displayed evidence records', exact=True).wait_for()
    page.get_by_text('Inspect evidence', exact=True).first.click()
    page.get_by_text('Reviewable source inventory', exact=True).wait_for()
    fixture['team'] = {'status': 'partial', 'phase': 'finished', 'goal': 'Synthetic collaborative UI contract',
        'max_parallel': 4, 'agents': [{'id': f'agent-{i}', 'agent': item['agent'],
            'provider': item.get('provider', 'fixture'), 'model': item.get('model', 'fixture'),
            'status': 'complete' if i < 3 else 'unavailable', 'peer_status': 'complete' if i < 3 else 'skipped',
            'findings_added': item['findings_added']} for i, item in enumerate(fixture['pressure_tests'])],
        'discussions': [{'agent_id': 'agent-0', 'agent': 'Security agent', 'finding_id': 'f1',
            'position': 'challenges', 'reason': 'Synthetic source-backed disagreement for layout testing.',
            'location': {'file': long_token, 'line': 1}, 'evidence': long_token}]}
    page.reload(wait_until='networkidle')
    page.get_by_role('heading', name='Specialists working together').wait_for()
    page.get_by_text('Inspect 1 peer comments', exact=False).click()
    page.get_by_text('Challenges finding', exact=True).wait_for()
    assert page.locator('.team-agent-state').count() == 4
    fixture['collaboration'] = {'revision': 2, 'participants': [{'session_id': 'fixture-owner', 'name': 'Owner'}, {'session_id': 'fixture-reviewer', 'name': 'Reviewer'}],
        'notes': [{'id': 'note-1', 'author': 'Owner', 'kind': 'goal', 'text': long_token, 'assigned_to': 'team',
                   'share_with_agents': True, 'created_at': '2026-10-02T00:00:00Z'},
                  {'id': 'note-2', 'author': 'Reviewer', 'kind': 'decision', 'text': 'Synthetic private note', 'assigned_to': 'agent-2',
                   'share_with_agents': False, 'created_at': '2026-10-02T00:00:01Z'}]}
    page.reload(wait_until='networkidle')
    for view in ('overview', 'findings', 'execution', 'changes', 'workspace', 'source map', 'activity'):
        page.get_by_role('navigation', name='Review sections').get_by_role('button', name=view, exact=(view != 'findings')).click()
        if view == 'overview':
            page.locator('.perspective-body details, .perspective-gaps, .dimension-limits').evaluate_all('(nodes) => nodes.forEach(node => node.open = true)')
        audit(page, view)
        if view == 'workspace':
            page.get_by_role('heading', name='One project. A shared review.').wait_for()
            assert page.locator('.shared-discussion li').count() == 2
            assert page.get_by_role('button', name='Post contribution').is_disabled()
        if view == 'findings':
            page.get_by_role('heading', name='What PRAXIS found', exact=True).wait_for()
            page.get_by_text('Fix before release', exact=False).first.wait_for()
            page.screenshot(path=str(ARTIFACTS / 'lab-findings-desktop.png'), full_page=True)
            page.get_by_label('Search findings').fill('absent')
            page.get_by_role('heading', name='No matching findings').wait_for()
            page.get_by_label('Search findings').fill('')
            page.get_by_role('button', name='Draft a fix plan', exact=True).click()
            page.wait_for_timeout(250)
            assert actions[-1]['body']['finding_ids'] == ['f1']
        if view == 'source map':
            page.locator('.source-canvas canvas').wait_for()
            page.locator('.file-list').get_by_role('button', name='test_app.py', exact=True).click()
            assert page.locator('.relationship-detail > code').inner_text() == 'test_app.py'
        if view == 'changes':
            page.get_by_role('heading', name='Disable debug mode safely.').wait_for()
            page.screenshot(path=str(ARTIFACTS / 'lab-fix-plan-desktop.png'), full_page=True)
            page.get_by_role('button', name='Copy AI handoff', exact=True).click()
            page.get_by_role('button', name='Plan copied', exact=True).wait_for()
            page.get_by_role('button', name='Review AI handoff', exact=True).click()
            page.get_by_role('dialog', name='Confirm AI handoff').wait_for()
            audit(page, 'ai-handoff-dialog')
            page.screenshot(path=str(ARTIFACTS / 'lab-ai-handoff.png'), full_page=True)
            assert page.get_by_role('button', name='Send plan to Groq', exact=True).is_disabled()
            page.get_by_label('I reviewed this plan and authorize PRAXIS').check()
            page.get_by_role('button', name='Send plan to Groq', exact=True).click()
            page.wait_for_timeout(250)
            assert actions[-1]['body']['plan_id'] == 'a' * 24
    page.get_by_role('navigation', name='Review sections').get_by_role('button', name='changes', exact=True).click()
    page.get_by_role('button', name='Apply to source', exact=True).click()
    audit(page, 'apply-dialog')
    assert page.get_by_role('button', name='Apply changes', exact=True).is_disabled()
    page.get_by_label('I reviewed the patch').check()
    page.get_by_role('button', name='Apply changes', exact=True).click()
    page.wait_for_timeout(250)
    assert actions[-1]['body'] == {'confirm': True}
    page.locator('.project-actions').get_by_role('button', name='Run checks').click()
    audit(page, 'runtime-dialog')
    assert page.get_by_role('button', name='Run authorized checks').is_disabled()
    page.get_by_label('I trust this project and authorize').check()
    page.get_by_role('button', name='Run authorized checks').click()
    page.wait_for_timeout(250)
    assert actions[-1]['body']['runtime_mode'] == 'docker'
    assert not actions[-1]['body']['allow_network']
    fixture.update(status='paused', revision=2)
    page.reload(wait_until='networkidle')
    page.get_by_role('button', name='Add $5 and resume').click()
    page.wait_for_timeout(250)
    assert actions[-1]['body'] == {'amount': 5}
    fixture.update(status='scanning', revision=3)
    page.reload(wait_until='networkidle')
    page.get_by_role('button', name='Stop review').click()
    page.wait_for_timeout(250)
    assert actions[-1]['path'].endswith('/cancel')

    page.goto(BASE, wait_until='networkidle')
    page.route('**/api/scans', lambda route: route.fulfill(status=422, content_type='application/json', body=json.dumps({'detail': 'Synthetic invalid repository URL'})))
    page.get_by_role('button', name='GitHub URL').click()
    page.get_by_label('Repository URL', exact=False).fill('https://github.com/example/invalid')
    page.get_by_label('I trust this project and authorize').check()
    page.get_by_role('button', name='Run complete review').click()
    page.get_by_role('alert').filter(has_text='Synthetic invalid repository URL').first.wait_for()
    page.route('**/api/jobs', lambda route: route.fulfill(status=200, content_type='application/json', body='[]'))
    page.goto(BASE, wait_until='networkidle')
    page.get_by_role('heading', name='Your first review starts here').wait_for()
    page.route('**/api/health', lambda route: route.fulfill(status=503, content_type='application/json', body='{}'))
    page.reload(wait_until='networkidle')
    page.get_by_text('Local service offline', exact=True).wait_for()
    assert page.locator('.footer-state').get_attribute('data-state') == 'offline'
    assert page.get_by_role('button', name='Run complete review').is_disabled()
    # Appearance must remain usable with browser storage blocked. This is a
    # presentation failure case, not an API or model execution.
    isolated = browser.new_context()
    isolated.add_init_script("Storage.prototype.getItem = () => { throw new Error('Storage unavailable'); }; Storage.prototype.setItem = () => { throw new Error('Storage unavailable'); };")
    storage_page = isolated.new_page()
    storage_page.on('pageerror', lambda error: errors.append(str(error)))
    storage_page.goto(BASE, wait_until='networkidle')
    assert storage_page.locator('html').get_attribute('data-theme') == 'dark'
    storage_page.get_by_role('button', name='Use light theme').click()
    assert storage_page.locator('html').get_attribute('data-theme') == 'light'
    isolated.close()
    # New key entry: UI-only fixture, no real provider credential or model call.
    key_context = browser.new_context()
    key_page = key_context.new_page()
    key_health = {'status': 'ok', 'settings': {'provider': 'groq', 'model': 'fixture-model', 'input_price': .0000001, 'output_price': .0000002},
                  'providers': [{'name': 'groq', 'configured': False, 'verified': False, 'key_source': 'unconfigured'}], 'tools': {}, 'docker': {}}
    key_requests = []
    key_probes = []
    key_page.route('**/api/health', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps(key_health)))
    key_page.route('**/api/jobs', lambda route: route.fulfill(status=200, content_type='application/json', body='[]'))
    def save_key_fixture(route):
        key_requests.append(route.request.post_data_json)
        key_health['providers'][0].update(configured=True, key_source='local')
        route.fulfill(status=200, content_type='application/json', body=json.dumps(key_health))
    key_page.route('**/api/providers/key', save_key_fixture)
    key_page.route('**/api/providers/probe', lambda route: (key_probes.append(True), route.fulfill(status=500, content_type='application/json', body='{}')))
    key_page.on('pageerror', lambda error: errors.append(str(error)))
    key_page.goto(BASE, wait_until='networkidle')
    key_page.get_by_role('button', name='Models', exact=True).click()
    key_page.get_by_label('Provider API key', exact=True).fill('fixture-not-a-real-provider-key')
    key_page.get_by_role('button', name='Save key locally', exact=True).click()
    key_page.get_by_text('Key saved on this computer. Provider access has not been tested.', exact=True).wait_for()
    assert key_requests == [{'provider': 'groq', 'api_key': 'fixture-not-a-real-provider-key'}]
    assert not key_probes, 'Saving a key must not make a paid compatibility call'
    assert key_page.get_by_label('Provider API key', exact=True).input_value() == ''
    assert 'fixture-not-a-real-provider-key' not in key_page.evaluate('JSON.stringify({...localStorage})')
    audit(key_page, 'local-provider-key-dialog')
    key_context.close()
    assert not errors, errors
    browser.close()
    (ARTIFACTS / 'frontend-smoke.json').write_text(json.dumps({'views': reports, 'synthetic_actions': actions, 'javascript_errors': errors}, indent=2))
    print(json.dumps({'views_checked': len(reports), 'axe_violations': 0, 'javascript_errors': errors, 'synthetic_action_contracts': len(actions)}))
