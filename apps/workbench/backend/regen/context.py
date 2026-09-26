"""Retrieve related repository source through static local import relationships."""
from __future__ import annotations

import ast
import posixpath
import re
from pathlib import Path

from .scanner import safe_files

EXTENSIONS = {'.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.svelte'}


def related_source_paths(root, selected, max_nodes=250):
    """Bounded graph retrieval; never imports code or resolves outside the snapshot."""
    root = Path(root).resolve()
    files = {file.relative_to(root).as_posix(): file for file in safe_files(root)
             if file.suffix.lower() in EXTENSIONS}
    selected = [path for path in dict.fromkeys(selected) if path in files]
    ordered = selected + [path for path in sorted(files) if path not in selected]
    indexed = ordered[:max_nodes]
    modules = {}
    for path in indexed:
        if path.endswith('.py'):
            modules[path[:-3].replace('/', '.')] = path
            if path.endswith('/__init__.py'):
                modules[path[:-12].replace('/', '.')] = path
    links = {path: set() for path in indexed}
    for path in indexed:
        try:
            text = files[path].read_text('utf-8-sig')
            if path.endswith('.py'):
                tree = ast.parse(text, filename=path)
                for node in ast.walk(tree):
                    candidates = []
                    if isinstance(node, ast.Import):
                        candidates = [alias.name for alias in node.names]
                    elif isinstance(node, ast.ImportFrom):
                        base = node.module or ''
                        if node.level:
                            parents = path.split('/')[:-1]
                            if node.level > len(parents):
                                continue
                            prefix = '.'.join(parents[:len(parents) - node.level + 1])
                            base = '.'.join(part for part in (prefix, base) if part)
                        candidates = [base, *['.'.join(part for part in (base, alias.name) if part)
                                              for alias in node.names]]
                    links[path].update(modules[name] for name in candidates if name in modules)
            else:
                imports = re.findall(r'''(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*)["'](\.[^"']+)["']''', text)
                for module in imports:
                    base = posixpath.normpath(posixpath.join(posixpath.dirname(path), module))
                    candidates = [base, *[base + suffix for suffix in EXTENSIONS],
                                  *[base + '/index' + suffix for suffix in EXTENSIONS]]
                    links[path].update(candidate for candidate in candidates if candidate in files)
        except (OSError, UnicodeError, SyntaxError, RecursionError):
            continue
    dependencies = sorted(set().union(*(links.get(path, set()) for path in selected)) - set(selected))
    callers = sorted(path for path, targets in links.items() if targets & set(selected)
                     and path not in selected and path not in dependencies)
    return {'paths': [*selected, *dependencies, *callers], 'dependencies': dependencies,
            'callers': callers, 'indexed_files': len(indexed), 'eligible_files': len(files),
            'limited': len(indexed) < len(files), 'method': 'static-local-imports'}
