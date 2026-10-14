"""Local-only ReGen API, durable jobs, and isolated repair workflow."""
from __future__ import annotations

import asyncio
import io
import json
import os
import shlex
import secrets
import threading
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .store import Store
from .intake import (MAX_UPLOAD_BODY, append_upload_batch, cancel_upload_session,
                     create_upload_session, finish_upload_session, save_upload,
                     prune_upload_sessions, uploaded_project)
from . import review, sandbox
from .paths import runtime_paths
from .journey_schema import JourneyInput
from .evidence import EvidenceInput
from .projects import ProjectError, ProjectRegistry
from .workspace import WorkspacePage, page as workspace_page
from .coordination import Coordination

ROOT = Path(__file__).resolve().parents[2]
DATA, _ = runtime_paths(ROOT)
store = Store(DATA / "jobs.sqlite3")
lock = threading.RLock()
workers: dict[str, threading.Thread] = {}
upload_slots = threading.BoundedSemaphore(2)
probe_slot = threading.BoundedSemaphore(1)
evidence_slot = threading.BoundedSemaphore(1)
cancellations: dict[str, threading.Event] = {}
app = FastAPI(title="PRAXIS Workbench", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"], allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


@app.exception_handler(ProjectError)
async def project_error(request: Request, exc: ProjectError):
    return JSONResponse({'detail': str(exc)}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def safe_validation_error(request: Request, exc: RequestValidationError):
    # Pydantic's default response echoes submitted values, including transient
    # form input. Return actionable field errors without reflecting that data.
    return JSONResponse({'detail': [{'loc': error['loc'], 'msg': error['msg'],
                                    'type': error['type']} for error in exc.errors()]}, status_code=422)


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
    result = {**job}
    if job.get('project_id'):
        registry = ProjectRegistry(store)
        result['evidence_freshness'] = registry.job_freshness(job)
        result['project'] = registry.get(job['project_id'])
        result['coordination'] = Coordination(store, registry=registry).get(job['project_id'], job_id=job['id'])
    result['assessment'] = review.assessment(result)
    return sanitize(result)


def attach_current_project(job_id):
    current = get_job(job_id)
    if current.get('project_id') and current.get('snapshot'):
        registry = ProjectRegistry(store)
        project = registry.get(current['project_id'])
        project = registry.attach_job(project['id'], job_id, expected_revision=project['revision'])
        update(job_id, project_snapshot_id=project['latest_snapshot_id'])


def shared_project_context(job_id):
    current = get_job(job_id)
    stored = current.get('collaboration', {})
    discussion = {'revision': stored.get('revision', 0),
                  'notes': [note for note in stored.get('notes', []) if note.get('share_with_agents')]} if stored else {}
    if not current.get('project_id'):
        return discussion
    board = Coordination(store)
    notes = list(discussion.get('notes', []))
    revision = discussion.get('revision', 0)
    for actor in ('agent-1', 'agent-2', 'agent-3', 'agent-4'):
        context = board.agent_context(current['project_id'], actor, job_id=job_id)
        notes.extend(context['notes']); revision += context['revision']
    if not notes and not revision:
        return discussion
    return {**discussion, 'revision': revision, 'notes': notes}


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
    service_token = os.getenv('PRAXIS_REVIEW_SERVICE_TOKEN')
    if service_token and request.url.path.startswith('/api'):
        provided = request.headers.get('authorization', '')
        if not secrets.compare_digest(provided.encode(), ('Bearer ' + service_token).encode()):
            return JSONResponse({'detail': 'Connect through the authorized PRAXIS local service.'}, status_code=401)
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        origins = {"http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:9123", "http://127.0.0.1:9123"}
        if service_token:
            origins.add(str(request.base_url).rstrip('/'))
        if origin and origin not in origins:
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
    model_config = ConfigDict(extra='forbid')

    source: str = Field(min_length=1, max_length=4096)
    budget: float = Field(default=5, gt=0, le=1000)
    ai_review: bool = False
    review_mode: Literal['standard', 'deep', 'ultra', 'team'] = 'standard'
    review_goal: str = Field(default='', max_length=4000)
    run_checks: bool = False
    runtime_mode: Literal['host', 'docker'] = 'docker'
    trust_confirmed: bool = False
    allow_network: bool = False


class CollaborationInput(BaseModel):
    session_id: str = Field(pattern=r'^[a-f0-9-]{36}$')
    author: str = Field(min_length=1, max_length=80)
    kind: Literal['goal', 'question', 'decision'] = 'question'
    text: str = Field(min_length=1, max_length=2000)
    assigned_to: Literal['team', 'agent-1', 'agent-2', 'agent-3', 'agent-4'] = 'team'
    share_with_agents: bool = False


class RevisionInput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    expected_revision: int = Field(ge=0)
    idempotency_key: str | None = Field(default=None, pattern=r'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')


class AssignmentInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['human', 'agent']
    id: str = Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')


class TaskInput(RevisionInput):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default='', max_length=4000)
    depends_on: list[str] = Field(default_factory=list, max_length=20)
    assigned_to: AssignmentInput | None = None
    share_with_agents: bool = False


class TaskUpdateInput(RevisionInput):
    changes: dict = Field(min_length=1, max_length=7)


class AgentPlanInput(RevisionInput):
    tool: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,64}$')
    trust_confirmed: bool = False
    external_spend_confirmed: bool = False
    timeout_seconds: int = Field(default=120, ge=15, le=300)


