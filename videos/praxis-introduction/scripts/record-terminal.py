"""Render a readable excerpt of actual setup stdout, with machine paths reduced."""
import html
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
PROJECT = Path(__file__).resolve().parents[1]
logs = ROOT / 'apps/workbench/.regen/artifacts'
readiness = json.loads((logs / 'video-local-readiness.json').read_text(encoding='utf-8-sig'))
assert readiness['ok'] and not readiness['missing']
raw = (logs / 'video-local-cached-setup.log').read_text(encoding='utf-8-sig')
assert 'Production setup prepared.' in raw
lines = [line for line in raw.splitlines() if line.startswith(('[1/4]', '[2/4]', '[3/4]', '[4/4]', 'Production setup prepared.'))]
assert len(lines) == 5
text = '\n\n'.join(lines)
document = '''<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:48px;background:#171c25;color:#e2e8f0;font-family:Arial,sans-serif}
header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #384254;padding-bottom:24px;margin-bottom:36px}
h1{font-size:30px;margin:0}span{font-size:18px;color:#bbc7d6}
pre{font:24px/1.75 Consolas,monospace;white-space:pre-wrap;margin:24px 0;color:#e2e8f0}
.command{padding:24px;background:#232b36;border:1px solid #384254;font-size:22px;border-radius:8px}
footer{font-size:20px;color:#c2ccdb;border-top:1px solid #384254;padding-top:24px;margin-top:36px}
</style></head><body><header><h1>PRAXIS · Recorded local setup</h1><span>Source checkout / release candidate</span></header>
<pre class="command">node src/cli.js review --setup-only --home &lt;local app data&gt;</pre>
<pre>''' + html.escape(text) + '''</pre><footer>Readiness check: ok = true · No model requests or submitted-project execution during setup.<br>Verified runtime cache reused. Public npm release pending. Machine path reduced for readability.</footer></body></html>'''
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    page.set_content(document)
    page.screenshot(path=str(PROJECT / 'capture/assets/setup-transcript.png'))
    browser.close()
inventory = PROJECT / 'capture/extracted/asset-descriptions.md'
inventory.write_text(inventory.read_text(encoding='utf-8') + '\n| assets/setup-transcript.png | Readable transcript excerpt of actual successful managed setup and readiness; cache reuse and pending npm release explicitly labelled. |\n', encoding='utf-8')
print('Captured actual local setup transcript; readiness confirmed.')
