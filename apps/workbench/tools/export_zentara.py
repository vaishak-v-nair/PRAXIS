"""Build reviewable repaired-project artifacts, excluding ignored local state."""
import difflib
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / 'repos' / 'Zentara'
ARTIFACTS = ROOT / '.regen' / 'artifacts'
job = json.loads((ARTIFACTS / 'zentara-pressure.json').read_text('utf-8'))['job']
BASE = ROOT / '.regen' / job['id'] / 'project'
files = subprocess.run(['rg', '--files', '--hidden', '--no-require-git'], cwd=PROJECT, check=True,
    capture_output=True, text=True).stdout.splitlines()
after = {relative.replace('\\', '/'): PROJECT / relative for relative in files}
before = {file.relative_to(BASE).as_posix(): file for file in BASE.rglob('*') if file.is_file()}
diff = []
for name in sorted(before.keys() | after.keys()):
    old, new = before.get(name), after.get(name)
    try:
        old_text = old.read_text('utf-8-sig') if old else ''
        new_text = new.read_text('utf-8-sig') if new else ''
    except UnicodeError:
        if old and new and old.read_bytes() != new.read_bytes():
            raise RuntimeError(f'Unexpected changed binary asset: {name}') from None
        continue
    if old_text != new_text or (old is None) != (new is None):
        diff.extend(difflib.unified_diff(old_text.splitlines(True), new_text.splitlines(True),
            fromfile='a/' + name if old else '/dev/null', tofile='b/' + name if new else '/dev/null'))
patch = ARTIFACTS / 'Zentara-fixes.patch'
patch.write_text(''.join(diff), encoding='utf-8', newline='')
archive_path = ARTIFACTS / 'Zentara-fixed.zip'
with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, file in sorted(after.items()):
        archive.writestr('Zentara/' + name, file.read_bytes())
pdfs = {file.name: hashlib.sha256(file.read_bytes()).hexdigest() for file in (PROJECT / 'data').glob('*.pdf')}
for name, digest in pdfs.items():
    if digest != hashlib.sha256((BASE / 'data' / name).read_bytes()).hexdigest():
        raise RuntimeError(f'Original PDF changed: {name}')
print(json.dumps({'exported_files': len(after), 'preserved_pdfs': len(pdfs), 'zip': str(archive_path), 'patch': str(patch)}))