class DecisionInput(RevisionInput):
    text: str = Field(min_length=1, max_length=2000)
    kind: Literal['goal', 'question', 'decision'] = 'decision'
    share_with_agents: bool = False


class HandoffInput(RevisionInput):
    task_id: str = Field(min_length=1, max_length=128)
    recipient: AssignmentInput
    text: str = Field(min_length=1, max_length=4000)
    share_with_agents: bool = False


class RelinkInput(RevisionInput):
    source: str = Field(min_length=1, max_length=4096)
    confirmed: bool = False


class LinkProjectInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    confirmed: bool = False


class FixInput(BaseModel):
    finding_ids: list[str] = Field(min_length=1, max_length=500)
    plan_id: str | None = Field(default=None, min_length=24, max_length=24, pattern=r'^[a-f0-9]+$')
    run_checks: bool = False
    runtime_mode: Literal['host', 'docker'] = 'host'
    trust_confirmed: bool = False
    start_command: str | None = Field(default=None, max_length=2000)


class FixPlanInput(BaseModel):
    finding_ids: list[str] = Field(min_length=1, max_length=500)


class VerifyInput(BaseModel):
    trust_confirmed: bool = False
    start_command: str | None = Field(default=None, max_length=2000)
    runtime_mode: Literal['host', 'docker'] = 'host'
    allow_network: bool = False
    journey: JourneyInput | None = None


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
        update(job_id, status=stage, error=None, resume=None if (options or {}).get('agent_task_id') else {"stage": stage, "options": durable_options(options or {})})
        thread = threading.Thread(target=work, args=(job_id, stage, options or {}, cancelled), daemon=True)
        workers[job_id] = thread
        thread.start()
    return public_job(get_job(job_id))


def durable_options(options):
    """Form values exist only in worker memory, never in resume/history state."""
    result = {key: value for key, value in options.items() if key != 'agent_lease_token'}
    if result.get('journey'):
        result['journey'] = {**result['journey']}
        result['journey']['steps'] = [{key: value for key, value in step.items() if key != 'value'}
                                     for step in result['journey'].get('steps', [])]
        result['journey']['state_assertions'] = [{key: value for key, value in check.items() if key != 'expected'}
                                                for check in result['journey'].get('state_assertions', [])]
    return result


def command_override(value):
    if value is None:
        return None
    args = shlex.split(value, posix=os.name != "nt")
    if not args:
        raise HTTPException(422, "Start command cannot be empty")
    return [arg.strip('"') for arg in args]


