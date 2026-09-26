"""Bounded, evidence-based repository inspection and isolated runtime checks.

Repository content is data: scanning never imports it or executes its commands.
The caller must obtain project trust before calling ``run_checks``.
"""
from __future__ import annotations

import ast
import hashlib
import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable, Iterator

from .reality import inspect_python

EXCLUDED = {'.git', '.hg', '.svn', 'node_modules', '.venv', 'venv', '__pycache__',
            'dist', 'build', 'target', '.next', '.cache', 'coverage', '.regen', '.regen-runtime'}
MAX_FILES = 10000
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 100 * 1024 * 1024
LANGUAGES = {'.py': 'Python', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript',
             '.ts': 'TypeScript', '.tsx': 'TypeScript', '.go': 'Go', '.rs': 'Rust',
             '.java': 'Java', '.cs': 'C#', '.php': 'PHP', '.rb': 'Ruby'}
SECRET_PATTERNS = [
    re.compile(r'(?:sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{16,}|nvapi-[A-Za-z0-9_-]{16,}|gsk_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,})\b'),
    re.compile(r'(?i)\b(?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|secret[_-]?key|client[_-]?secret|password)[\"\']?[ \t]*[=:][ \t]*[\"\']?([^\s\"\'`,;]{8,})'),
    re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
]


