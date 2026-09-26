"""Paid provider integration check on a disposable two-file project ($1 cap)."""
import json
import time
from pathlib import Path
import httpx
root = Path(__file__).resolve().parents[1]
fixture = root / '.regen' / 'live-fixture'
fixture.mkdir(parents=True, exist_ok=True)
(fixture / 'client.py').write_text('import requests\n\ndef fetch(url):\n    return requests.get(url, verify=False, timeout=10).json()\n', encoding='utf-8')
(fixture / 'settings.py').write_text('DEBUG = True\n', encoding='utf-8')
(fixture / 'pyproject.toml').write_text('[project]\nname = "regen-fixture"\nversion = "0.0.1"\n', encoding='utf-8')
(fixture / 'tests').mkdir(exist_ok=True)
(fixture / 'tests' / 'test_security.py').write_text('''import os
import sys
import types
import unittest
seen = {}
def get(url, **kwargs):
    seen.update(kwargs)
    return types.SimpleNamespace(json=lambda: {"ok": True})
sys.modules["requests"] = types.SimpleNamespace(get=get)
import client
import settings
class SecurityChecks(unittest.TestCase):
    def test_tls_is_verified(self):
        client.fetch("https://example.com")
        self.assertIsNot(seen.get("verify", True), False)
    def test_debug_defaults_off(self):
        self.assertFalse(settings.DEBUG)
''', encoding='utf-8')
original = {name: (fixture / name).read_bytes() for name in ('client.py', 'settings.py')}
base = 'http://127.0.0.1:9123/api'
with httpx.Client(timeout=20) as client:
    response = client.post(base + '/scans', json={'source': str(fixture), 'budget': 1})
    response.raise_for_status()
    job = response.json()
    def wait():
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            current = client.get(base + '/jobs/' + job['id']).json()
            if current['status'] not in {'scanning', 'analyzing', 'fixing', 'verifying'}:
                return current
            time.sleep(1)
        raise RuntimeError('Integration job timed out.')
    job = wait()
    print(json.dumps({'scan_status': job['status'], 'issues': len(job['findings']), 'cost': job['cost'], 'error': job.get('error')}), flush=True)
    selected = [finding['id'] for finding in job['findings'] if finding['fixable'] and finding['title'] in {'TLS certificate verification is disabled', 'Debug mode is explicitly enabled'}]
    if job['status'] != 'complete' or len(selected) != 2:
        raise RuntimeError('Scan did not find both fixture defects.')
    response = client.post(base + '/jobs/' + job['id'] + '/fix', json={'finding_ids': selected})
    response.raise_for_status()
    job = wait()
    unchanged = all((fixture / name).read_bytes() == value for name, value in original.items())
    patch = client.get(base + '/jobs/' + job['id'] + '/export?format=patch')
    print(json.dumps({'job': job['id'], 'fix_status': job['status'], 'cost': job['cost'], 'changes': (job.get('fix') or {}).get('changes'), 'branch': (job.get('fix') or {}).get('branch'), 'agents': (job.get('fix') or {}).get('agents'), 'source_unchanged': unchanged, 'patch_status': patch.status_code, 'error': job.get('error')}), flush=True)
    if job['status'] != 'complete' or not unchanged or patch.status_code != 200 or len(job['fix']['changes']) < 2:
        raise RuntimeError('Live fixes failed verification.')
    response = client.post(base + '/jobs/' + job['id'] + '/verify', json={'trust_confirmed': True})
    response.raise_for_status()
    job = wait()
    print(json.dumps({'verification': job['checks'], 'cost': job['cost']}), flush=True)
    if not job['checks'] or any(check['status'] != 'passed' for check in job['checks']):
        raise RuntimeError('Runtime checks did not pass.')
