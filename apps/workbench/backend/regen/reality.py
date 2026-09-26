"""Bounded Python AST checks, inspired by the read-only legacy ReGen scanner.

Repository trees are data. No imports, evaluation, provenance claims, or execution
are performed. A matched API or response shape is evidence, not proof of abuse.
"""
from __future__ import annotations

import ast
import re
from pathlib import PurePosixPath
from typing import Callable

MAX_NODES = 30000
MAX_FINDINGS = 60
MOCK_MODULES = {'unittest.mock', 'mock', 'pytest_mock', 'fakeredis', 'moto', 'responses'}
TEST_PARTS = {'test', 'tests', '__tests__', 'fixtures', '__fixtures__', 'mocks', '__mocks__'}


def is_fixture(relative: str) -> bool:
    """Explicit test/fixture names only; api, core and runtime are production."""
    path = PurePosixPath(relative.replace('\\', '/'))
    return (any(part.lower() in TEST_PARTS for part in path.parts[:-1])
            or path.name.lower() == 'conftest.py'
            or path.name.lower().startswith('test_')
            or path.name.lower().endswith('_test.py'))


def _name(node: ast.AST, aliases: dict[str, str]) -> str:
    if isinstance(node, ast.Name):
        return aliases.get(node.id, node.id)
    if isinstance(node, ast.Attribute):
        return _name(node.value, aliases) + '.' + node.attr
    return ''


def _literal_expression(node: ast.AST) -> bool:
    """Identify static expressions without evaluating scanned code."""
    if isinstance(node, ast.Constant):
        return True
    if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
        return all(_literal_expression(item) for item in node.elts)
    if isinstance(node, ast.Dict):
        return all(key is not None and _literal_expression(key) and _literal_expression(value)
                   for key, value in zip(node.keys, node.values))
    if isinstance(node, ast.BinOp):
        return _literal_expression(node.left) and _literal_expression(node.right)
    if isinstance(node, ast.UnaryOp):
        return _literal_expression(node.operand)
    if isinstance(node, ast.JoinedStr):
        return all(isinstance(item, ast.Constant) or isinstance(item, ast.FormattedValue)
                   and _literal_expression(item.value)
                   and (item.format_spec is None or _literal_expression(item.format_spec))
                   for item in node.values)
    return False


def _dynamic_sql(node: ast.AST) -> bool:
    if _literal_expression(node):
        return False
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'format':
        if _literal_expression(node.func.value) and all(_literal_expression(item) for item in node.args) and all(
                keyword.arg is not None and _literal_expression(keyword.value) for keyword in node.keywords):
            return False
    dynamic = (isinstance(node, ast.JoinedStr) and any(isinstance(item, ast.FormattedValue) for item in node.values)
               or isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Mod, ast.Add))
               or isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'format')
    if not dynamic:
        return False
    literals = ' '.join(str(item.value) for item in ast.walk(node)
                        if isinstance(item, ast.Constant) and isinstance(item.value, str))
    return bool(re.search(r'\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|WITH)\b', literals, re.I))


def _constant_success(node: ast.AST | None) -> bool:
    if isinstance(node, ast.Constant):
        return node.value is True
    if not isinstance(node, ast.Dict):
        return False
    return all(isinstance(value, ast.Constant) for value in node.values) and any(
        isinstance(key, ast.Constant) and isinstance(value, ast.Constant)
        and (str(key.value).lower() in {'success', 'ok'} and value.value is True
             or str(key.value).lower() == 'status' and str(value.value).lower() in {'success', 'ok'})
        for key, value in zip(node.keys, node.values))


