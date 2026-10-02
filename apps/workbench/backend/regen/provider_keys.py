"""Explicit, server-only provider credentials. Never returned in API records."""
from __future__ import annotations

import json
import os
import re
import secrets
from pathlib import Path

PROVIDER_KEYS = {'openrouter': 'OPENROUTER_API_KEY', 'gemini': 'GEMINI_API_KEY',
                 'nvidia': 'NVIDIA_NIM_KEY', 'groq': 'GROQ_API_KEY'}


def stored_keys(data: Path) -> dict[str, str]:
    file = data / 'provider-keys.json'
    if not file.exists():
        return {}
    try:
        if file.is_symlink() or file.stat().st_size > 20000:
            raise ValueError
        value = json.loads(file.read_text('utf-8'))
        if not isinstance(value, dict) or any(name not in PROVIDER_KEYS or not isinstance(key, str) or not re.fullmatch(r'[!-~]{8,4096}', key) for name, key in value.items()):
            raise ValueError
        return value
    except (OSError, ValueError):
        raise ValueError('Local provider credentials could not be read. Inspect the private credential file.') from None


def provider_key(provider: str, data: Path) -> str | None:
    # Keep existing .env / process configuration authoritative.
    return os.getenv(PROVIDER_KEYS.get(provider, '')) or stored_keys(data).get(provider)


def save_key(provider: str, value: str, data: Path) -> None:
    if provider not in PROVIDER_KEYS or not isinstance(value, str) or not re.fullmatch(r'[!-~]{8,4096}', value):
        raise ValueError('Choose a supported provider and a key of 8–4096 characters without spaces or line breaks.')
    if os.getenv(PROVIDER_KEYS[provider]):
        raise ValueError('This provider uses an environment key. Update that environment file; it was not overwritten.')
    keys = stored_keys(data)
    keys[provider] = value
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = data / 'provider-keys.json'
    temporary = data / ('provider-keys.' + secrets.token_hex(8) + '.tmp')
    try:
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w', encoding='utf-8') as stream:
            json.dump(keys, stream)
        temporary.replace(target)
        if os.name != 'nt':
            target.chmod(0o600)
    except OSError:
        raise ValueError('The provider key could not be saved. Existing configuration remains in place.') from None
    finally:
        if temporary.exists():
            temporary.unlink()
