"""Browser folder intake: bounded JSON, portable paths, isolated local storage."""
from __future__ import annotations

import base64
import binascii
import json
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import quote, unquote

from .scanner import EXCLUDED, MAX_FILE_BYTES, _dotenv, _env_template

MAX_UPLOAD_FILES = 25_000
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_UPLOAD_BODY = 32 * 1024 * 1024
MAX_UPLOAD_BATCH_FILES = 500
UPLOAD_SESSION_MAX_AGE = 24 * 60 * 60
PRIVATE = {'.praxis', '.gstack', '.obsidian'}
RESERVED = re.compile(r'^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)', re.I)
UPLOAD_LOCK = threading.RLock()


def parts_for(path):
    if not isinstance(path, str) or len(path) > 1000:
        raise ValueError('Invalid upload path')
    parts = path.split('/')
    if len(parts) < 2 or any(not part or part in {'.', '..'} or part.endswith((' ', '.'))
            or re.search(r'[\\:"<>|?*\x00-\x1f\x7f]', part) or RESERVED.match(part)
            for part in parts):
        raise ValueError('Upload paths must stay inside one folder and use portable filenames')
    return parts


def save_upload(body, data: Path):
    files = body.get('files') if isinstance(body, dict) else None
    if not isinstance(files, list) or not 1 <= len(files) <= MAX_UPLOAD_FILES:
        raise ValueError(f'Choose a folder with 1–{MAX_UPLOAD_FILES:,} reviewable files')
    selected, paths, directories = [], set(), set()
    name, total, skipped = None, 0, 0
    for item in files:
        if not isinstance(item, dict):
            raise ValueError('Invalid upload file')
        parts = parts_for(item.get('path'))
        if name is None:
            name = parts[0]
        if parts[0] != name:
            raise ValueError('Upload one project folder at a time')
        key = '/'.join(parts[1:]).casefold()
        parents = {'/'.join(parts[1:i]).casefold() for i in range(2, len(parts))}
        if key in paths or key in directories or parents & paths:
            raise ValueError('Duplicate or conflicting upload paths')
        paths.add(key)
        directories.update(parents)
        encoded = item.get('content')
        if not isinstance(encoded, str) or len(encoded) > 4 * ((MAX_FILE_BYTES + 2) // 3):
            raise ValueError('Each uploaded file must be at most 2 MiB')
        try:
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise ValueError('Invalid file encoding') from None
        total += len(content)
        if len(content) > MAX_FILE_BYTES or total > MAX_UPLOAD_BYTES:
            raise ValueError('Folder upload exceeds the 100 MiB total or 2 MiB file limit')
        relative = Path(*parts[1:])
        normalized = Path(relative.name.lower())
        if any(part.lower() in EXCLUDED or part.lower() in PRIVATE or part.lower().startswith('.venv') or part.lower().endswith('intelligence') for part in parts[1:]) or (_dotenv(normalized) and not _env_template(normalized)):
            skipped += 1
            continue
        selected.append((relative, content))
    if not selected:
        raise ValueError('No project files remain after excluding credentials and generated files')
    token = uuid.uuid4().hex
    parent = Path(data).resolve() / 'uploads' / token
    project = parent / 'project'
    project.mkdir(parents=True)
    try:
        for relative, content in selected:
            target = project / relative
            if not target.resolve().is_relative_to(project.resolve()):
                raise ValueError('Unsafe upload destination')
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as stream:
                stream.write(content)
        (parent / 'metadata.json').write_text(json.dumps({'name': name}), encoding='utf-8')
    except Exception:
        shutil.rmtree(parent)
        raise
    return {'source': f'upload://{token}/{quote(name, safe="")}', 'name': name,
            'accepted_files': len(selected), 'skipped_files': skipped,
            'accepted_bytes': sum(len(content) for _, content in selected)}


def _session(data: Path, token: str):
    if not re.fullmatch(r'[a-f0-9]{32}', token or ''):
        raise ValueError('Invalid upload session')
    root = Path(data).resolve() / 'upload-staging' / token
    state_path = root / 'state.json'
    try:
        state = json.loads(state_path.read_text(encoding='utf-8'))
    except (OSError, ValueError, TypeError):
        raise ValueError('Upload session is unavailable; choose the folder again') from None
    if root.is_symlink() or not root.resolve().is_relative_to(Path(data).resolve()):
        raise ValueError('Invalid upload session')
    return root, state_path, state


def _write_state(path: Path, state):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(state, separators=(',', ':')), encoding='utf-8')
    temporary.replace(path)