def run_project_checks(subject, commands, emit, cancelled, *, runtime_mode='host',
                       allow_network=False, start_command=None, journey_spec=None, on_result=None):
    """Dispatch only the explicitly chosen runtime; never attempt a fallback.

    The network option controls Docker networking only. Trusted host commands
    can access host files and networking regardless of this option.
    """
    scanner, _ = modules()
    if runtime_mode not in {'host', 'docker'}:
        raise ValueError('Unsupported project execution environment')
    if journey_spec and runtime_mode != 'host':
        raise ValueError('Task-specific browser journeys require authorized local execution')
    runner = sandbox.run_checks if runtime_mode == 'docker' else scanner.run_checks
    options = {'start_command': start_command, 'on_result': on_result}
    if runtime_mode == 'docker':
        options['allow_network'] = allow_network
    else:
        options['journey_spec'] = journey_spec
    return runner(Path(subject), commands, emit, cancelled, **options)


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
            scan = scanner.scan_project(Path(prepared["path"]), emit, cancelled,
                                        source_scope=prepared.get('source_scope'))
            scan["findings"] = prepared.get("findings", []) + scan.get("findings", [])
            update(job_id, **scan)
            update(job_id, plan=review.project_plan(Path(prepared['path']), prepared.get('commands', []),
                                                     prepared.get('praxis_memory_available', False)))
            attach_current_project(job_id)
            stage = "analyzing"
            update(job_id, status=stage, resume={"stage": stage, "options": durable_options(options)})
        job = get_job(job_id)
        if cancelled.is_set():
            update(job_id, status="cancelled")
            return
        if stage == "analyzing" and options.get('agent_task_id'):
            from .agent_work import run_plan
            board = Coordination(store)
            actor_id = 'cli-' + options['agent_tool']
            context = board.agent_context(job['project_id'], actor_id, job_id=job_id)
            task = next(item for item in context['tasks'] if item['id'] == options['agent_task_id'])
            if not options.get('agent_lease_token'):
                raise ValueError('The agent plan has no active execution lease. Start it again explicitly from the current assignment.')
            try:
                result = run_plan(job, tool=options['agent_tool'], task=task, context=context, data=DATA,
                                  cancelled=cancelled, timeout_seconds=options['timeout_seconds'], emit=emit)
            except Exception:
                result = {'status': 'failed', 'tool': options['agent_tool'], 'mode': 'plan', 'report': '',
                          'detail': 'The coding-agent plan could not finish. No completion was accepted.',
                          'verification': 'not_evaluated', 'billing': 'agent_account_not_capped_by_review_budget'}
            if cancelled.is_set():
                result.update(status='cancelled', detail='The coding-agent plan was cancelled. No completion was accepted.')
            result.update(task_id=task['id'], ended_at=now())
            update(job_id, agent_run=result)
            # A revoked lease, changed assignment or stale snapshot must never
            # be overwritten by an agent which completed late.
            for attempt in range(3):
                scoped = board.get(job['project_id'], job_id=job_id)
                try:
                    board.update_task(job['project_id'], task['id'], expected_revision=scoped['revision'],
                        actor_kind='agent', actor_id=actor_id, lease_token=options['agent_lease_token'],
                        changes={'state': 'completed' if result['status'] == 'completed' else 'blocked',
                                 'completion_report': (result['report'] or result['detail'])[:4000]})
                    break
                except ProjectError as exc:
                    if exc.status_code != 409 or attempt == 2:
                        update(job_id, agent_run={**result, 'status': 'failed',
                            'detail': 'The task changed or its execution lease was revoked. Agent completion was not accepted.'})
                        raise
            emit(result['detail'])
        elif stage == "analyzing":
            scan = {key: job.get(key) for key in ("findings", "coverage", "languages", "files_scanned", "review_goal")}
            try:
                if options.get('ai_review', False):
                    if options.get('review_mode') == 'team':
                        from .team import analyze_team
                        result = analyze_team(Path(job["snapshot"]), scan, emit, cancelled, budget, goal=job.get('review_goal') or options.get('review_goal', ''),
                                              human_context=lambda: shared_project_context(job_id))
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
                checks = run_project_checks(job['snapshot'], job['commands'], emit, cancelled,
                                            runtime_mode=options.get('runtime_mode', 'docker'),
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
                checks = run_project_checks(result['path'], job['commands'], emit, cancelled,
                                            runtime_mode=options.get('runtime_mode', 'host'),
                                            start_command=options.get('start_command') or job.get('start_command'),
                                            on_result=lambda items: update(job_id, checks=items, checks_for=str(result['path'])))
                update(job_id, checks=checks, checks_for=str(result['path']))
        elif stage == "verifying":
            subject = job.get('fix_path') or job['snapshot']
            checks = run_project_checks(subject, job['commands'], emit, cancelled,
                                        runtime_mode=options.get('runtime_mode', 'host'),
                                        allow_network=options.get('allow_network', False),
                                        start_command=options.get('start_command') or job.get('start_command'),
                                        journey_spec=options.get('journey'),
                                        on_result=lambda items: update(job_id, checks=items, checks_for=subject))
            update(job_id, checks=checks, checks_for=subject)
        if not cancelled.is_set():
            attach_current_project(job_id)
        update(job_id, status="cancelled" if cancelled.is_set() else "complete", resume=None)
    except provider.BudgetExceeded as exc:
        if cancelled.is_set():
            update(job_id, status="cancelled", resume=None)
        else:
            update(job_id, status="paused", error=scanner.redact(str(exc)), resume={"stage": stage, "options": durable_options(options)})
            emit("Model budget reached. Add budget to resume this stage.")
    except Exception as exc:
        update(job_id, status="cancelled" if cancelled.is_set() else "error", error=scanner.redact(str(exc)))
        emit("Job stopped: " + str(exc))
    finally:
        update(job_id, cost=budget.spent)


@app.get("/api/health")
def health():
    _, provider = modules()
    result = {**provider.health(), 'docker': sandbox.health()}
    if os.getenv('PRAXIS_REVIEW_SERVICE_TOKEN'):
        result['service_instance'] = os.getenv('PRAXIS_REVIEW_SERVICE_INSTANCE')
    return sanitize(result)


@app.get('/api/evidence/sources')
def evidence_sources():
    modules()  # Load server-side environment without exposing its values.
    from .evidence import availability
    return sanitize(availability())


@app.post('/api/jobs/{job_id}/evidence')
def external_evidence(job_id: str, body: EvidenceInput):
    if not body.authorized:
        raise HTTPException(403, 'Authorize the selected vendor request before gathering external evidence.')
    current = get_job(job_id)
    if current['status'] != 'complete' or not current.get('snapshot'):
        raise HTTPException(409, 'Finish the current review before gathering external evidence.')
    if len(current.get('external_evidence', [])) >= 50:
        raise HTTPException(409, 'This review has reached its external observation limit. Start a new review.')
    if not evidence_slot.acquire(blocking=False):
        raise HTTPException(409, 'An external evidence request is already running.')
    try:
        scanner, _ = modules()
        from .evidence import collect
        subject = current.get('fix_path') or current['snapshot']
        snapshot_ref = scanner.fingerprint(Path(subject))
        result = collect(body, snapshot_ref=snapshot_ref)
        # A slow vendor call must never attach its observation to a newer copy.
        with lock:
            latest = get_job(job_id)
            if (latest.get('fix_path') or latest['snapshot']) != subject or scanner.fingerprint(Path(subject)) != snapshot_ref:
                raise HTTPException(409, 'The review copy changed during the request. Gather evidence again.')
            return public_job(update(job_id, external_evidence=[*latest.get('external_evidence', []), result]))
    finally:
        evidence_slot.release()


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
    return [sanitize({key: j.get(key) for key in ("id", "source", "name", "status", "created_at", "cost", "budget", "error", "project_id")}) for j in store.all()]


@app.get('/api/projects')
def projects():
    return sanitize(ProjectRegistry(store).all())


@app.get('/api/workspace', response_model=WorkspacePage)
def workspace(offset: int = Query(0, ge=0), limit: int = Query(30, ge=1, le=100),
              quick: bool = Query(False), scope: Literal['all', 'projects'] = Query('all')):
    return workspace_page(store, instance_id=os.getenv('PRAXIS_REVIEW_SERVICE_INSTANCE', 'local-development'),
                          offset=offset, limit=limit, quick=quick, scope=scope)


@app.get('/api/projects/{project_id}/status')
def project_status(project_id: str, previous_revision: int | None = None):
    return ProjectRegistry(store).status(project_id, instance_id=os.getenv('PRAXIS_REVIEW_SERVICE_INSTANCE', 'local-development'), previous_revision=previous_revision)


@app.post('/api/projects/{project_id}/relink')
def relink_project(project_id: str, body: RelinkInput):
    scanner, _ = modules()
    if scanner.redact(body.source) != body.source:
        raise HTTPException(422, 'Do not include credentials in a project path.')
    return ProjectRegistry(store).relink(project_id, body.source, expected_revision=body.expected_revision, confirmed=body.confirmed, actor_kind='human')


@app.post('/api/jobs/{job_id}/project')
def link_existing_project(job_id: str, body: LinkProjectInput):
    if not body.confirmed:
        raise HTTPException(403, 'Confirm linking this existing review to a local project identity.')
    current = get_job(job_id)
    if not current.get('snapshot') or current['status'] not in {'complete', 'error', 'cancelled'}:
        raise HTTPException(409, 'Finish this review before linking it.')
    registry = ProjectRegistry(store)
    project = registry.register(current['source'])
    # Attach validates source/copy association before the job gains a project ID.
    project = registry.attach_job(project['id'], job_id, expected_revision=project['revision'])
    return public_job(update(job_id, project_id=project['id'], project_snapshot_id=project['latest_snapshot_id']))


@app.post('/api/jobs/{job_id}/project-relink')
def relink_review_project(job_id: str, body: RelinkInput):
    current, _ = project_work(job_id)
    ProjectRegistry(store).relink(current['project_id'], body.source, expected_revision=body.expected_revision,
                                 confirmed=body.confirmed, actor_kind='human')
    return public_job(update(job_id, project_link_status='relinked_new_review_required'))


def project_work(job_id):
    current = get_job(job_id)
    if not current.get('project_id'):
        raise HTTPException(409, 'Link this review to a project before coordinating work.')
    return current, Coordination(store)


@app.get('/api/agents')
def installed_coding_agents():
    from .agent_work import available
    return sanitize(available())


@app.post('/api/jobs/{job_id}/work/tasks/{task_id}/run-agent')
def run_assigned_agent(job_id: str, task_id: str, body: AgentPlanInput):
    from .agent_work import available
    if not body.trust_confirmed or not body.external_spend_confirmed:
        raise HTTPException(403, 'Confirm local coding-agent access and charges to its own account. The review budget cannot cap this agent.')
    with lock:
        current, board = project_work(job_id)
        if current['status'] not in {'complete', 'error', 'cancelled'} or (workers.get(job_id) and workers[job_id].is_alive()):
            raise HTTPException(409, 'Finish the active work before starting a coding-agent plan.')
        freshness = ProjectRegistry(store).job_freshness(current)
        if freshness['freshness'] != 'current' or freshness['source_freshness'] in {'stale', 'unavailable'}:
            raise HTTPException(409, 'The project changed since this review. Review its current source before running an assignment.')
        scoped = board.get(current['project_id'], job_id=job_id)
        task = next((item for item in scoped['tasks'] if item['id'] == task_id), None)
        if not task:
            raise HTTPException(404, 'Task not found in this review.')
        if task.get('assigned_to') != {'kind': 'agent', 'id': 'cli-' + body.tool}:
            raise HTTPException(403, 'Assign this task to the selected installed coding agent first.')
        if not any(agent['name'] == body.tool and agent['installed'] for agent in available()['agents']):
            raise HTTPException(409, 'This coding agent is not installed or its adapter is unavailable. Check the local service PATH.')
        claimed = board.claim_task(current['project_id'], task_id, expected_revision=body.expected_revision,
                                   actor_id='cli-' + body.tool, lease_seconds=900)
        update(job_id, agent_run={'status': 'running', 'tool': body.tool, 'task_id': task_id, 'mode': 'plan',
                                 'verification': 'not_evaluated', 'started_at': now(), 'report': '',
                                 'billing': 'agent_account_not_capped_by_review_budget'})
        return start(job_id, 'analyzing', {'agent_task_id': task_id, 'agent_tool': body.tool,
                     'agent_lease_token': claimed['lease_token'], 'timeout_seconds': body.timeout_seconds})


def work_changed(job_id, board):
    return public_job(update(job_id, coordination_revision=board['revision']))


@app.post('/api/jobs/{job_id}/work/tasks')
def create_work_task(job_id: str, body: TaskInput):
    current, board = project_work(job_id)
    return work_changed(job_id, board.create_task(current['project_id'], job_id=job_id,
                        actor_kind='human', actor_id='local-user', **body.model_dump()))


@app.post('/api/jobs/{job_id}/work/tasks/{task_id}')
def update_work_task(job_id: str, task_id: str, body: TaskUpdateInput):
    current, board = project_work(job_id)
    scoped = board.get(current['project_id'], job_id=job_id)
    if not any(task['id'] == task_id for task in scoped['tasks']):
        raise HTTPException(404, 'Task not found in this review.')
    return work_changed(job_id, board.update_task(current['project_id'], task_id,
                        actor_kind='human', actor_id='local-user', **body.model_dump()))


@app.post('/api/jobs/{job_id}/work/decisions')
def record_work_decision(job_id: str, body: DecisionInput):
    current, board = project_work(job_id)
    return work_changed(job_id, board.record_decision(current['project_id'], job_id=job_id,
                        actor_kind='human', actor_id='local-user', **body.model_dump()))


@app.post('/api/jobs/{job_id}/work/handoffs')
def record_work_handoff(job_id: str, body: HandoffInput):
    current, board = project_work(job_id)
    scoped = board.get(current['project_id'], job_id=job_id)
    if not any(task['id'] == body.task_id for task in scoped['tasks']):
        raise HTTPException(404, 'Task not found in this review.')
    return work_changed(job_id, board.handoff(current['project_id'], actor_kind='human',
                        actor_id='local-user', **body.model_dump()))


@app.post("/api/scans")
def scan(body: ScanInput):
    scanner, _ = modules()
    if body.run_checks and not body.trust_confirmed:
        raise HTTPException(403, 'Confirm trust before executing project commands in the selected environment')
    if body.allow_network and not (body.run_checks and body.trust_confirmed):
        raise HTTPException(422, 'The network option requires authorized project execution')
    if scanner.redact(body.source) != body.source:
        raise HTTPException(422, "Do not include credentials in the project input; use existing local Git authentication")
    if body.source.strip().startswith('upload://'):
        try:
            uploaded_project(body.source.strip(), DATA)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
    job_id = uuid.uuid4().hex
    job = dict(id=job_id, source=body.source.strip(), review_goal=scanner.redact(body.review_goal, limit=None), name="Project", status="scanning", findings=[], coverage=[], languages=[], files_scanned=0, commands=[], budget=body.budget, cost=0, events=[], fix=None, fix_plan=None, checks=[], error=None, created_at=now(), revision=0)
    # New reviews gain identity. Historical reviews are linked only on request;
    # existing source/receipt records are not migrated or reinterpreted.
    try:
        project = ProjectRegistry(store).register(body.source.strip())
        job['project_id'] = project['id']
    except ProjectError:
        # Keep legacy intake formats usable, with the missing identity explicit.
        job['project_link_status'] = 'unavailable_for_source_format'
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
                                     'review_goal': current.get('review_goal') or current.get('team', {}).get('goal', '')})


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
    if body.journey and body.runtime_mode != 'host':
        raise HTTPException(422, 'Task-specific browser journeys currently require authorized local execution')
    if body.journey and not (body.start_command or current.get('start_command')):
        raise HTTPException(422, 'A browser start command is required for the journey')
    options = body.model_dump(exclude_none=True)
    if body.journey:
        options['journey'] = body.journey.model_dump(exclude_unset=True)
    return start(job_id, "verifying", {**options, "start_command": command_override(body.start_command)})


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
