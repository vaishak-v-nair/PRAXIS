"""Browser folder intake: bounded JSON, portable paths, isolated local storage."""
from __future__ import annotations

import base64
import binascii
import json
import re
import shutil
import uuid
from pathlib import Path
from urllib.parse import quote, unquote

from .scanner import EXCLUDED, MAX_FILES, MAX_FILE_BYTES, _dotenv, _env_template

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_UPLOAD_BODY = 32 * 1024 * 1024
PRIVATE = {'.praxis', '.gstack', '.obsidian'}
RESERVED = re.compile(r'^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)', re.I)


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
    if not isinstance(files, list) or not 1 <= len(files) <= MAX_FILES:
        raise ValueError(f'Choose a folder with 1–{MAX_FILES} files')
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
            raise ValueError('Folder upload exceeds the 20 MiB total or 2 MiB file limit')
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