def _create_upload_session(body, data: Path):
    if not isinstance(body, dict):
        raise ValueError('Invalid upload session')
    name = body.get('name')
    total_files, total_bytes = body.get('total_files'), body.get('total_bytes')
    skipped = body.get('skipped_files', 0)
    if not isinstance(name, str) or parts_for(name + '/placeholder')[0] != name:
        raise ValueError('Use one portable project folder name')
    if not isinstance(total_files, int) or isinstance(total_files, bool) or not 1 <= total_files <= MAX_UPLOAD_FILES:
        raise ValueError(f'Choose a folder with 1–{MAX_UPLOAD_FILES:,} reviewable files')
    if not isinstance(total_bytes, int) or isinstance(total_bytes, bool) or not 0 <= total_bytes <= MAX_UPLOAD_BYTES:
        raise ValueError('Reviewable project files must total 100 MiB or less; use a local path for larger projects')
    if not isinstance(skipped, int) or isinstance(skipped, bool) or skipped < 0:
        raise ValueError('Invalid excluded-file count')
    token = uuid.uuid4().hex
    root = Path(data).resolve() / 'upload-staging' / token
    (root / 'project').mkdir(parents=True)
    state = {'name': name, 'expected_files': total_files, 'expected_bytes': total_bytes,
             'received_files': 0, 'received_bytes': 0, 'accepted_files': 0,
             'accepted_bytes': 0, 'skipped_files': skipped, 'paths': [],
             'directories': [], 'created_at': int(time.time())}
    _write_state(root / 'state.json', state)
    return {'upload_id': token, 'name': name, 'total_files': total_files, 'total_bytes': total_bytes}


