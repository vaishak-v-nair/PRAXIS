"""Live local UI check; keys stay in a short-lived server process, never on disk."""
import json
import os
import subprocess
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / 'repos' / 'Zentara'
ENVIRONMENT = PROJECT / ('.venv-secure' if (PROJECT / '.venv-secure').is_dir() else '.venv')
ARTIFACTS = ROOT / '.regen' / 'artifacts'
env = {name: value for name, value in os.environ.items() if name.upper() in {
    'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC'}}
keys = dotenv_values(ROOT / '.env')
env.update({name: keys[name] for name in ('GROQ_API_KEY', 'GEMINI_API_KEY') if keys.get(name)})
env.update({'CHAT_PROVIDER': 'groq', 'EMBEDDING_PROVIDER': 'gemini', 'ENABLE_NIM_FALLBACK': 'false',
            'REQUEST_TIMEOUT': '45', 'MAX_ATTEMPTS': '1', 'MAX_OUTPUT_TOKENS': '4096'})
ARTIFACTS.mkdir(parents=True, exist_ok=True)
report = {'passed': False}
with (ARTIFACTS / 'zentara-server.log').open('w', encoding='utf-8') as log:
    process = subprocess.Popen([str(ENVIRONMENT / 'Scripts' / 'python.exe'), '-m', 'streamlit',
        'run', 'app.py', '--server.port', '4175', '--server.address', '127.0.0.1'],
        cwd=PROJECT, env=env, stdout=log, stderr=log)
    try:
        with httpx.Client(timeout=2) as client:
            for _ in range(60):
                try:
                    if client.get('http://127.0.0.1:4175/_stcore/health').status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                if process.poll() is not None:
                    raise RuntimeError('Streamlit exited during startup.')
                time.sleep(.5)
            else:
                raise RuntimeError('Streamlit startup timed out.')
        with sync_playwright() as runtime:
            browser = runtime.chromium.launch(headless=True)
            page = browser.new_page(viewport={'width': 1440, 'height': 1000})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto('http://127.0.0.1:4175', wait_until='domcontentloaded')
            page.get_by_role('heading', name='Zentara document assistant', exact=True).wait_for(timeout=30000)
            field = page.get_by_placeholder('Ask about your local PDFs…')
            field.fill('What is the rated payload capacity of the ZR-400 Talos?')
            field.press('Enter')
            page.locator('[data-testid="stChatMessage"]').nth(1).wait_for(timeout=120000)
            response = page.locator('[data-testid="stChatMessage"]').nth(1).inner_text()
            grounded = '400' in response and '[S' in response
            source_control = page.get_by_text('Sources cited in this answer', exact=True)
            source_visible = source_control.count() == 1
            if source_visible:
                source_control.click()
            page.screenshot(path=str(ARTIFACTS / 'zentara-app-desktop.png'), full_page=True)
            measurements = []
            for width in (320, 390, 768, 1440):
                page.set_viewport_size({'width': width, 'height': 900})
                page.wait_for_timeout(200)
                measurements.append({'width': width, 'overflow': page.evaluate('document.documentElement.scrollWidth > innerWidth + 2')})
            page.set_viewport_size({'width': 390, 'height': 844})
            page.screenshot(path=str(ARTIFACTS / 'zentara-app-mobile.png'), full_page=True)
            page.set_viewport_size({'width': 1440, 'height': 1000})
            page.get_by_role('button', name='Clear conversation', exact=True).click()
            page.locator('[data-testid="stChatMessage"]').first.wait_for(state='detached', timeout=15000)
            report = {'passed': grounded and source_visible and not errors and not any(item['overflow'] for item in measurements),
                      'grounded_answer': grounded, 'source_control': source_visible,
                      'clear_conversation': True, 'browser_errors': errors, 'viewports': measurements}
            browser.close()
    except Exception as error:
        report['error_category'] = type(error).__name__
    finally:
        process.terminate()
        process.wait(timeout=15)
(ARTIFACTS / 'zentara-browser.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report), flush=True)
if not report['passed']:
    raise SystemExit(1)
