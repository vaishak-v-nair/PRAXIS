"""Capture actual public/local PRAXIS flows using purpose-built demo source only.

No mocked endpoints, source edits, model transcript substitution or auto-repair.
Fix planning uses the selected demo review's existing remaining model budget.
"""
import hashlib
import json
import shutil
import time
from pathlib import Path

import httpx
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / 'apps/workbench'
PROJECT = ROOT / 'videos/praxis-introduction'
ASSETS = PROJECT / 'capture/assets'
API = 'http://127.0.0.1:9123/api'
UI = 'http://127.0.0.1:3000'
SITE = 'https://praxis-six-xi.vercel.app'


def call(path):
    response = httpx.get(API + path, timeout=20)
    response.raise_for_status()
    return response.json()


def fingerprint(folder):
    return hashlib.sha256(b''.join(f.relative_to(folder).as_posix().encode() + f.read_bytes()
        for f in sorted(folder.rglob('*')) if f.is_file())).hexdigest()


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    recorded = json.loads((APP / '.regen/artifacts/team-smoke.json').read_text())
    bad_id, good_id = recorded['broken_job'], recorded['working_job']
    sources = [Path(path) for path in recorded['source_paths']]
    before = [fingerprint(folder) for folder in sources]
    inventory, errors = [], []

    def shot(page, filename, description, locator=None):
        page.evaluate('document.activeElement?.blur()')
        page.wait_for_timeout(250)
        target = page.locator(locator) if locator else page
        target.screenshot(path=str(ASSETS / filename))
        inventory.append((filename, description))
        print('Captured ' + filename, flush=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=['--no-proxy-server'])
        web = browser.new_context(viewport={'width': 1440, 'height': 1000},
                                  permissions=['clipboard-read', 'clipboard-write'])
        page = web.new_page()
        page.set_default_navigation_timeout(90000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        response = page.goto(SITE, wait_until='domcontentloaded')
        assert response.ok, 'Official website did not load'
        page.get_by_role('link', name='Test Your Project').first.wait_for()
        shot(page, 'website-hero.png', 'Actual official Vercel landing page and Test Your Project action.')
        page.get_by_role('link', name='Test Your Project').first.click()
        page.get_by_role('heading', name='Test your project', exact=True).wait_for()
        page.wait_for_function("() => typeof document.getElementById('folder').onchange === 'function'", timeout=90000)
        page.locator('#folder').set_input_files(str(sources[1]))
        shot(page, 'browser-intake.png', 'Real folder selected in the public browser trial; source stays in this browser.')
        page.locator('#run').click()
        page.locator('#results:not([hidden]), #error:not([hidden])').wait_for(timeout=150000)
        assert page.locator('#error').is_hidden(), page.locator('#error').inner_text()
        assert page.locator('.finding').count() > 0, 'False-success demo source was not identified'
        assert 'NOT EXECUTED' in page.locator('#prompt').input_value()
        page.locator('#results').scroll_into_view_if_needed()
        shot(page, 'browser-findings.png', 'Actual WebAssembly source findings. Runtime checks have not executed.')
        page.get_by_role('button', name='Copy agent prompt', exact=True).click()
        page.get_by_text('Agent prompt copied. Review and confirm the plan in your agent.', exact=True).wait_for()
        copied = page.evaluate('navigator.clipboard.readText()')
        assert copied.replace('\r\n', '\n') == page.locator('#prompt').input_value().replace('\r\n', '\n')
        shot(page, 'browser-handoff.png', 'Actual copied source-review prompt, with the execution limits retained.')

        local = browser.new_context(viewport={'width': 1440, 'height': 1000},
                                    permissions=['clipboard-read', 'clipboard-write'])
        page = local.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(UI, wait_until='load')
        page.locator('.intake-panel').wait_for()
        shot(page, 'local-intake.png', 'Actual local intake: folder, upload and GitHub source routes, trust and model-budget controls.', '.intake-layout')
        page.goto(UI + '/?job=' + bad_id, wait_until='load')
        page.get_by_role('heading', name='OrderService-false-success', exact=True).wait_for()
        page.locator('.project-actions').get_by_text('Complete', exact=False).wait_for()
        nav = page.get_by_role('navigation', name='Review sections')
        shot(page, 'local-overview.png', 'Actual blocked release assessment for the false-success order service.', '.final-verdict')
        nav.get_by_role('button', name='workspace', exact=True).click()
        page.get_by_role('heading', name='One project. A shared review.', exact=True).wait_for()
        shot(page, 'people-workspace.png', 'Two actual contributor sessions: a shared project question and a local-only decision.', '.shared-grid')
        shot(page, 'ai-team.png', 'Actual specialist results and partial provider availability; hypotheses remain separate from execution.', '.pressure-results')
        page.locator('.team-discussions > summary').click()
        shot(page, 'peer-evidence.png', 'Actual source-backed peer comments exchanged by the Groq and NVIDIA specialists.', '.team-discussions')
        nav.get_by_role('button', name='execution', exact=True).click()
        page.get_by_role('heading', name='Execution results', exact=True).wait_for()
        shot(page, 'failed-tests.png', 'Real Docker test failure: success response creates no SQLite row.', '.log-list')
        nav.get_by_role('button', name='findings', exact=False).click()
        page.get_by_role('heading', name='What PRAXIS found', exact=True).wait_for()
        # Choose the deterministic recorded false-success finding, not a model's invented proof.
        page.get_by_role('button', name='Write-named function returns constant success', exact=False).click()
        shot(page, 'source-finding.png', 'Human-readable impact, recorded source and response for the constant-success path.', '.triage')
        current = call('/jobs/' + bad_id)
        if not current.get('fix_plan'):
            page.get_by_role('button', name='Draft a fix plan', exact=True).click()
            page.locator('.repair-plan').wait_for(timeout=150000)
        else:
            nav.get_by_role('button', name='changes', exact=True).click()
            page.locator('.repair-plan').wait_for()
        shot(page, 'fix-plan.png', 'Real provider-drafted local-source repair plan: files, validation and risks; no source edits.', '.repair-plan')
        page.get_by_role('button', name='Copy AI handoff', exact=True).click()
        page.get_by_role('button', name='Plan copied', exact=True).wait_for()
        assert 'PRAXIS repair handoff' in page.evaluate('navigator.clipboard.readText()')
        shot(page, 'fix-handoff.png', 'Actual portable implementation brief copied to the clipboard for an existing coding agent.', '.handoff-options')
        nav.get_by_role('button', name='source map', exact=True).click()
        page.get_by_role('heading', name='Source explorer', exact=True).wait_for()
        shot(page, 'source-map.png', 'Actual parsed local import relationships; explicitly a static source map.', '.source-explorer')
        nav.get_by_role('button', name='activity', exact=True).click()
        shot(page, 'recorded-activity.png', 'Actual backend activity for inspection, peer challenge, Docker checks and planning.')

        page.goto(UI + '/?job=' + good_id, wait_until='load')
        page.get_by_role('heading', name='OrderService-working', exact=True).wait_for()
        page.get_by_role('navigation', name='Review sections').get_by_role('button', name='execution', exact=True).click()
        page.locator('.log-list details').last.locator('summary').click()
        shot(page, 'passed-tests.png', 'Real Docker unit tests pass for order persistence and invalid-input rejection.', '.log-list')
        browser.close()

    assert not errors, errors
    assert before == [fingerprint(folder) for folder in sources], 'Original demo source changed'
    final = call('/jobs/' + bad_id)
    assert final.get('fix_plan') and not final.get('fix'), 'Planning must remain separate from implementation'
    shutil.copyfile(APP / 'public/praxis-mark.png', ASSETS / 'praxis-mark.png')
    inventory.append(('praxis-mark.png', 'Existing curated public PRAXIS mark; no private brand masters.'))
    lines = ['# Verified capture inventory', '',
        'Actual Playwright captures from the official site and loopback app. Demo source is explicitly synthetic; commands and model results are real.',
        'Initial Hyperframes capture omitted two optional media downloads and its inventory. This list completes inventory for the actual retained screenshots; omitted files are not used.', '',
        '| File | Verified subject |', '| --- | --- |']
    lines += [f'| assets/{name} | {description} |' for name, description in inventory]
    (PROJECT / 'capture/extracted/asset-descriptions.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    proof = {'website_http': response.status, 'assets': [name for name, _ in inventory],
        'browser_prompt_copied': True, 'local_plan_copied': True, 'source_preserved': True,
        'model_cost_usd': final['cost'], 'plan_provider': final['fix_plan'].get('planner'), 'page_errors': errors}
    (APP / '.regen/artifacts/video-capture-proof.json').write_text(json.dumps(proof, indent=2), encoding='utf-8')
    print(json.dumps(proof), flush=True)


if __name__ == '__main__':
    main()
