"""Check exact Python dependency versions; send names/versions only to OSV."""
import json
import re
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
reports = []
with httpx.Client(timeout=30) as client:
    for relative in ('backend/requirements.txt', 'repos/Zentara/requirements-resolved.txt'):
        packages = []
        for line in (ROOT / relative).read_text('utf-8-sig').splitlines():
            match = re.fullmatch(r'([A-Za-z0-9_.-]+)==([A-Za-z0-9.+_-]+)', line)
            if match:
                packages.append((match[1], match[2]))
        advisories = []
        for start in range(0, len(packages), 100):
            batch = packages[start:start + 100]
            response = client.post('https://api.osv.dev/v1/querybatch', json={'queries': [
                {'package': {'name': name, 'ecosystem': 'PyPI'}, 'version': version}
                for name, version in batch]})
            response.raise_for_status()
            for (name, version), result in zip(batch, response.json()['results'], strict=True):
                identifiers = [item['id'] for item in result.get('vulns', [])]
                if identifiers:
                    advisories.append({'package': name, 'version': version, 'advisories': identifiers})
        reports.append({'manifest': relative, 'checked_versions': len(packages), 'advisories': advisories})
report = {'source': 'https://api.osv.dev/v1/querybatch', 'reports': reports}
(ROOT / '.regen' / 'artifacts' / 'python-advisories.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report), flush=True)
if any(item['advisories'] for item in reports):
    raise SystemExit(1)
