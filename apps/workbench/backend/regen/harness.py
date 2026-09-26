"""Capability-limited file tools with redacted, verifiable execution evidence.

This is a file-tool boundary, not an operating-system sandbox. Project execution
is separately authorized by the API and never granted to repair models.
"""
from __future__ import annotations

import hashlib
import json
import threading
from datetime import datetime, timezone
from pathlib import Path

from .scanner import MAX_FILE_BYTES, redact

TOOLS = frozenset({'read_file', 'edit_file', 'create_file'})


def _digest(file):
    if file.is_file() and file.stat().st_size > MAX_FILE_BYTES:
        raise ValueError('Tool destination exceeds the repository file-size limit.')
    return hashlib.sha256(file.read_bytes()).hexdigest() if file.is_file() else None


def _seal(record):
    return hashlib.sha256(json.dumps(record, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class ExecutionHarness:
    """Only trusted registered handlers can run, inside one specialist's copy."""

    def __init__(self, root, agent, handlers, path_validator, cancelled, max_steps=64):
        self.root = Path(root).resolve()
        if not set(handlers) <= TOOLS or not handlers:
            raise ValueError('Repair agents can only receive read, edit, and create file tools.')
        self.agent = redact(str(agent))[:120]
        self.handlers = dict(handlers)
        self.path_validator = path_validator
        self.cancelled = cancelled
        self.max_steps = max_steps
        if type(max_steps) is not int or not 1 <= max_steps <= 128:
            raise ValueError('File-tool limits must be between 1 and 128 steps.')
        self._records = []
        self._lock = threading.RLock()

    @property
    def evidence(self):
        with self._lock:
            return json.loads(json.dumps(self._records))

    def execute(self, tool, arguments):
        with self._lock:
            if self.cancelled.is_set():
                raise RuntimeError('Repair cancelled before tool execution.')
            if len(self._records) >= self.max_steps:
                raise RuntimeError('Repair file-tool limit reached.')
            record = {'agent': self.agent, 'tool': tool if tool in TOOLS else 'denied_tool',
                      'time': datetime.now(timezone.utc).isoformat(), 'path': None,
                      'before': None, 'after': None, 'status': 'denied',
                      'previous': self._records[-1]['id'] if self._records else None}
            file = None
            try:
                if tool not in self.handlers or not isinstance(arguments, dict):
                    raise PermissionError('This tool is not granted to the repair agent.')
                file = Path(self.path_validator(arguments.get('path')))
                if not file.resolve().is_relative_to(self.root) or file.is_symlink():
                    raise PermissionError('Tool destination must remain inside the specialist copy.')
                record['path'] = redact(file.relative_to(self.root).as_posix())
                record['before'] = _digest(file)
                record['status'] = 'failed'
                result = self.handlers[tool](arguments)
                record['after'] = _digest(file)
                record['status'] = 'completed'
                return result
            except Exception as error:
                record['error_category'] = type(error).__name__
                if file is not None and record['path'] is not None:
                    try:
                        record['after'] = _digest(file)
                    except (OSError, ValueError):
                        record['hash_status'] = 'unavailable'
                raise
            finally:
                # Never retain tool arguments, source text, returned content, or error bodies.
                record['id'] = _seal(record)
                self._records.append(record)


def verify_evidence(records):
    """Detect changed rows or broken ordering; this does not authenticate the server."""
    previous = None
    for record in records:
        row = {key: value for key, value in record.items() if key != 'id'}
        if row.get('previous') != previous or record.get('id') != _seal(row):
            return False
        previous = record['id']
    return True
