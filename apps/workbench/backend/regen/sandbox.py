"""Opt-in, disposable Docker execution. Never falls back to host execution."""
from __future__ import annotations

import io
import re
import tarfile
import tempfile
import threading
import time
import uuid
from pathlib import Path

from . import scanner

IMAGES = {'node': 'node:22-bookworm-slim', 'python': 'python:3.12-slim'}
MAX_COMMANDS = 16
MAX_SECONDS = 600
PRIVATE = {'.npmrc', '.pypirc', '.netrc', '.git-credentials', 'credentials',
           'id_rsa', 'id_ed25519', '.ssh', '.aws', '.azure', '.kube', '.praxis'}
_health_lock = threading.Lock()
_health_cache = (0.0, None)


def command_runtime(argv):
    """Translate only discovered Python executables, never a submitted host path."""
    if not argv or not all(isinstance(arg, str) and '\x00' not in arg for arg in argv):
        return None, []
    exe = argv[0].replace('\\', '/')
    if exe == 'npm':
        return 'node', list(argv)
    if exe.rsplit('/', 1)[-1] in {'uv', 'uv.exe'}:
        return 'python', ['/workspace/.regen-runtime/bin/uv', *argv[1:]]
    if exe in {'.regen-runtime/Scripts/python.exe', '.regen-runtime/bin/python'}:
        return 'python', ['/workspace/.regen-runtime/bin/python', *argv[1:]]
    if re.fullmatch(r'python(?:3(?:\.\d+)?)?(?:\.exe)?', exe.rsplit('/', 1)[-1]):
        return 'python', ['python', *argv[1:]]
    return None, []


def archive_source(root, target, cancelled):
    """Copy bounded regular files only; no host mounts or credential config."""
    root = Path(root).resolve()
    size = count = 0
    with tarfile.open(target, 'w') as archive:
        for file in scanner.safe_files(root):
            scanner._cancel(cancelled)
            rel = file.relative_to(root)
            if (file.is_symlink() or not file.resolve().is_relative_to(root)
                    or any(part.lower() in PRIVATE or part.lower().startswith('.env') for part in rel.parts)
                    or file.suffix.lower() in {'.pem', '.key', '.p12', '.pfx'}):
                continue
            raw = file.read_bytes()
            size += len(raw)
            count += 1
            if size > scanner.MAX_TOTAL_BYTES or count > scanner.MAX_FILES:
                raise ValueError('Container source exceeds the bounded snapshot size')
            try:
                raw = scanner.redact(raw.decode('utf-8'), limit=None, python_source=file.suffix.lower() == '.py').encode('utf-8')
            except UnicodeDecodeError:
                pass
            info = tarfile.TarInfo(rel.as_posix())
            info.size = len(raw)
            info.uid = info.gid = 1000
            info.mode = 0o755 if file.stat().st_mode & 0o111 else 0o644
            archive.addfile(info, io.BytesIO(raw))
    return count


def health():
    """Fast cached readiness only; never pulls images or changes Docker state."""
    global _health_cache
    with _health_lock:
        if _health_cache[1] is not None and time.monotonic() - _health_cache[0] < 10:
            return _health_cache[1]
        event = threading.Event()
        context = scanner._process(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], Path.cwd(), event, timeout=5)
        endpoint = context.get('output', '').strip()
        local = context['status'] == 'passed' and endpoint.startswith(('unix:///', 'npipe:////./pipe/'))
        server = scanner._process(['docker', 'info', '--format', '{{.OSType}}'], Path.cwd(), event, timeout=5) if local else {'status': 'failed', 'output': ''}
        engine = server['status'] == 'passed' and server.get('output', '').strip() == 'linux'
        images = {}
        for runtime, image in IMAGES.items():
            inspected = scanner._process(['docker', 'image', 'inspect', '--format', '{{.Id}}', image], Path.cwd(), event, timeout=5) if engine else {'status': 'failed'}
            images[runtime] = {'image': image, 'ready': inspected.get('status') == 'passed'}
        value = {'ready': engine and all(item['ready'] for item in images.values()), 'engine': engine,
                 'local_context': local, 'images': images,
                 'detail': 'Linux Docker and required images are ready.' if engine and all(item['ready'] for item in images.values())
                           else 'Start the local Linux Docker engine and pull the missing images.'}
        _health_cache = (time.monotonic(), value)
        return value