def inspect_python(tree: ast.Module, source: str, relative: str, finding: Callable) -> tuple[list[dict], bool]:
    """Return findings and whether a node/finding limit truncated this check.

    The supplied finding factory must redact evidence before it leaves scanning.
    Test fixtures are excluded from behavioral concerns, not unsafe API checks.
    """
    nodes = []
    for node in ast.walk(tree):
        if len(nodes) >= MAX_NODES:
            return [], True
        nodes.append(node)
    aliases: dict[str, str] = {}
    for node in nodes:
        if isinstance(node, ast.Import):
            for item in node.names:
                aliases[item.asname or item.name.split('.')[0]] = item.name if item.asname else item.name.split('.')[0]
        elif isinstance(node, ast.ImportFrom) and node.module:
            for item in node.names:
                aliases[item.asname or item.name] = node.module + '.' + item.name
    lines = source.splitlines()
    findings = []
    fixture = is_fixture(relative)

    def add(node, category, severity, title, description, why, fix, confidence='high', fixable=True):
        line = getattr(node, 'lineno', 1)
        evidence = '\n'.join(lines[line - 1:min(line + 2, len(lines))])[:700]
        findings.append(finding(category, severity, title, description, why, relative,
                                line, evidence, fix, confidence=confidence, fixable=fixable))

    for node in nodes:
        if len(findings) >= MAX_FINDINGS:
            return findings, True
        if not fixture and isinstance(node, (ast.Import, ast.ImportFrom)):
            modules = ([item.name for item in node.names] if isinstance(node, ast.Import)
                       else [node.module or '', *[(node.module or '') + '.' + item.name for item in node.names]])
            if any(module == mock or module.startswith(mock + '.') for module in modules for mock in MOCK_MODULES):
                add(node, 'mock-data', 'medium', 'Mock library imported outside a test fixture',
                    'A module with a production-style path imports a library designed to replace real integrations. The import alone does not prove mock data reaches users.',
                    'If this replacement is active in production, users may receive simulated results instead of the connected service response.',
                    'Trace the imported mock into callers. Keep deliberate simulation explicit and isolate test doubles from production execution.', confidence='medium')
        if isinstance(node, ast.Call):
            name = _name(node.func, aliases)
            if name in {'pickle.load', 'pickle.loads', '_pickle.load', '_pickle.loads', 'dill.load', 'dill.loads', 'yaml.unsafe_load'}:
                add(node, 'security', 'high', 'Deserialization can execute code',
                    f'This source calls {name}, which must not process attacker-controlled serialized input. Static inspection has not established where this input comes from.',
                    'These deserialization APIs can construct objects or execute code rather than just read plain data.',
                    'Use a data-only format such as validated JSON, or establish and enforce a trusted input boundary before deserialization.')
            elif name in {'yaml.load', 'yaml.load_all'}:
                loader = next((keyword.value for keyword in node.keywords if keyword.arg == 'Loader'), None)
                if loader is None and len(node.args) > 1:
                    loader = node.args[1]
                if loader is None or _name(loader, aliases) in {'yaml.Loader', 'yaml.UnsafeLoader', 'yaml.CLoader', 'yaml.CUnsafeLoader'}:
                    add(node, 'security', 'high', 'YAML loading has no explicit safe loader',
                        'This YAML loading call omits a loader or selects an object-capable loader. The installed YAML version and input trust boundary still need review.',
                        'Object-capable YAML loaders may execute code when given malicious YAML; some versions instead reject a missing loader.',
                        'Use yaml.safe_load/safe_load_all for plain data and validate the expected schema.', confidence='medium')
            if isinstance(node.func, ast.Attribute) and node.func.attr in {'execute', 'executemany', 'executescript'} and node.args and _dynamic_sql(node.args[0]):
                add(node, 'security', 'high', 'SQL text is built with interpolation',
                    'A SQL execution call receives SQL assembled with formatting or concatenation. Static inspection has not proven whether interpolated values are controlled by a user.',
                    'If external values are interpolated, they can change the query structure instead of remaining data.',
                    'Bind data through the database driver’s parameter API; validate dynamic identifiers with an explicit allowlist.', confidence='medium')
        if not fixture and isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and re.match(r'^(?:save|create|update|delete|send|upload|persist|insert|write|commit|charge|process_payment)(?:_|[A-Z]|$)', node.name):
            body = [item for item in node.body if not (isinstance(item, ast.Expr) and isinstance(item.value, ast.Constant) and isinstance(item.value.value, str))]
            if len(body) == 1 and isinstance(body[0], ast.Return) and _constant_success(body[0].value):
                add(body[0], 'incomplete', 'low', 'Write-named function returns constant success',
                    f'Function {node.name} has only a constant success return and no observable operation in its body. It may be a deliberate stub or adapter; callers must establish the intended contract.',
                    'A caller could interpret this as completed work even though this function performs no observable call.',
                    'Review the contract and callers. Implement the intended operation or label the simulation explicitly; do not invent an external integration.', confidence='low', fixable=False)
    return findings, False
