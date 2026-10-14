"""Bounded official MCP observations, additive to existing local evidence."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .scanner import redact


class EvidenceInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source: Literal['github', 'playwright', 'sentry', 'supabase']
    operation: Literal['pull-request', 'snapshot', 'issue', 'schema']
    authorized: bool = False
    repository: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$')
    pull_number: int | None = Field(default=None, gt=0, le=2_147_483_647)
    organization: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_-]{1,100}$')
    issue_id: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_-]{1,100}$')
    project_ref: str | None = Field(default=None, pattern=r'^[a-z0-9]{6,64}$')


def _bridge(payload):
    node = os.getenv('PRAXIS_NODE_EXECUTABLE') or shutil.which('node')
    bridge = Path(__file__).resolve().parents[2] / 'tools' / 'mcp-evidence.mjs'
    if not node or not bridge.is_file():
        return {'status': 'unavailable', 'detail': 'The official evidence bridge is not installed. Local checks are preserved.'}
    # Only reviewed source tokens go to the bridge, never submitted-project env.
    names = ('SYSTEMROOT', 'PATH', 'HOME', 'USERPROFILE', 'PRAXIS_GITHUB_MCP_TOKEN',
             'GITHUB_TOKEN', 'SENTRY_ACCESS_TOKEN', 'SUPABASE_ACCESS_TOKEN')
    environment = {key: os.environ[key] for key in names if key in os.environ}
    try:
        result = subprocess.run([node, str(bridge)], input=json.dumps(payload),
                                capture_output=True, text=True, encoding='utf-8',
                                timeout=35, env=environment, cwd=bridge.parent)
        if len(result.stdout.encode('utf-8')) > 64 * 1024:
            raise ValueError('Oversized evidence result')
        data = json.loads(result.stdout)
        if result.returncode:
            return {'status': 'unavailable', 'detail': 'The official evidence request did not succeed. Check authorization, scope and session; local checks are preserved.'}
        return data
    except (OSError, subprocess.SubprocessError, ValueError):
        return {'status': 'unavailable', 'detail': 'The official evidence source timed out or was unavailable. No result was inferred.'}


def availability():
    return _bridge({'mode': 'status'})


def collect(body: EvidenceInput, *, snapshot_ref: str):
    payload = body.model_dump(exclude_none=True, exclude={'authorized'})
    result = _bridge(payload)
    # Remote text is untrusted display data; it never enters a model prompt or
    # changes the local verifier verdict. Persist no credentials or raw responses.
    if not isinstance(result, dict):
        return {'status': 'unavailable', 'detail': 'The MCP bridge returned invalid evidence.'}
    encoded = json.dumps(result, ensure_ascii=False)
    def safe(value):
        if isinstance(value, str):
            return redact(value, limit=None)
        if isinstance(value, dict):
            return {redact(str(key), limit=None): safe(item) for key, item in value.items()}
        if isinstance(value, list):
            return [safe(item) for item in value]
        return value
    # Redact values before serialization. Editing serialized JSON can corrupt
    # quoting in an untrusted excerpt and turn a failed source into an API error.
    sanitized = safe(result)
    sanitized['snapshot_ref'] = snapshot_ref
    sanitized['source'] = body.source
    sanitized['operation'] = body.operation
    sanitized.setdefault('observed_at', datetime.now(timezone.utc).isoformat())
    sanitized['id'] = hashlib.sha256((snapshot_ref + encoded).encode()).hexdigest()[:24]
    return sanitized
