"""Local-only ReGen API, durable jobs, and isolated repair workflow."""
from __future__ import annotations

import asyncio
import io
import json
import os
import shlex
import threading
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from .store import Store
from .intake import (MAX_UPLOAD_BODY, append_upload_batch, cancel_upload_session,
                     create_upload_session, finish_upload_session, save_upload,
                     prune_upload_sessions, uploaded_project)
from . import review, sandbox
from .paths import runtime_paths

ROOT = Path(__file__).resolve().parents[2]
DATA, _ = runtime_paths(ROOT)
store = Store(DATA / "jobs.sqlite3")
lock = threading.RLock()
workers: dict[str, threading.Thread] = {}
upload_slots = threading.BoundedSemaphore(2)
probe_slot = threading.BoundedSemaphore(1)
cancellations: dict[str, threading.Event] = {}
app = FastAPI(title="PRAXIS Workbench", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"], allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


def modules():
    from . import scanner, provider
    return scanner, provider


def now():
    return datetime.now(timezone.utc).isoformat()


def sanitize(value):
    scanner, _ = modules()
    if isinstance(value, str):
        return scanner.redact(value, limit=None)
    if isinstance(value, dict):
        result = {k: sanitize(v) for k, v in value.items() if k not in {"snapshot", "source_fingerprint", "resume", "fix_path", "workspace", "checks_for"}}
        if isinstance(result.get("fix"), dict):
            result["fix"].pop("path", None)
        return result
    if isinstance(value, list):
        return [sanitize(v) for v in value]
    return value


def get_job(job_id):
    job = store.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


def public_job(job):
    # Render existing evidence using the current presentation contract. No stored
    # source, checks, receipts, or job history are migrated or overwritten.
    return sanitize({**job, 'assessment': review.assessment(job)})


def update(job_id, **changes):
    with lock:
        job = get_job(job_id)
        # Preserve internal paths, but never persist raw provider/scanner output.
        scanner, _ = modules()
        def redact_values(value):
            if isinstance(value, str):
                return scanner.redact(value, limit=None)
            if isinstance(value, dict):
                return {k: redact_values(v) for k, v in value.items()}
            if isinstance(value, list):
                return [redact_values(v) for v in value]
            return value
        job.update(redact_values(changes))
        if job.get('plan'):
            job['assessment'] = review.assessment(job)
        job["revision"] = job.get("revision", 0) + 1
        store.save(job)
    return job


def emit_for(job_id):
    def emit(event):
        scanner, _ = modules()
        message = event.get("message", str(event)) if isinstance(event, dict) else str(event)
        with lock:
            job = get_job(job_id)
            job["events"] = (job.get("events", []) + [{"time": now(), "message": scanner.redact(message)}])[-500:]
            job["revision"] = job.get("revision", 0) + 1
            store.save(job)
            if isinstance(event, dict) and 'team' in event:
                update(job_id, **{key: event[key] for key in ('team', 'pressure_tests', 'findings', 'coverage', 'cost') if key in event})
    return emit


@app.middleware("http")
async def local_only(request: Request, call_next):
    hostname = urlparse("http://" + request.headers.get("host", "")).hostname
    client = request.client.host if request.client else ""
    if hostname not in {"localhost", "127.0.0.1", "::1", "testserver"} or client not in {"127.0.0.1", "::1", "localhost", "testclient"}:
        return JSONResponse({"detail": "ReGen only accepts local connections"}, status_code=403)
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        if origin and origin not in {"http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:9123", "http://127.0.0.1:9123"}:
            return JSONResponse({"detail": "Untrusted origin"}, status_code=403)
        # JSON-only writes prevent cross-site form submissions when Origin is absent.
        if "application/json" not in request.headers.get("content-type", ""):
            return JSONResponse({"detail": "Use application/json"}, status_code=415)
    return await call_next(request)


@app.on_event("startup")
def recover():
    prune_upload_sessions(DATA)
    for job in store.all():
        if job["status"] in {"scanning", "analyzing", "planning_fix", "fixing", "verifying"}:
            update(job["id"], status="error", error="ReGen stopped while this job was running. Start a new scan to continue safely.")


class ScanInput(BaseModel):
    source: str = Field(min_length=1, max_length=4096)
    budget: float = Field(default=5, gt=0, le=1000)
    ai_review: bool = True
    review_mode: Literal['standard', 'deep', 'ultra', 'team'] = 'standard'
    review_goal: str = Field(default='', max_length=4000)
    run_checks: bool = False
    trust_confirmed: bool = False
    allow_network: bool = False


class CollaborationInput(BaseModel):
    session_id: str = Field(pattern=r'^[a-f0-9-]{36}$')
    author: str = Field(min_length=1, max_length=80)
    kind: Literal['goal', 'question', 'decision'] = 'question'
    text: str = Field(min_length=1, max_length=2000)
    assigned_to: Literal['team', 'agent-1', 'agent-2', 'agent-3', 'agent-4'] = 'team'
    share_with_agents: bool = False


class FixInput(BaseModel):
    finding_ids: list[str] = Field(min_length=1, max_length=500)
    plan_id: str | None = Field(default=None, min_length=24, max_length=24, pattern=r'^[a-f0-9]+$')
    run_checks: bool = False
    trust_confirmed: bool = False
    start_command: str | None = Field(default=None, max_length=2000)


class FixPlanInput(BaseModel):
    finding_ids: list[str] = Field(min_length=1, max_length=500)


class VerifyInput(BaseModel):
    trust_confirmed: bool = False
    start_command: str | None = Field(default=None, max_length=2000)
    runtime_mode: Literal['host', 'docker'] = 'host'
    allow_network: bool = False


class BudgetInput(BaseModel):
    amount: float = Field(gt=0, le=1000)


class ApplyInput(BaseModel):
    confirm: bool = False


class UploadSessionInput(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    total_files: int = Field(gt=0, le=25_000)
    total_bytes: int = Field(ge=0, le=100 * 1024 * 1024)
    skipped_files: int = Field(default=0, ge=0)


def start(job_id, stage, options=None):
    with lock:
        if workers.get(job_id) and workers[job_id].is_alive():
            raise HTTPException(409, "This job already has work in progress")
        cancelled = threading.Event()
        cancellations[job_id] = cancelled
        update(job_id, status=stage, error=None, resume={"stage": stage, "options": options or {}})
        thread = threading.Thread(target=work, args=(job_id, stage, options or {}, cancelled), daemon=True)
        workers[job_id] = thread
        thread.start()
    return public_job(get_job(job_id))


def command_override(value):
    if value is None:
        return None
    args = shlex.split(value, posix=os.name != "nt")
    if not args:
        raise HTTPException(422, "Start command cannot be empty")
    return [arg.strip('"') for arg in args]


def work(job_id, stage, options, cancelled):
    scanner, provider = modules()
    emit = emit_for(job_id)
    job = get_job(job_id)
    budget = provider.Budget(job["budget"], spent=job.get("cost", 0))
    try:
        if stage == "scanning":
            uploaded = job['source'].startswith('upload://')
            source, name = uploaded_project(job['source'], DATA) if uploaded else (job['source'], None)
            prepared = scanner.prepare_project(str(source), DATA / job_id, emit, cancelled)
            if uploaded:
                prepared.update(source=job['source'], name=name)
            update(job_id, snapshot=str(prepared["path"]), source=prepared.get("source", job["source"]), name=prepared["name"], source_fingerprint=prepared.get("source_fingerprint"), languages=prepared.get("languages", []), commands=prepared.get("commands", []), start_command=prepared.get("start_command"))
            scan = scanner.scan_project(Path(prepared["path"]), emit, cancelled)
            scan["findings"] = prepared.get("findings", []) + scan.get("findings", [])
            update(job_id, **scan)
            update(job_id, plan=review.project_plan(Path(prepared['path']), prepared.get('commands', []),
                                                     prepared.get('praxis_memory_available', False)))
            stage = "analyzing"
            update(job_id, status=stage, resume={"stage": stage, "options": options})
        job = get_job(job_id)
        if cancelled.is_set():
            update(job_id, status="cancelled")
            return
        if stage == "analyzing":
            scan = {key: job.get(key) for key in ("findings", "coverage", "languages", "files_scanned")}
            try:
                if options.get('ai_review', True):
                    if options.get('review_mode') == 'team':
                        from .team import analyze_team
                        result = analyze_team(Path(job["snapshot"]), scan, emit, cancelled, budget, goal=options.get('review_goal', ''),
                                              human_context=lambda: get_job(job_id).get('collaboration', {}))
                    else:
                        reviewer = provider.analyze_deep if options.get('review_mode') in {'deep', 'ultra'} else provider.analyze
                        result = reviewer(Path(job["snapshot"]), scan, emit, cancelled, budget)
                else:
                    result = {'coverage': job.get('coverage', []) + [{'name': 'AI contextual review', 'status': 'skipped', 'detail': 'Disabled for this scan. No model request was made.'}]}
                update(job_id, **result)
            except provider.BudgetExceeded:
                raise
            except provider.ProviderError as exc:
                coverage = job.get('coverage', []) + [{'name': 'AI contextual review', 'status': 'skipped', 'detail': str(exc)}]
                update(job_id, coverage=coverage, error='Static scan completed. AI review unavailable: ' + str(exc))
                emit(str(exc))
            if options.get('run_checks') and options.get('trust_confirmed') and not cancelled.is_set():
                update(job_id, status='verifying')
                checks = sandbox.run_checks(Path(job['snapshot']), job['commands'], emit, cancelled,
                                            allow_network=options.get('allow_network', False), start_command=job.get('start_command'),
                                            on_result=lambda items: update(job_id, checks=items, checks_for=job['snapshot']))
                update(job_id, checks=checks, checks_for=job['snapshot'])
        elif stage == "planning_fix":
            selected = [f for f in job["findings"] if f["id"] in options["finding_ids"]]
            result = provider.plan_repair(Path(job["snapshot"]), selected, job['source'], emit, cancelled, budget)
            update(job_id, fix_plan=result)
        elif stage == "fixing":
            selected = [f for f in job["findings"] if f["id"] in options["finding_ids"]]
            plan = job.get('fix_plan') if options.get('plan_id') else None
            result = provider.fix_project(Path(job["snapshot"]), selected, emit, cancelled, budget, plan=plan) if plan else provider.fix_project(Path(job["snapshot"]), selected, emit, cancelled, budget)
            update(job_id, fix=result, fix_path=str(result["path"]))
            if result.get("paused"):
                raise provider.BudgetExceeded("The job budget was reached. Partial changes are retained for review; add budget to retry the fix stage.")
            if result.get("error"):
                raise provider.ProviderError(result["error"])
            if options.get("run_checks") and not cancelled.is_set():
                update(job_id, status="verifying")
                checks = scanner.run_checks(Path(result["path"]), job["commands"], emit, cancelled, start_command=options.get("start_command") or job.get("start_command"))
                update(job_id, checks=checks, checks_for=str(result['path']))
        elif stage == "verifying":
            runner = sandbox.run_checks if options.get('runtime_mode') == 'docker' else scanner.run_checks
            subject = job.get('fix_path') or job['snapshot']
            extra = {'allow_network': options.get('allow_network', False),
                     'on_result': lambda items: update(job_id, checks=items, checks_for=subject)} if runner is sandbox.run_checks else {}
            checks = runner(Path(job.get("fix_path") or job["snapshot"]), job["commands"], emit, cancelled, start_command=options.get("start_command") or job.get("start_command"), **extra)
            update(job_id, checks=checks, checks_for=subject)
        update(job_id, status="cancelled" if cancelled.is_set() else "complete", resume=None)
    except provider.BudgetExceeded as exc:
        if cancelled.is_set():
            update(job_id, status="cancelled", resume=None)
        else:
            update(job_id, status="paused", error=scanner.redact(str(exc)), resume={"stage": stage, "options": options})
            emit("Model budget reached. Add budget to resume this stage.")
    except Exception as exc:
        update(job_id, status="cancelled" if cancelled.is_set() else "error", error=scanner.redact(str(exc)))
        emit("Job stopped: " + str(exc))
    finally:
        update(job_id, cost=budget.spent)


@app.get("/api/health")
def health():
    _, provider = modules()
    return sanitize({**provider.health(), 'docker': sandbox.health()})


class SettingsInput(BaseModel):
    provider: str = Field(pattern='^(openrouter|gemini|nvidia|groq)$')
    model: str = Field(min_length=1, max_length=200, pattern=r'^[A-Za-z0-9_./:-]+$')
    input_price: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    output_price: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)


@app.post('/api/providers/probe')
def probe_provider(body: SettingsInput):
    if not probe_slot.acquire(blocking=False):
        raise HTTPException(409, 'A provider probe is already running')
    try:
        _, provider = modules()
        return sanitize(provider.probe(body.model_dump()))
    finally:
        probe_slot.release()


@app.post('/api/settings')
def save_settings(body: SettingsInput):
    with lock:
        if any(worker.is_alive() for worker in workers.values()):
            raise HTTPException(409, 'Wait for active jobs before changing the model.')
        DATA.mkdir(parents=True, exist_ok=True)
        config_path = DATA / 'provider.json'
        temp_path = config_path.with_suffix('.tmp')
        temp_path.write_text(json.dumps(body.model_dump()), encoding='utf-8')
        temp_path.replace(config_path)
    return health()


@app.post('/api/providers/key')
async def save_provider_key(request: Request):
    # Manually validate a small secret payload: generic errors must never echo
    # credential values through FastAPI's usual validation-input records.
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > 8192:
            raise HTTPException(413, 'Provider credential request is too large.')
        content.extend(chunk)
    try:
        body = json.loads(content)
        if not isinstance(body, dict) or set(body) != {'provider', 'api_key'}:
            raise ValueError
    except (ValueError, UnicodeError):
        raise HTTPException(422, 'Send only a supported provider and its API key.') from None
    if not probe_slot.acquire(blocking=False):
        raise HTTPException(409, 'Wait for the provider test to finish before changing its key.')
    try:
        with lock:
            if any(worker.is_alive() for worker in workers.values()):
                raise HTTPException(409, 'Wait for active jobs before changing a provider key.')
            from .provider_keys import save_key
            try:
                save_key(body['provider'], body['api_key'], DATA)
            except (ValueError, TypeError):
                raise HTTPException(422, 'The key could not be saved. Use a supported provider and 8–4096 characters without spaces. Existing environment keys must be updated in their environment file.') from None
        return health()
    finally:
        probe_slot.release()


@app.get("/api/jobs")
def list_jobs():
    return [sanitize({key: j.get(key) for key in ("id", "source", "name", "status", "created_at", "cost", "budget", "error")}) for j in store.all()]


@app.post("/api/scans")
def scan(body: ScanInput):
    scanner, _ = modules()
    if body.run_checks and not body.trust_confirmed:
        raise HTTPException(403, 'Confirm trust before executing project commands in containers')
    if body.allow_network and not (body.run_checks and body.trust_confirmed):
        raise HTTPException(422, 'Network access requires authorized container execution')
    if scanner.redact(body.source) != body.source:
        raise HTTPException(422, "Do not include credentials in the project input; use existing local Git authentication")
    if body.source.strip().startswith('upload://'):
        try:
            uploaded_project(body.source.strip(), DATA)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
    job_id = uuid.uuid4().hex
    job = dict(id=job_id, source=body.source.strip(), name="Project", status="scanning", findings=[], coverage=[], languages=[], files_scanned=0, commands=[], budget=body.budget, cost=0, events=[], fix=None, fix_plan=None, checks=[], error=None, created_at=now(), revision=0)
    store.save(job)
    return start(job_id, "scanning", body.model_dump(exclude={'source', 'budget'}))


@app.post('/api/uploads')
async def upload(request: Request):
    if not upload_slots.acquire(blocking=False):
        raise HTTPException(429, 'Two folders are uploading; wait for one to finish')
    try:
        return await upload_bounded(request)
    finally:
        upload_slots.release()


async def upload_bounded(request: Request):
    body = await read_bounded_json(request)
    # Disk operations must not block cancellation, health checks, or job streams.
    try:
        return await asyncio.to_thread(save_upload, body, DATA)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


async def read_bounded_json(request: Request):
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_UPLOAD_BODY:
            raise HTTPException(413, 'One upload batch exceeds 32 MiB; retry the folder upload')
        content.extend(chunk)
    try:
        return json.loads(content)
    except (ValueError, UnicodeError, RecursionError):
        raise HTTPException(422, 'Invalid upload JSON') from None


@app.post('/api/uploads/sessions')
async def begin_upload(body: UploadSessionInput):
    try:
        return await asyncio.to_thread(create_upload_session, body.model_dump(), DATA)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.post('/api/uploads/sessions/{token}/files')
async def upload_batch(token: str, request: Request):
    if not upload_slots.acquire(blocking=False):
        raise HTTPException(429, 'Two folders are uploading; wait for one to finish')
    try:
        body = await read_bounded_json(request)
        try:
            return await asyncio.to_thread(append_upload_batch, token, body, DATA)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
    finally:
        upload_slots.release()


@app.post('/api/uploads/sessions/{token}/complete')
async def complete_upload(token: str):
    try:
        return await asyncio.to_thread(finish_upload_session, token, DATA)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.post('/api/uploads/sessions/{token}/cancel')
async def abandon_upload(token: str):
    try:
        return await asyncio.to_thread(cancel_upload_session, token, DATA)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.get("/api/jobs/{job_id}")
def job(job_id: str):
    return public_job(get_job(job_id))


@app.post('/api/jobs/{job_id}/collaboration')
def collaborate(job_id: str, body: CollaborationInput):
    if not body.author.strip() or not body.text.strip():
        raise HTTPException(422, 'Enter your name and a meaningful note.')
    with lock:
        current = get_job(job_id)
        shared = current.get('collaboration', {'revision': 0, 'notes': [], 'participants': []})
        if len(shared['notes']) >= 100:
            raise HTTPException(409, 'This review has reached its 100-note limit. Start a new review.')
        people = shared['participants']
        if not any(person['session_id'] == body.session_id for person in people):
            if len(people) >= 16:
                raise HTTPException(409, 'This local review supports up to 16 contributor sessions.')
            people.append({'session_id': body.session_id, 'name': body.author.strip()})
        shared['notes'].append({'id': uuid.uuid4().hex, 'created_at': now(), **body.model_dump()})
        shared['revision'] += 1
        return public_job(update(job_id, collaboration=shared))


@app.post('/api/jobs/{job_id}/team-review')
def review_shared_notes(job_id: str):
    current = get_job(job_id)
    if current['status'] not in {'complete', 'error', 'cancelled'} or not current.get('snapshot') or current.get('fix_path'):
        raise HTTPException(409, 'Finish this review first. Proposed changes require their own fresh review.')
    return start(job_id, 'analyzing', {'ai_review': True, 'review_mode': 'team', 'run_checks': False,
                                     'review_goal': current.get('team', {}).get('goal', '')})


@app.get("/api/jobs/{job_id}/events")
async def events(job_id: str, request: Request):
    get_job(job_id)
    async def stream():
        revision = -1
        while not await request.is_disconnected():
            current = get_job(job_id)
            if current.get("revision", 0) != revision:
                revision = current.get("revision", 0)
                yield "data: " + json.dumps(public_job(current)) + "\n\n"
            else:
                yield ": heartbeat\n\n"
            await asyncio.sleep(1)
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/jobs/{job_id}/fix")
def fix(job_id: str, body: FixInput):
    current = get_job(job_id)
    if current["status"] not in {"complete", "error"} or not current.get("snapshot"):
        raise HTTPException(409, "Finish the scan before starting fixes")
    known = {f["id"] for f in current["findings"]}
    if not set(body.finding_ids) <= known:
        raise HTTPException(422, "Unknown finding ID")
    if any(not f.get("fixable", True) for f in current["findings"] if f["id"] in body.finding_ids):
        raise HTTPException(422, "Some selected issues require manual action and cannot be automatically fixed")
    if body.plan_id:
        plan = current.get('fix_plan') or {}
        if plan.get('id') != body.plan_id or set(plan.get('finding_ids', [])) != set(body.finding_ids):
            raise HTTPException(409, 'The repair plan does not match these findings. Draft a new plan.')
    if body.run_checks and not body.trust_confirmed:
        raise HTTPException(403, "Confirm trust before executing project commands")
    return start(job_id, "fixing", {**body.model_dump(), "start_command": command_override(body.start_command)})


@app.post("/api/jobs/{job_id}/fix-plan")
def fix_plan(job_id: str, body: FixPlanInput):
    current = get_job(job_id)
    if current["status"] not in {"complete", "error"} or not current.get("snapshot"):
        raise HTTPException(409, "Finish the scan before planning fixes")
    known = {f["id"] for f in current["findings"]}
    if not set(body.finding_ids) <= known:
        raise HTTPException(422, "Unknown finding ID")
    if any(not f.get("fixable", True) for f in current["findings"] if f["id"] in body.finding_ids):
        raise HTTPException(422, "Some selected issues require manual action and cannot be automatically fixed")
    return start(job_id, "planning_fix", body.model_dump())


@app.post("/api/jobs/{job_id}/verify")
def verify(job_id: str, body: VerifyInput):
    current = get_job(job_id)
    if not current.get("snapshot") or current["status"] != "complete":
        raise HTTPException(409, "Finish the current work before verification")
    if not body.trust_confirmed:
        raise HTTPException(403, "Confirm trust before executing project commands")
    return start(job_id, "verifying", {**body.model_dump(), "start_command": command_override(body.start_command)})


@app.post("/api/jobs/{job_id}/budget")
def extend_budget(job_id: str, body: BudgetInput):
    with lock:
        current = get_job(job_id)
        if current["status"] != "paused":
            raise HTTPException(409, "Only a paused job can resume with extra budget")
        if workers.get(job_id) and workers[job_id].is_alive():
            raise HTTPException(409, "The previous stage is finishing; retry in a moment")
        resume = current.get("resume")
        if not resume:
            raise HTTPException(409, "This job cannot be resumed")
        update(job_id, budget=current["budget"] + body.amount)
        return start(job_id, resume["stage"], resume.get("options", {}))


@app.post("/api/jobs/{job_id}/cancel")
def cancel(job_id: str):
    get_job(job_id)
    if job_id in cancellations:
        cancellations[job_id].set()
    return sanitize(update(job_id, status="cancelled", resume=None))


def export_files(path: Path):
    scanner, _ = modules()
    for file in scanner.safe_files(path):
        file = Path(file)
        if not file.is_absolute():
            file = path / file
        relative = file.relative_to(path)
        if file.is_symlink() or any((part.startswith(".env") and not scanner._env_template(Path(part))) or part in scanner.EXCLUDED for part in relative.parts):
            continue
        if not file.resolve().is_relative_to(path.resolve()):
            continue
        yield file, relative


@app.get("/api/jobs/{job_id}/export")
def export(job_id: str, format: str = "patch"):
    current = get_job(job_id)
    if not current.get("fix_path") or current["status"] not in {"complete", "paused", "error", "cancelled"}:
        raise HTTPException(409, "No completed fix is available")
    if format == "patch":
        data = sanitize(current["fix"].get("diff", ""))
        return Response(data, media_type="text/plain", headers={"Content-Disposition": 'attachment; filename="regen.patch"'})
    if format != "zip":
        raise HTTPException(422, "Choose patch or zip")
    scanner, _ = modules()
    content = io.BytesIO()
    with zipfile.ZipFile(content, "w", zipfile.ZIP_DEFLATED) as archive:
        for file, relative in export_files(Path(current["fix_path"])):
            raw = file.read_bytes()
            if file.suffix.lower() == ".pdf":
                if raw.startswith(b"%PDF-"):
                    archive.writestr(relative.as_posix(), raw)
                continue
            try:
                raw = scanner.redact(raw.decode("utf-8"), limit=None).encode("utf-8")
            except UnicodeDecodeError:
                if file.suffix.lower() not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".avif", ".woff", ".woff2", ".ttf", ".otf"}:
                    continue
            archive.writestr(relative.as_posix(), raw)
    return Response(content.getvalue(), media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="regen-fixed.zip"'})


@app.post("/api/jobs/{job_id}/apply")
def apply(job_id: str, body: ApplyInput):
    with lock:
        return apply_locked(job_id, body)


def apply_locked(job_id: str, body: ApplyInput):
    if not body.confirm:
        raise HTTPException(403, "Explicit confirmation is required to apply changes")
    current = get_job(job_id)
    if current["status"] != "complete" or not current.get("fix_path"):
        raise HTTPException(409, "Complete the fix before applying changes")
    source = current["source"]
    if source.startswith(("https://", "http://", "git@", "ssh://", "upload://")):
        raise HTTPException(422, "Download the patch or project copy to apply changes to the original GitHub or uploaded folder")
    scanner, _ = modules()
    source_path = Path(source).expanduser().resolve()
    if not source_path.is_dir() or scanner.fingerprint(source_path) != current.get("source_fingerprint"):
        raise HTTPException(409, "Source files changed after scanning. Rescan before applying the fix.")
    before = {str(rel): file for file, rel in export_files(Path(current["snapshot"]))}
    after = {str(rel): file for file, rel in export_files(Path(current["fix_path"]))}
    changes = []
    # Stage all mutations and reject symlink traversal before any source write.
    for relative in sorted(before.keys() | after.keys()):
        old = before[relative].read_bytes() if relative in before else None
        new = after[relative].read_bytes() if relative in after else None
        if old == new:
            continue
        target = source_path / relative
        if not target.resolve().is_relative_to(source_path) or any(parent.is_symlink() for parent in [target, *target.parents] if parent != source_path):
            raise HTTPException(409, "Unsafe destination path; export a patch instead")
        actual = target.read_bytes() if target.exists() and target.is_file() else None
        if actual != old or (target.exists() and not target.is_file()):
            raise HTTPException(409, "A destination differs from the scanned snapshot. Rescan before applying changes.")
        changes.append((target, new))
    backup = DATA / job_id / "apply-backup"
    backup.mkdir(parents=True, exist_ok=True)
    originals = []
    try:
        for target, data in changes:
            old = target.read_bytes() if target.exists() else None
            originals.append((target, old))
            if old is not None:
                saved = backup / target.relative_to(source_path)
                saved.parent.mkdir(parents=True, exist_ok=True)
                saved.write_bytes(old)
            if data is None:
                target.unlink(missing_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
    except Exception:
        for target, old in reversed(originals):
            if old is None:
                target.unlink(missing_ok=True)
            else:
                target.write_bytes(old)
        raise HTTPException(500, "Apply failed; original file contents were restored")
    emit_for(job_id)(f"Applied {len(changes)} reviewed file changes. Original contents retained in the local job backup.")
    update(job_id, applied=True)
    return {"applied": True, "files_changed": len(changes)}