def _credential_value(value: str) -> bool:
    """Reject references, syntax tokens and documented example values, not real keys."""
    lowered = value.lower()
    if lowered.startswith(('os.environ', 'os.getenv', 'process.env', 'getenv(', 'config.', 'settings.', '${', 'st.secrets', 'environ.', 'self.', 'none', 'null')):
        return False
    normalized = re.sub(r'[^a-z0-9]', '', lowered)
    if re.fullmatch(r'(?:(?:paste|insert|enter|add|put|replace)(?:with)?)?your[a-z0-9]*(?:key|token|password|secret|credential)s?(?:here|goeshere)?', normalized):
        return False
    if any(marker in normalized for marker in ('yourkey', 'yourapikey', 'yourtoken', 'yourpassword', 'placeholder', 'changeme', 'replaceme', 'examplekey', 'exampletoken')):
        return False
    if lowered.startswith(('<', '{', '[', '(', '...')) or set(lowered) <= {'x', '*', '-', '_'}:
        return False
    if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.]*(?:\([^\"\']*|\[[^\"\']*)', value):
        return False
    if re.fullmatch(r'[A-Z][A-Z0-9_]*', value) and re.search(r'(?:KEY|TOKEN|PASSWORD|SECRET)', value):
        return False
    return True


def redact(text: str, limit: int | None = 24000) -> str:
    """Remove recognizable credentials and credential-bearing URLs from output."""
    value = str(text)
    value = re.sub(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----.*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', '[REDACTED PRIVATE KEY]', value, flags=re.S)
    def replace_secret(match):
        if not match.lastindex:
            return '[REDACTED]' if _credential_value(match.group()) else match.group()
        captured = match.group(1)
        if not _credential_value(captured):
            return match.group(0)
        start, end = match.span(1)
        return match.group(0)[:start - match.start()] + '[REDACTED]' + match.group(0)[end - match.start():]
    for pattern in SECRET_PATTERNS:
        value = pattern.sub(replace_secret, value)
    value = re.sub(r'(?i)((?:https?|mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis)://)[^\s/@:]+:[^\s/@]+@', r'\1[REDACTED]@', value)
    # Runtime output may contain arbitrary configured keys without a recognizable prefix.
    for key, secret in os.environ.items():
        if re.search(r'(?i)(token|secret|password|api_?key|nim_key|mongo_uri)', key) and len(secret) >= 6:
            value = value.replace(secret, '[REDACTED]')
    return value[:limit] if limit is not None else value


def _dotenv(path: Path) -> bool:
    return path.name == '.env' or path.name.startswith('.env.') or path.suffix.lower() in {'.pem', '.key', '.p12', '.pfx'}


def _env_template(path: Path) -> bool:
    return path.name.startswith('.env.') and path.name.rsplit('.', 1)[-1].lower() in {'example', 'sample', 'template', 'dist'}


def _walk(path: Path, include_sensitive: bool = False, stats: dict | None = None) -> Iterator[Path]:
    root = path.resolve()
    stats = stats if stats is not None else {}
    # A PRAXIS checkout contains an ignored personal vault and brand masters.
    # These are local product state, not application source for remote review.
    praxis_checkout = False
    try:
        manifest = root / 'package.json'
        if manifest.stat().st_size <= MAX_FILE_BYTES:
            metadata = json.loads(manifest.read_text(encoding='utf-8-sig'))
            praxis_checkout = isinstance(metadata, dict) and metadata.get('name') == 'praxis-memory'
    except (OSError, ValueError, UnicodeError):
        pass
    private_roots = {'.praxis', '.gstack', '.obsidian', '.agents', '.claude', 'assets'}
    count = 0
    total = 0
    for directory, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in EXCLUDED
                         and not (praxis_checkout and Path(directory) == root
                                  and (d in private_roots or d.lower().endswith('intelligence')))
                         and not (Path(directory) / d / 'pyvenv.cfg').is_file()
                         and not (Path(directory) / d).is_symlink()
                         and (Path(directory) / d).resolve().is_relative_to(root))
        for name in sorted(names):
            file = Path(directory) / name
            if file.is_symlink() or (not include_sensitive and _dotenv(file) and not _env_template(file)):
                stats['sensitive_or_symlink_files'] = stats.get('sensitive_or_symlink_files', 0) + 1
                continue
            try:
                file.resolve().relative_to(root)
                size = file.stat().st_size
            except (OSError, ValueError):
                stats['unreadable_files'] = stats.get('unreadable_files', 0) + 1
                continue
            if size > MAX_FILE_BYTES:
                stats['oversized_files'] = stats.get('oversized_files', 0) + 1
                continue
            count += 1
            total += size
            if count > MAX_FILES or total > MAX_TOTAL_BYTES:
                stats['truncated'] = True
                return
            stats['selected_bytes'] = total
            yield file


def safe_files(path: Path) -> Iterator[Path]:
    return _walk(Path(path))


def fingerprint(path: Path) -> str:
    digest = hashlib.sha256()
    root = Path(path).resolve()
    for file in _walk(root, include_sensitive=True):
        digest.update(file.relative_to(root).as_posix().encode())
        try:
            digest.update(file.read_bytes())
        except OSError:
            digest.update(b'<unreadable>')
    return digest.hexdigest()


def _cancel(cancelled: threading.Event) -> None:
    if cancelled.is_set():
        raise RuntimeError('Job cancelled')


def _emit(emit: Callable, message: str) -> None:
    emit({'type': 'log', 'message': redact(message)})


def _finding(category: str, severity: str, title: str, description: str, why: str,
             file: str, line: int, evidence: str, fix: str, fixable: bool = True,
             confidence: str = 'high') -> dict:
    identifier = hashlib.sha256(f'{category}:{file}:{line}:{title}'.encode()).hexdigest()[:16]
    confidence = {'high': 'confirmed', 'medium': 'likely', 'low': 'suggestion'}.get(confidence, confidence)
    return dict(id=identifier, category=category, severity=severity, confidence=confidence,
                title=title, description=description, why=why, location={'file': file, 'line': line},
                evidence=redact(evidence), fix=fix, fixable=fixable)


def _secret_findings(text: str, relative: str) -> list[dict]:
    findings = []
    for number, line in enumerate(text.splitlines(), 1):
        matches = [p.search(line) for p in SECRET_PATTERNS]
        for match in filter(None, matches):
            captured = match.group(1) if match.lastindex else match.group()
            if not _credential_value(captured):
                continue
            # .env is expected to contain credentials: report local exposure, never assert a public leak.
            local_env = relative.split('/')[-1].startswith('.env')
            findings.append(_finding('secrets', 'high', 'Credential stored in a project file',
                'This file contains a value that looks like a credential. Its value is hidden in this report.'
                + (' A local .env credential is not proof of a public leak.' if local_env else ''),
                'Anyone who receives this file may gain access to the connected service.', relative, number,
                'Credential-like value detected; value withheld.',
                'Keep credentials in local environment configuration, exclude them from version control, and rotate any credential that was shared.',
                fixable=not local_env, confidence='medium' if local_env else 'high'))
            break
    return findings


def child_env() -> dict[str, str]:
    allowed = {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA',
               'LOCALAPPDATA', 'COMSPEC', 'PATHEXT', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'LANG'}
    env = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    env.update(CI='1', NO_COLOR='1', GIT_TERMINAL_PROMPT='0', PYTHONIOENCODING='utf-8')
    return env


def _kill(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True, env=child_env(), timeout=15)
    else:
        import signal
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        process.kill()
    except OSError:
        pass


def _executable(command: list[str], cwd: Path | None = None) -> list[str]:
    if not command:
        raise ValueError('An empty command cannot be executed')
    candidate = Path(command[0])
    executable = str((cwd / candidate).resolve()) if cwd and not candidate.is_absolute() and len(candidate.parts) > 1 and (cwd / candidate).is_file() else shutil.which(command[0])
    if not executable:
        raise FileNotFoundError(f'Executable unavailable: {command[0]}')
    # npm on Windows is a .cmd launcher; explicit argv with cmd avoids shell=True.
    if os.name == 'nt' and executable.lower().endswith(('.cmd', '.bat')):
        if any(re.search(r'[&|<>^%\r\n]', arg) for arg in command):
            raise ValueError('Unsafe shell characters in Windows command')
        return [os.environ.get('COMSPEC', 'cmd.exe'), '/d', '/s', '/c', subprocess.list2cmdline([executable, *command[1:]])]
    return [executable, *command[1:]]


def _process(command: list[str], cwd: Path, cancelled: threading.Event, timeout: int = 120, *, env: dict | None = None) -> dict:
    _cancel(cancelled)
    with tempfile.TemporaryFile() as output:
        try:
            process = subprocess.Popen(_executable(command, cwd), cwd=cwd, env=env if env is not None else child_env(), stdout=output,
                stderr=subprocess.STDOUT, start_new_session=os.name != 'nt')
        except (OSError, ValueError) as exc:
            return {'status': 'skipped', 'output': redact(str(exc)), 'exit_code': None}
        deadline = time.monotonic() + timeout
        status = None
        while process.poll() is None:
            if cancelled.is_set() or time.monotonic() >= deadline:
                status = 'cancelled' if cancelled.is_set() else 'timeout'
                _kill(process)
                break
            if output.tell() > 10 * 1024 * 1024:
                status = 'failed'
                _kill(process)
                break
            time.sleep(.1)
        process.wait(timeout=20)
        output.seek(0)
        content = output.read(24000).decode('utf-8', errors='replace')
        return {'status': status or ('passed' if process.returncode == 0 else 'failed'),
                'output': redact(content), 'exit_code': process.returncode}


def _remove_clone(staging: Path, workspace: Path) -> None:
    """Remove only our checked staging directory, including Windows Git readonly files."""
    if staging.is_symlink():
        raise ValueError('Refusing cleanup of a symlink staging directory')
    staging = staging.resolve()
    workspace = workspace.resolve()
    if staging.parent != workspace or not staging.name.startswith('clone-') or staging.is_symlink():
        raise ValueError('Refusing cleanup outside the job clone directory')
    def writable_retry(function, filename, error):
        target = Path(filename)
        if not target.resolve().is_relative_to(staging):
            raise ValueError('Refusing cleanup outside clone staging')
        target.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
        function(filename)
    if staging.exists():
        shutil.rmtree(staging, onerror=writable_retry)


def git_env() -> dict[str, str]:
    # Git needs the user's network routing/enterprise certificate settings.
    # Project commands still receive child_env(), without provider credentials.
    env = child_env()
    network = {'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
               'GIT_SSL_CAINFO', 'GIT_SSL_CAPATH', 'SSL_CERT_FILE', 'SSL_CERT_DIR'}
    env.update({key: value for key, value in os.environ.items() if key.upper() in network})
    return env


def clone_failure(result: dict) -> str:
    output = result.get('output', '')
    lowered = output.lower()
    if result.get('status') == 'cancelled':
        return 'GitHub clone cancelled. No project was scanned.'
    if result.get('status') == 'timeout' or any(marker in lowered for marker in (
            'could not connect', 'failed to connect', 'could not resolve',
            'connection timed out', 'network is unreachable', 'connection reset')):
        reason = ('GitHub is unreachable from the workbench process. Check network, VPN, proxy, '
                  'or firewall access to github.com:443. If started by a restricted coding-agent '
                  'terminal, restart npm run dev in a normal terminal. You can also upload '
                  'a downloaded folder or scan an existing local checkout.')
    elif any(marker in lowered for marker in ('authentication failed', 'could not read username',
                                              'repository not found', '403', '401')):
        reason = ('GitHub rejected access or the repository does not exist. Verify owner/repository '
                  'and sign in with your existing Git credential manager for private repositories. '
                  'Do not paste tokens into the URL.')
    elif any(marker in lowered for marker in ('certificate', 'ssl peer', 'ssl connect')):
        reason = 'GitHub TLS verification failed. Check trusted certificates and your HTTPS proxy; keep TLS verification enabled.'
    elif result.get('status') == 'skipped':
        reason = 'Git could not start. Install Git and ensure it is available in the workbench process PATH.'
    else:
        reason = 'GitHub clone failed. Verify the repository URL and inspect the Git diagnostic below.'
    return reason + '\n' + redact(output, limit=4000)


def prepare_project(source: str, workspace: Path, emit: Callable, cancelled: threading.Event) -> dict:
    workspace = Path(workspace).resolve()
    source = source.strip()
    github = re.fullmatch(r'https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?', source)
    if source.startswith(('http://', 'https://', 'git@')) and not github:
        raise ValueError('Use a GitHub HTTPS repository URL such as https://github.com/owner/repo')
    staging = None
    if github:
        source = f'https://github.com/{github[1]}/{github[2]}.git'
        workspace.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix='clone-', dir=workspace))
        _emit(emit, 'Cloning GitHub repository using existing Git authentication')
        result = _process(['git', 'clone', '--depth', '1', '--', source, str(staging / 'source')], workspace, cancelled, 180, env=git_env())
        if result['status'] != 'passed':
            _remove_clone(staging, workspace)
            raise ValueError(clone_failure(result))
        original = staging / 'source'
    else:
        original = Path(source).expanduser().resolve()
        if not original.is_dir():
            raise ValueError('The project folder does not exist or is not a directory')
        if workspace == original or (workspace.is_relative_to(original) and '.regen' not in workspace.relative_to(original).parts):
            raise ValueError('The job workspace must be outside the submitted project folder')
        workspace.mkdir(parents=True, exist_ok=True)
    destination = workspace / 'project'
    intake = []
    try:
        if destination.exists():
            raise ValueError('This job workspace already contains a project')
        destination.mkdir()
        original_fingerprint = fingerprint(original)
        _emit(emit, 'Creating an isolated snapshot including local uncommitted files')
        for file in _walk(original, include_sensitive=True):
            _cancel(cancelled)
            relative = file.relative_to(original)
            if _dotenv(file):
                content = file.read_text(encoding='utf-8', errors='replace')
                intake.extend(_secret_findings(content, relative.as_posix()))
                if _env_template(file):
                    target = destination / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(redact(content, limit=None), encoding='utf-8')
                continue
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, target)
        discovered = discover_commands(destination)
        return {'path': str(destination), 'name': github.group(2) if github else original.name,
                'source': source if github else str(original), 'source_fingerprint': original_fingerprint,
                'languages': sorted({LANGUAGES[f.suffix] for f in safe_files(destination) if f.suffix in LANGUAGES}),
                'findings': intake, **discovered}
    finally:
        if staging:
            _remove_clone(staging, workspace)