def run_checks(path, commands, emit, cancelled, *, allow_network=False, start_command=None, on_result=None):
    """Run in Linux containers with bounded CPU, RAM, PIDs, disk and wall time.

    Network is disabled unless explicitly authorized for this run. Authorized
    networking is Docker bridge networking (not a registry-only allowlist).
    Command success is process evidence, not proof of coverage or correctness.
    """
    path = Path(path).resolve()
    results = []
    containers = {}
    unavailable = set()
    failed_setup = set()
    deadline = time.monotonic() + MAX_SECONDS
    endpoint = None

    def docker(args, timeout=30, cleanup=False, input_file=None):
        return scanner._process(['docker', *args], path,
                                threading.Event() if cleanup else cancelled,
                                timeout=timeout if cleanup else max(1, min(timeout, int(deadline - time.monotonic()))),
                                **({'env': {**scanner.child_env(), 'DOCKER_HOST': endpoint}} if endpoint else {}),
                                **({'input_file': input_file} if input_file is not None else {}))

    def record(name, result, kind='runtime', **extra):
        item = dict(name=name, kind=kind, runtime='docker', **result, **extra)
        results.append(item)
        if on_result:
            on_result(list(results))
        emit({'message': f"Container check: {name} — {item['status']}"})

    context = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], 10)
    endpoint = context.get('output', '').strip()
    if context['status'] != 'passed' or not endpoint.startswith(('unix:///', 'npipe:////./pipe/')):
        record('Container runtime', {'status': 'skipped', 'output': 'A local Unix socket or Windows named-pipe Docker context is required. Source was not sent to a remote engine.'}, 'infrastructure')
        return results
    server = docker(['info', '--format', '{{.OSType}}'], 10)
    if server['status'] != 'passed' or server.get('output', '').strip() != 'linux':
        record('Container runtime', {'status': 'skipped', 'output': 'Linux Docker engine unavailable. Start Docker Desktop. No project commands ran.\n' + server.get('output', '')}, 'infrastructure')
        return results
    try:
        with tempfile.TemporaryDirectory(prefix='praxis-sandbox-') as temporary:
            archive = Path(temporary) / 'source.tar'
            archive_source(path, archive, cancelled)
            for index, argv in enumerate(commands[:MAX_COMMANDS]):
                scanner._cancel(cancelled)
                if time.monotonic() >= deadline:
                    record('Remaining commands', {'status': 'skipped', 'output': 'The 10 minute runtime budget was reached.'}, 'infrastructure')
                    break
                runtime, translated = command_runtime(argv)
                name = ' '.join(argv)
                setup = scanner.is_setup_command(argv)
                kind = 'setup' if setup else 'command'
                if not runtime or runtime in unavailable or runtime in failed_setup:
                    record(name, {'status': 'skipped', 'output': 'Unsupported runtime, unavailable image, or a required setup step failed.'}, kind)
                    continue
                if runtime not in containers:
                    image = docker(['image', 'inspect', '--format', '{{.Id}}', IMAGES[runtime]], 10)
                    image_id = image.get('output', '').strip()
                    if image['status'] != 'passed' or not re.fullmatch(r'sha256:[a-f0-9]{64}', image_id):
                        unavailable.add(runtime)
                        record(name, {'status': 'skipped', 'output': f'Image unavailable. Run: docker pull {IMAGES[runtime]}. No automatic pull or host fallback.'}, kind)
                        continue
                    container = 'praxis-check-' + uuid.uuid4().hex
                    containers[runtime] = (container, image_id)
                    created = docker(['create', '--name', container, '--init', '--user', '1000:1000', '--pull', 'never', '--log-driver', 'none',
                                      '--network', 'bridge' if allow_network else 'none',
                                      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                                      '--memory', '1g', '--memory-swap', '1g', '--cpus', '1', '--pids-limit', '128',
                                      '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m,mode=1777',
                                      '--tmpfs', '/workspace:rw,exec,nosuid,nodev,size=512m,uid=1000,gid=1000,mode=0700',
                                      '--workdir', '/workspace', '--env', 'HOME=/tmp', '--env', 'CI=1',
                                      '--env', 'UV_CACHE_DIR=/workspace/.regen-runtime/uv-cache',
                                      '--env', 'NO_COLOR=1', '--env', 'PYTHONDONTWRITEBYTECODE=1',
                                      *[arg for name in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy') for arg in ('--env', name + '=')],
                                      '--entrypoint', '/bin/sleep', image_id, str(MAX_SECONDS + 60)])
                    if created['status'] == 'passed':
                        created = docker(['start', container])
                    if created['status'] == 'passed':
                        with archive.open('rb') as source:
                            created = docker(['exec', '-i', container, 'tar', '--no-same-owner', '-xf', '-', '-C', '/workspace'], input_file=source)
                    if created['status'] != 'passed':
                        unavailable.add(runtime)
                        record(name, {'status': 'skipped', 'output': 'Container setup failed.\n' + created.get('output', '')}, kind)
                        continue
                container, image_id = containers[runtime]
                emit({'message': 'Running in container: ' + name})
                result = docker(['exec', container, *translated], 300 if setup else 180)
                record(name, result, kind, image=image_id, network='bridge' if allow_network else 'none')
                if result['status'] in {'timeout', 'cancelled'}:
                    failed_setup.add(runtime)
                    docker(['rm', '-f', container], cleanup=True)
                elif setup and result['status'] != 'passed':
                    failed_setup.add(runtime)
            if len(commands) > MAX_COMMANDS:
                record('Additional commands', {'status': 'skipped', 'output': f'Limited to {MAX_COMMANDS} commands per run.'}, 'infrastructure')
            if not commands:
                record('Project commands', {'status': 'skipped', 'output': 'No supported test/build commands discovered.'})
            if start_command:
                record('Browser journeys', {'status': 'skipped', 'output': 'Browser execution is not supported by this container runner. No user journey was verified.'}, 'browser')
    finally:
        for container, _ in containers.values():
            removed = docker(['rm', '-f', container], cleanup=True)
            if removed['status'] != 'passed' and 'No such container' not in removed.get('output', ''):
                record('Container cleanup', {'status': 'failed', 'output': f'Could not remove {container}: ' + removed.get('output', '')}, 'infrastructure')
    return results