def _append_upload_batch(token: str, body, data: Path):
    root, state_path, state = _session(data, token)
    files = body.get('files') if isinstance(body, dict) else None
    if not isinstance(files, list) or not 1 <= len(files) <= MAX_UPLOAD_BATCH_FILES:
        raise ValueError(f'Upload each batch with 1–{MAX_UPLOAD_BATCH_FILES} files')
    paths, directories = set(state['paths']), set(state['directories'])
    pending, received_bytes, skipped = [], 0, 0
    for item in files:
        if not isinstance(item, dict):
            raise ValueError('Invalid upload file')
        parts = parts_for(item.get('path'))
        if parts[0] != state['name']:
            raise ValueError('Upload one project folder at a time')
        key = '/'.join(parts[1:]).casefold()
        parents = {'/'.join(parts[1:i]).casefold() for i in range(2, len(parts))}
        if key in paths or key in directories or parents & paths:
            raise ValueError('Duplicate or conflicting upload paths')
        paths.add(key); directories.update(parents)
        encoded = item.get('content')
        if not isinstance(encoded, str) or len(encoded) > 4 * ((MAX_FILE_BYTES + 2) // 3):
            raise ValueError('Each uploaded source file must be at most 2 MiB')
        try:
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise ValueError('Invalid file encoding') from None
        if len(content) > MAX_FILE_BYTES:
            raise ValueError('Each uploaded source file must be at most 2 MiB')
        received_bytes += len(content)
        relative = Path(*parts[1:])
        normalized = Path(relative.name.lower())
        excluded = any(part.lower() in EXCLUDED or part.lower() in PRIVATE or part.lower().startswith('.venv') or part.lower().endswith('intelligence') for part in parts[1:]) or (_dotenv(normalized) and not _env_template(normalized))
        if excluded:
            skipped += 1
        else:
            pending.append((relative, content))
    received_files = state['received_files'] + len(files)
    total_bytes = state['received_bytes'] + received_bytes
    if received_files > state['expected_files'] or total_bytes > state['expected_bytes'] or total_bytes > MAX_UPLOAD_BYTES:
        raise ValueError('Upload batch exceeds the declared project size')
    project, written = root / 'project', []
    try:
        for relative, content in pending:
            target = project / relative
            if not target.resolve().is_relative_to(project.resolve()):
                raise ValueError('Unsafe upload destination')
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as stream:
                stream.write(content)
            written.append(target)
        state.update(received_files=received_files, received_bytes=total_bytes,
                     accepted_files=state['accepted_files'] + len(pending),
                     accepted_bytes=state['accepted_bytes'] + sum(len(content) for _, content in pending),
                     skipped_files=state['skipped_files'] + skipped,
                     paths=sorted(paths), directories=sorted(directories))
        _write_state(state_path, state)
    except Exception:
        for target in written:
            target.unlink(missing_ok=True)
        raise
    return {'upload_id': token, 'received_files': state['received_files'],
            'total_files': state['expected_files'], 'accepted_bytes': state['accepted_bytes']}


def _finish_upload_session(token: str, data: Path):
    root, _, state = _session(data, token)
    if state['received_files'] != state['expected_files'] or state['received_bytes'] != state['expected_bytes']:
        raise ValueError('Upload is incomplete; retry the folder upload')
    if not state['accepted_files']:
        raise ValueError('No project files remain after excluding credentials and generated files')
    parent = Path(data).resolve() / 'uploads' / token
    parent.parent.mkdir(parents=True, exist_ok=True)
    if parent.exists():
        raise ValueError('Upload destination already exists')
    root.replace(parent)
    state_path = parent / 'state.json'
    state_path.unlink(missing_ok=True)
    (parent / 'metadata.json').write_text(json.dumps({'name': state['name']}), encoding='utf-8')
    return {'source': f'upload://{token}/{quote(state["name"], safe="")}', 'name': state['name'],
            'accepted_files': state['accepted_files'], 'skipped_files': state['skipped_files'],
            'accepted_bytes': state['accepted_bytes']}


def _cancel_upload_session(token: str, data: Path):
    root, _, _ = _session(data, token)
    shutil.rmtree(root)
    return {'cancelled': True}


def create_upload_session(body, data: Path):
    with UPLOAD_LOCK:
        return _create_upload_session(body, data)


def append_upload_batch(token: str, body, data: Path):
    with UPLOAD_LOCK:
        return _append_upload_batch(token, body, data)


def finish_upload_session(token: str, data: Path):
    with UPLOAD_LOCK:
        return _finish_upload_session(token, data)


def cancel_upload_session(token: str, data: Path):
    with UPLOAD_LOCK:
        return _cancel_upload_session(token, data)


def prune_upload_sessions(data: Path, max_age: int = UPLOAD_SESSION_MAX_AGE):
    """Remove abandoned resumable sessions without touching completed uploads."""
    staging = Path(data).resolve() / 'upload-staging'
    if not staging.is_dir():
        return 0
    cutoff, removed = time.time() - max_age, 0
    with UPLOAD_LOCK:
        for root in staging.iterdir():
            if (not root.is_dir() or root.is_symlink()
                    or not re.fullmatch(r'[a-f0-9]{32}', root.name)
                    or not root.resolve().is_relative_to(staging)):
                continue
            state_path = root / 'state.json'
            try:
                state = json.loads(state_path.read_text(encoding='utf-8'))
                created_at = float(state.get('created_at', state_path.stat().st_mtime))
            except (OSError, ValueError, TypeError):
                created_at = root.stat().st_mtime
            if created_at < cutoff:
                shutil.rmtree(root)
                removed += 1
    return removed


def uploaded_project(source: str, data: Path):
    match = re.fullmatch(r'upload://([a-f0-9]{32})/([^/]+)', source)
    if not match:
        raise ValueError('Choose and upload a folder before scanning')
    parent = Path(data).resolve() / 'uploads' / match[1]
    project = parent / 'project'
    try:
        metadata = json.loads((parent / 'metadata.json').read_text(encoding='utf-8'))
        if metadata['name'] != unquote(match[2]) or not project.is_dir() or parent.is_symlink() or project.is_symlink() or not project.resolve().is_relative_to(Path(data).resolve()):
            raise ValueError('Invalid uploaded project')
    except (OSError, ValueError, KeyError):
        raise ValueError('Uploaded folder is unavailable; upload it again') from None
    return project, metadata['name']
