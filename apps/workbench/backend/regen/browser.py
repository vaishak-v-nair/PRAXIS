"""Browser adapter for the existing scanner; project contents are never executed.

The website build copies this module, scanner.py, and reality.py byte-for-byte.
Pyodide stages only selected files in an ephemeral worker filesystem. No API,
provider, package installation, local command, or signing operation is called.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path

from .scanner import (EXCLUDED, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES,
                      _dotenv, _env_template, discover_commands, fingerprint,
                      redact, scan_project)


def select_files(metadata: list[dict], *, praxis_checkout: bool = False) -> dict:
    if not isinstance(metadata, list) or not metadata:
        raise ValueError('Choose a project folder or source files first.')
    folder = any('/' in str(item.get('path', '')) for item in metadata)
    name = str(metadata[0].get('path', '')).split('/')[0] if folder else 'Selected source files'
    accepted, seen, skipped, total = [], set(), {}, 0
    private = {'.gstack', '.obsidian'}
    for index, item in enumerate(metadata):
        raw = item.get('path')
        size = item.get('size')
        if not isinstance(raw, str) or not raw or '\\' in raw or ':' in raw or any(ord(char) < 32 for char in raw):
            raise ValueError('The selection contains an invalid file path.')
        parts = raw.split('/')
        if any(part in {'', '.', '..'} for part in parts) or folder and (parts[0] != name or len(parts) < 2):
            raise ValueError('Choose one project folder with valid relative paths.')
        parts = parts[1:] if folder else parts
        relative = '/'.join(parts)
        if relative in seen:
            raise ValueError('The selection contains duplicate file paths.')
        seen.add(relative)
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise ValueError('The selection contains an invalid file size.')
        file = Path(relative)
        reason = None
        if any(part.lower() in EXCLUDED | private or part.lower().startswith('.venv') or part.lower().endswith('intelligence') for part in parts[:-1]):
            reason = 'private, dependency, or generated directories'
        elif praxis_checkout and parts[0].lower() == 'assets':
            reason = 'private PRAXIS brand vault'
        elif _dotenv(file) and not _env_template(file):
            reason = 'credential files'
        elif size > MAX_FILE_BYTES:
            reason = 'files above 2 MiB'
        if reason:
            skipped[reason] = skipped.get(reason, 0) + 1
            continue
        total += size
        accepted.append({'index': index, 'path': relative})
    if not accepted:
        raise ValueError('No reviewable files remain after excluding credentials, dependencies, generated output, and large files.')
    if len(accepted) > MAX_FILES or total > MAX_TOTAL_BYTES:
        raise ValueError('Browser inspection supports 25,000 files and 100 MiB after exclusions. Use local PRAXIS for larger projects.')
    return {'name': redact(name, limit=160), 'accepted': accepted, 'bytes': total,
            'skipped': skipped, 'skipped_files': sum(skipped.values())}


def review_project(root: Path, selection: dict, goal: str = '') -> dict:
    root = Path(root)
    result = scan_project(root, lambda _: None, threading.Event(), external_checks=False)
    source = next(item for item in result['coverage'] if item['name'] == 'Local source inspection')
    if source['limits'].get('binary_or_non_utf8_files', 0) == result['files_scanned']:
        raise ValueError('No UTF-8 text files could be inspected. Choose readable source files; binary files cannot establish project correctness.')
    try:
        commands = [[redact(part, limit=None) for part in argv] for argv in discover_commands(root)['commands']]
    except (ValueError, TypeError, AttributeError, OSError, UnicodeError) as error:
        commands = []
        result['coverage'].append({'name': 'Command discovery', 'status': 'limited',
                                  'detail': 'Project manifests could not be interpreted: ' + redact(str(error), limit=500)})
    result['coverage'].extend([
        {'name': 'Tests, builds, and user journeys', 'status': 'skipped',
         'detail': 'Project commands were not executed. Test names and source matches do not demonstrate runtime behavior.'},
        {'name': 'Model analysis', 'status': 'skipped',
         'detail': 'No model was called. Source checks cannot establish intent, complete fixes, AI authorship, or production readiness.'},
    ])
    return {'schema': 'praxis.browser-source-review.v1', 'source_kind': 'browser',
            'name': selection['name'], 'goal': redact(goal, limit=2000),
            'snapshot': fingerprint(root), 'selection': {key: value for key, value in selection.items() if key != 'accepted'},
            'commands': commands, 'runtime_status': 'not_run', 'readiness': 'not_established', **result}
