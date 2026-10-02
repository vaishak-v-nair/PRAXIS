"""Explicit launcher paths; source checkouts retain their existing local state.

These variables belong to the trusted PRAXIS process, never a submitted project.
No files are copied, migrated or created when resolving them.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Mapping


def runtime_paths(root: Path, environ: Mapping[str, str] | None = None) -> tuple[Path, Path]:
    env = os.environ if environ is None else environ

    def configured(name: str, default: Path) -> Path:
        value = env.get(name)
        if not value:
            return default
        target = Path(value).expanduser()
        if not target.is_absolute():
            raise ValueError(f'{name} must be an absolute path')
        return target.resolve()

    return (configured('PRAXIS_WORKBENCH_DATA_DIR', root / '.regen'),
            configured('PRAXIS_WORKBENCH_ENV_FILE', root / '.env'))