def discover_commands(path: Path) -> dict:
    path = Path(path)
    commands = []
    start = None
    manifest = path / 'package.json'
    if manifest.is_file():
        try:
            package = json.loads(manifest.read_text(encoding='utf-8'))
            scripts = package.get('scripts', {})
            if (path / 'package-lock.json').is_file():
                commands.append(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'])
            else:
                commands.append(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund'])
            for name in ('lint', 'test', 'build'):
                if name in scripts:
                    commands.append(['npm', 'run', name])
            if 'dev' in scripts:
                start = ['npm', 'run', 'dev']
                deps = {**package.get('dependencies', {}), **package.get('devDependencies', {})}
                if 'next' in deps:
                    start += ['--', '--port', '4173', '--hostname', '127.0.0.1']
                elif 'vite' in deps:
                    start += ['--', '--port', '4173', '--host', '127.0.0.1', '--strictPort']
            elif 'start' in scripts:
                start = ['npm', 'run', 'start']
        except (ValueError, TypeError, OSError):
            pass
    if (path / 'pyproject.toml').exists() or (path / 'requirements.txt').exists():
        python = '.regen-runtime/Scripts/python.exe' if os.name == 'nt' else '.regen-runtime/bin/python'
        commands.append([sys.executable, '-m', 'venv', '.regen-runtime'])
        if (path / 'requirements.txt').is_file():
            commands.append([python, '-m', 'pip', 'install', '--no-cache-dir', '--disable-pip-version-check', '-r', 'requirements.txt'])
        else:
            commands.append([python, '-m', 'pip', 'install', '--no-cache-dir', '--disable-pip-version-check', '.'])
        if (path / 'tests').is_dir() or any(path.glob('test_*.py')):
            test_root = path / 'tests' if (path / 'tests').is_dir() else path
            test_files = list(test_root.glob('test_*.py'))[:30]
            standard_library = bool(test_files) and all('unittest' in file.read_text('utf-8', errors='replace') for file in test_files)
            if not standard_library:
                commands.append([python, '-m', 'pip', 'install', '--no-cache-dir', '--disable-pip-version-check', 'pytest'])
            commands.append([python, '-m', 'unittest', 'discover', '-s', str(test_root.relative_to(path)) or '.'] if standard_library else [python, '-m', 'pytest', '-q'])
        app = path / 'app.py'
        if app.is_file() and re.search(r'(?m)^\s*(?:import streamlit\b|from streamlit\b)', app.read_text('utf-8', errors='replace')):
            start = [python, '-m', 'streamlit', 'run', 'app.py', '--server.port', '4173', '--server.address', '127.0.0.1', '--server.headless', 'true', '--browser.gatherUsageStats', 'false']
    for marker, command in [('go.mod', ['go', 'test', './...']), ('Cargo.toml', ['cargo', 'test'])]:
        if (path / marker).is_file():
            commands.append(command)
    if (path / 'pom.xml').is_file():
        commands.append(['mvn', 'test', '--batch-mode'])
    elif (path / 'build.gradle').is_file() or (path / 'build.gradle.kts').is_file():
        commands.append(['gradle', 'test', '--no-daemon'])
    if any(path.glob('*.sln')) or any(path.glob('*.csproj')):
        commands.append(['dotnet', 'test', '--nologo'])
    return {'commands': commands, 'start_command': start}


def _text(file: Path) -> str | None:
    try:
        data = file.read_bytes()
        if b'\0' in data:
            return None
        return data.decode('utf-8-sig')
    except (OSError, UnicodeError):
        return None


def _osv(path: Path, cancelled: threading.Event) -> tuple[list[dict], dict]:
    """Query only exact package versions; repository source is never uploaded."""
    queries = []
    locations = []
    lock = path / 'package-lock.json'
    if lock.is_file():
        try:
            content = json.loads(lock.read_text(encoding='utf-8'))
            for name, item in content.get('packages', {}).items():
                version = item.get('version')
                if name and version and 'node_modules/' in name:
                    package = item.get('name') or name.rsplit('node_modules/', 1)[1]
                    queries.append({'package': {'name': package, 'ecosystem': 'npm'}, 'version': version})
                    locations.append(('package-lock.json', package, version))
        except (OSError, ValueError, AttributeError):
            pass
    requirements = path / 'requirements.txt'
    if requirements.is_file():
        for line in requirements.read_text(encoding='utf-8', errors='replace').splitlines():
            match = re.fullmatch(r'\s*([A-Za-z0-9_.-]+)==([A-Za-z0-9.+_-]+)\s*(?:#.*)?', line)
            if match:
                queries.append({'package': {'name': match[1], 'ecosystem': 'PyPI'}, 'version': match[2]})
                locations.append(('requirements.txt', match[1], match[2]))
    if not queries:
        return [], {'name': 'OSV dependencies', 'status': 'skipped', 'detail': 'No supported exact-version npm lockfile or Python requirements found.'}
    findings = []
    try:
        for offset in range(0, min(len(queries), 1000), 100):
            _cancel(cancelled)
            request = urllib.request.Request('https://api.osv.dev/v1/querybatch',
                data=json.dumps({'queries': queries[offset:offset + 100]}).encode(),
                headers={'Content-Type': 'application/json'}, method='POST')
            with urllib.request.urlopen(request, timeout=10) as response:
                results = json.load(response).get('results', [])
            for index, result in enumerate(results):
                file, package, version = locations[offset + index]
                identifiers = [v.get('id', 'unknown advisory') for v in result.get('vulns', [])]
                if identifiers:
                    findings.append(_finding('dependencies', 'high', f'Known vulnerability in {package}',
                        f'{package} {version} matches public vulnerability advisories.',
                        'Affected dependency code may expose the application to known attacks; applicability requires review.',
                        file, 1, ', '.join(identifiers), 'Upgrade to a patched compatible version and run the project checks.', confidence='high'))
        return findings, {'name': 'OSV dependencies', 'status': 'limited' if len(queries) > 1000 else 'passed', 'detail': f'Checked {min(len(queries), 1000)} of {len(queries)} exact package versions; only package names and versions sent. Versions without exact pins and unsupported manifests are not checked.'}
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        return findings, {'name': 'OSV dependencies', 'status': 'skipped', 'detail': 'Advisory service unavailable: ' + redact(str(exc))}


def scan_project(path: Path, emit: Callable, cancelled: threading.Event) -> dict:
    path = Path(path).resolve()
    findings = []
    coverage = []
    limits = {'max_files': MAX_FILES, 'max_file_bytes': MAX_FILE_BYTES, 'max_total_bytes': MAX_TOTAL_BYTES, 'truncated': False}
    files = list(_walk(path, stats=limits))
    text_count = python_count = 0
    unsupported = set()
    _emit(emit, f'Inspecting {len(files)} bounded project files')
    rules = [
        (r'\b(?:app|router)\.use\s*\(\s*cors\s*\(\s*\)', 'security', 'medium', 'Cross-origin access is broadly enabled', 'The server enables CORS without an explicit origin allowlist.', 'Review whether browser access should be restricted to your application origins.', 'Configure a deliberate origin allowlist where endpoints contain private data.', 'medium'),
        (r'\b(?:rejectUnauthorized\s*:\s*false|verify\s*=\s*False)\b', 'security', 'high', 'TLS certificate verification is disabled', 'A network client accepts connections without checking the server certificate.', 'An attacker may impersonate the remote server and read or change traffic.', 'Enable certificate verification and configure trusted certificates.', 'high'),
        (r'\bdangerouslySetInnerHTML\s*=', 'security', 'medium', 'Raw HTML insertion needs a safety review', 'The interface renders HTML directly rather than escaping text.', 'If this HTML includes untrusted input, it can execute scripts in a visitor’s browser.', 'Trace the input and sanitize untrusted HTML with a maintained sanitizer.', 'medium'),
        (r'(?i)(?:throw\s+new\s+Error\s*\(\s*[\"\'](?:not implemented|todo)|raise\s+NotImplementedError)', 'incomplete', 'medium', 'A code path is explicitly unfinished', 'This implementation throws an unfinished-feature error when called.', 'Users reaching this path may encounter a failure instead of the advertised behavior.', 'Implement the intended behavior and add a test covering callers of this path.', 'high'),
        (r'\b(?:debug\s*=\s*True|DEBUG\s*=\s*True)\b', 'security', 'medium', 'Debug mode is explicitly enabled', 'The configuration enables application debug mode.', 'If deployed with this setting, errors may reveal internal details.', 'Use environment-based debug configuration that defaults off in production.', 'medium'),
    ]
    for file in files:
        _cancel(cancelled)
        text = _text(file)
        if text is None:
            limits['binary_or_non_utf8_files'] = limits.get('binary_or_non_utf8_files', 0) + 1
            continue
        text_count += 1
        relative = file.relative_to(path).as_posix()
        findings.extend(_secret_findings(text, relative))
        if file.suffix == '.py':
            python_count += 1
            try:
                tree = ast.parse(text, filename=relative)
                ast_findings, ast_limited = inspect_python(tree, text, relative, _finding)
                findings.extend(ast_findings)
                if ast_limited:
                    coverage.append({'name': 'Python behavioral AST limit', 'status': 'limited',
                        'detail': f'Bounded behavioral inspection was truncated in {relative}; remaining patterns were not checked.'})
            except SyntaxError as exc:
                findings.append(_finding('correctness', 'high', 'Python source cannot be parsed',
                    'Python found an actual syntax error in this source file; it was checked without executing the code.',
                    'The module cannot start or be imported until its syntax is corrected.', relative, exc.lineno or 1,
                    f'Python parser: {exc.msg}', 'Correct the reported syntax and run the project checks.'))
            except RecursionError:
                coverage.append({'name': 'Python parser resource limit', 'status': 'limited',
                    'detail': f'Python syntax parsing exceeded recursion limits in {relative}; this is not proof of a syntax defect.'})
        if file.suffix not in LANGUAGES and file.suffix not in {'.html', '.vue', '.svelte'}:
            unsupported.add(file.suffix.lower() or '(no extension)')
            continue
        test_file = any(part in {'tests', 'test', '__tests__', 'fixtures', 'mocks'} for part in file.parts) or bool(re.search(r'\.(?:test|spec)\.', file.name))
        for number, line in enumerate(text.splitlines(), 1):
            for expression, category, severity, title, description, why, fix, confidence in rules:
                if re.search(expression, line) and not line.lstrip().startswith(('#', '//', '*')) and not test_file:
                    findings.append(_finding(category, severity, title, description, why, relative, number,
                        line.strip()[:250], fix, confidence=confidence))
            if re.search(r'<button\b', line) and re.search(r'\bdisabled\s*=\s*\{?true\}?', line):
                findings.append(_finding('ui', 'low', 'A button is permanently disabled',
                    'This button is written with a constant disabled value.', 'Visitors cannot use this control; this may be intentional.',
                    relative, number, line.strip()[:250], 'Connect the disabled state to real loading or validation state if the action should work.', confidence='medium'))
    coverage.append({'name': 'Local source inspection', 'status': 'limited' if limits['truncated'] else 'passed',
        'detail': f'{text_count} UTF-8 text files inspected; symlinks, generated dependencies, local credentials, binary and large files excluded. Limits: {MAX_FILES} files, 2 MiB/file, 100 MiB total.', 'limits': limits})
    coverage.append({'name': 'Python syntax', 'status': 'passed' if python_count else 'skipped',
        'detail': f'{python_count} Python files parsed with AST without imports or execution. This checks syntax only; dependencies and runtime behavior need trusted checks.'})
    coverage.append({'name': 'Python behavioral AST patterns', 'status': 'limited' if python_count else 'skipped',
        'detail': 'Bounded checks for object-capable deserialization, directly interpolated SQL, production-path mock imports and constant success stubs. These checks do not trace input provenance, prove exploitation, detect all mocks, or establish authorship. Behavioral fixture exclusions use explicit test/fixture names only.'})
    if unsupported:
        coverage.append({'name': 'Format coverage', 'status': 'limited', 'formats': sorted(unsupported),
            'detail': 'These text formats were checked for credential patterns only; language-specific correctness was not verified.'})
    for tool, command in [('Semgrep', ['semgrep', 'scan', '--config', 'p/security-audit', '--json', '--quiet', '--timeout', '10', '--metrics', 'off', '.']),
                          ('Gitleaks', ['gitleaks', 'dir', '.', '--report-format', 'json', '--report-path', '-', '--redact', '--no-banner'])]:
        _cancel(cancelled)
        if not shutil.which(command[0]):
            coverage.append({'name': tool, 'status': 'skipped', 'detail': f'{tool} is not installed.'})
            continue
        result = _process(command, path, cancelled, 90)
        try:
            data = json.loads(result['output'])
            records = data.get('results', []) if isinstance(data, dict) else data
            for item in records:
                if tool == 'Semgrep':
                    extra = item.get('extra', {})
                    file = item.get('path', '')
                    number = item.get('start', {}).get('line', 1)
                    title = extra.get('message', item.get('check_id', 'Security rule matched'))
                else:
                    file, number = item.get('File', ''), item.get('StartLine', 1)
                    title = 'Credential pattern detected by Gitleaks'
                # Tool paths may be absolute; expose only locations inside the snapshot.
                candidate = Path(file)
                if candidate.is_absolute():
                    try:
                        file = candidate.resolve().relative_to(path).as_posix()
                    except ValueError:
                        continue
                findings.append(_finding('security' if tool == 'Semgrep' else 'secrets', 'high',
                    redact(title), 'A static analysis rule matched this location; review its applicability.',
                    'The matched pattern may expose data or create an unsafe code path.', file, number,
                    f'{tool} rule matched; sensitive source excerpts withheld.', 'Review the rule and repair the underlying behavior.', confidence='medium'))
            coverage.append({'name': tool, 'status': 'passed', 'detail': f'{len(records)} rule matches. Matches require contextual review.'})
        except (ValueError, TypeError, AttributeError):
            coverage.append({'name': tool, 'status': 'skipped', 'detail': 'Tool did not return a usable report: ' + result['output'][:600]})
    osv_findings, osv_coverage = _osv(path, cancelled)
    findings.extend(osv_findings)
    coverage.append(osv_coverage)
    coverage.append({'name': 'AI authorship and production data', 'status': 'limited', 'detail': 'Authorship cannot be proven from code. Mocks, placeholders and generic structure need contextual AI review; legitimate fixtures are not defects by themselves.'})
    unique = {finding['id']: finding for finding in findings}
    return {'findings': list(unique.values()), 'coverage': coverage,
            'languages': sorted({LANGUAGES[f.suffix] for f in files if f.suffix in LANGUAGES}), 'files_scanned': len(files)}


def _browser_check(path: Path, start: list[str], emit: Callable, cancelled: threading.Event) -> dict:
    if importlib.util.find_spec('playwright') is None:
        return {'name': 'Browser checks', 'status': 'skipped', 'output': 'Playwright is not installed; runtime UI was not verified.'}
    with tempfile.TemporaryFile() as output:
        process = None
        try:
            _cancel(cancelled)
            env = child_env()
            env['PORT'] = '4173'
            process = subprocess.Popen(_executable(start, path), cwd=path, env=env, stdout=output,
                stderr=subprocess.STDOUT, start_new_session=os.name != 'nt')
            from playwright.sync_api import sync_playwright
            issues = []
            with sync_playwright() as runtime:
                browser = runtime.chromium.launch(headless=True)
                try:
                    page = browser.new_page()
                    page.on('pageerror', lambda error: issues.append('Browser error: ' + redact(str(error))))
                    page.on('requestfailed', lambda request: issues.append('Failed request: ' + redact(request.url)))
                    ready = False
                    for _ in range(40):
                        _cancel(cancelled)
                        try:
                            issues.clear()
                            page.goto('http://127.0.0.1:4173', timeout=1500, wait_until='domcontentloaded')
                            ready = True
                            break
                        except Exception:
                            if process.poll() is not None:
                                break
                            time.sleep(.5)
                    if not ready:
                        output.seek(0)
                        detail = redact(output.read(6000).decode('utf-8', errors='replace'))
                        return {'name': 'Browser checks', 'status': 'failed', 'output': 'App did not become reachable at http://127.0.0.1:4173. Supply a start command using this port.\n' + detail}
                    page.wait_for_timeout(1000)
                    _cancel(cancelled)
                    exceptions = page.locator('[data-testid="stException"]')
                    for index in range(min(exceptions.count(), 10)):
                        if exceptions.nth(index).is_visible():
                            issues.append('Streamlit application error: ' + redact(exceptions.nth(index).inner_text(), limit=1500))
                    for width, height in [(1440, 900), (390, 844)]:
                        _cancel(cancelled)
                        page.set_viewport_size({'width': width, 'height': height})
                        if page.evaluate('document.documentElement.scrollWidth > window.innerWidth + 2'):
                            issues.append(f'Horizontal overflow at {width}px viewport')
                    count = page.locator('button').count()
                    for index in range(min(count, 100)):
                        button = page.locator('button').nth(index)
                        if button.is_visible() and not (button.inner_text().strip() or button.get_attribute('aria-label') or button.get_attribute('title')):
                            issues.append('A visible button has no text or accessible label')
                    return {'name': 'Browser checks', 'status': 'failed' if issues else 'passed',
                        'output': '\n'.join(issues) if issues else 'Desktop/mobile overflow, browser errors, failed requests and button names checked on the home page. Control behavior and other routes require manual/contextual review.'}
                finally:
                    browser.close()
        except Exception as exc:
            return {'name': 'Browser checks', 'status': 'cancelled' if cancelled.is_set() else 'skipped', 'output': redact(str(exc))}
        finally:
            if process:
                _kill(process)


def run_checks(path: Path, commands: list[list[str]], emit: Callable, cancelled: threading.Event,
               start_command: list[str] | None = None) -> list[dict]:
    results = []
    for command in commands:
        if cancelled.is_set():
            break
        if not isinstance(command, list) or not command or not all(isinstance(arg, str) for arg in command):
            results.append({'name': 'Invalid command', 'status': 'skipped', 'output': 'Commands must be nonempty argument lists.'})
            continue
        _emit(emit, 'Running trusted project check: ' + ' '.join(command))
        install = '-m' in command and 'pip' in command and 'install' in command
        result = {'name': ' '.join(command), **_process(command, Path(path), cancelled, 600 if install else 120)}
        results.append(result)
        if result['status'] != 'passed' and (install or ('-m' in command and 'venv' in command)):
            results.append({'name': 'Dependent runtime checks', 'status': 'skipped', 'output': 'Isolated Python environment setup failed; dependent checks and app startup were not run.'})
            start_command = None
            break
    if start_command and not cancelled.is_set():
        _emit(emit, 'Checking web interface in desktop and mobile browser viewports')
        results.append(_browser_check(Path(path), start_command, emit, cancelled))
    if not results:
        results.append({'name': 'Project checks', 'status': 'skipped', 'output': 'No supported project checks discovered or approved.'})
    return results
