"""Bounded, evidence-aware home projection for the local project workspace.

This is presentation data only. It never links legacy jobs, changes a review,
or turns model prose and a completed worker into proof of working behavior.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict

from .projects import ID_PATTERN, ProjectRegistry
from .scanner import redact


class ProjectItem(BaseModel):
    model_config = ConfigDict(extra='forbid')

    kind: Literal['project'] = 'project'
    id: str
    project_revision: int
    name: str
    source_kind: Literal['local', 'github', 'upload']
    updated_at: str
    activity_at: str
    latest_job_id: str | None
    open_job_id: str | None
    phase: str
    freshness: str
    source_freshness: str
    readiness: str
    implementation: str
    assessment: str
    findings_count: int
    checks_passed: int
    checks_failed: int


class LegacyReviewItem(BaseModel):
    model_config = ConfigDict(extra='forbid')

    kind: Literal['legacy_review'] = 'legacy_review'
    id: str
    created_at: str | None
    phase: str


class WorkspacePage(BaseModel):
    model_config = ConfigDict(extra='forbid')

    schema_version: Literal[1] = 1
    items: list[ProjectItem | LegacyReviewItem]
    total: int
    next_offset: int | None


def _jobs(store):
    """Read local records without letting one damaged historical row hide all work."""
    with store.lock, store.connect() as db:
        rows = db.execute('SELECT id,data FROM jobs').fetchall()
    jobs = {}
    for job_id, payload in rows:
        if not isinstance(job_id, str) or not ID_PATTERN.fullmatch(job_id) or redact(job_id, limit=None) != job_id:
            continue
        try:
            job = json.loads(payload)
        except (TypeError, ValueError):
            job = None
        jobs[job_id] = job if isinstance(job, dict) else None
    return jobs


def _timestamp(value):
    return value if isinstance(value, str) and len(value) <= 64 else None


def _time_key(value):
    try:
        timestamp = datetime.fromisoformat((value or '').replace('Z', '+00:00'))
        return timestamp.replace(tzinfo=timezone.utc).timestamp() if timestamp.tzinfo is None else timestamp.timestamp()
    except (TypeError, ValueError, OverflowError):
        return float('-inf')


def _later(first, second):
    return second if _time_key(second) > _time_key(first) else first


def _safe_phase(job):
    phase = job.get('status') if isinstance(job, dict) else None
    return phase if phase in {'queued', 'scanning', 'analyzing', 'planning_fix', 'fixing',
                              'verifying', 'paused', 'complete', 'error', 'cancelled'} else 'unavailable'


def page(store, *, instance_id, offset=0, limit=30, quick=False, scope='all'):
    """Page projects or the compatible mixed feed without hashing in quick mode."""
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
        raise ValueError('offset must be nonnegative')
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 100:
        raise ValueError('limit must be between 1 and 100')
    if scope not in {'all', 'projects'}:
        raise ValueError('scope must be all or projects')
    registry = ProjectRegistry(store)
    projects = registry.all()
    jobs = _jobs(store)
    project_ids = {item['id'] for item in projects}
    jobs_by_project = {}
    for job_id, job in jobs.items():
        if isinstance(job, dict) and job.get('project_id') in project_ids:
            jobs_by_project.setdefault(job['project_id'], []).append((job_id, job))
    for linked in jobs_by_project.values():
        linked.sort(key=lambda item: _time_key(_timestamp(item[1].get('created_at'))), reverse=True)
    linked_ids = {item['latest_job_id'] for item in projects if item.get('latest_job_id')}
    # A project can have earlier jobs: their explicit project link also keeps
    # them out of the legacy lane. No history is linked as a side effect here.
    linked_ids.update(job_id for job_id, job in jobs.items()
                      if isinstance(job, dict) and job.get('project_id') in project_ids)
    entries = [(_time_key(_later(project.get('updated_at'),
                                 _timestamp(jobs_by_project[project['id']][0][1].get('created_at'))
                                 if jobs_by_project.get(project['id']) else None)), 'project', project) for project in projects]
    if scope == 'all':
        entries.extend((_time_key(_timestamp(job.get('created_at'))) if isinstance(job, dict) else float('-inf'),
                        'legacy_review', job_id)
                       for job_id, job in jobs.items() if job_id not in linked_ids)
    entries.sort(key=lambda item: item[0], reverse=True)
    selected = entries[offset:offset + limit]
    items = []
    for _, kind, value in selected:
        if kind == 'legacy_review':
            job = jobs[value]
            items.append(LegacyReviewItem(id=value, created_at=_timestamp(job.get('created_at')) if job else None,
                                          phase=_safe_phase(job)))
            continue
        project = value
        newest = jobs_by_project.get(project['id'], [])
        newest_id, newest_job = newest[0] if newest else (None, None)
        recorded_id = project.get('latest_job_id')
        recorded_job = jobs.get(recorded_id)
        unbound_newer = bool(newest_id and newest_id != recorded_id and
                             _time_key(_timestamp(newest_job.get('created_at'))) >
                             _time_key(_timestamp(recorded_job.get('created_at')) if isinstance(recorded_job, dict) else None))
        open_job_id = newest_id if unbound_newer else recorded_id
        try:
            if unbound_newer:
                # A new intake is visible immediately, but no old snapshot
                # evidence may be borrowed for this not-yet-attached run.
                status = {'phase': _safe_phase(newest_job), 'freshness': 'unavailable',
                          'source_freshness': 'unknown', 'readiness': 'not_established',
                          'findings_count': 0, 'checks': {'passed': 0, 'failed': 0}}
                freshness, implementation, assessment_status = 'unavailable', 'not_established', 'incomplete'
            elif quick:
                # The browser fetches status separately. Until that hash finishes,
                # old checks and verdicts must not be displayed as current.
                status = {'phase': _safe_phase(recorded_job) if recorded_id else 'not_started',
                          'freshness': 'checking' if isinstance(recorded_job, dict) else 'unavailable',
                          'source_freshness': 'unknown', 'readiness': 'not_established',
                          'findings_count': 0, 'checks': {'passed': 0, 'failed': 0}}
                freshness, implementation, assessment_status = status['freshness'], 'not_established', 'incomplete'
            else:
                status = registry.status(project['id'], instance_id=instance_id)
                freshness = status['freshness']
                implementation = status.get('implementation', 'not_established')
                assessment_status = status.get('assessment', 'incomplete')
        except (ValueError, TypeError, AttributeError, KeyError, OSError):
            status = {'phase': 'unavailable', 'freshness': 'unavailable', 'source_freshness': 'unavailable',
                      'readiness': 'not_established', 'findings_count': 0, 'checks': {'passed': 0, 'failed': 0}}
            freshness, implementation, assessment_status = 'unavailable', 'not_established', 'incomplete'
        # Freshness gates the visible assessment even if a historical job says
        # checks passed. Counts remain about the saved review, never new proof.
        items.append(ProjectItem(id=project['id'], project_revision=project['revision'],
                                 name=project['name'], source_kind=project['source_kind'],
                                 updated_at=project['updated_at'],
                                 activity_at=_later(project['updated_at'], _timestamp(newest_job.get('created_at')))
                                 if isinstance(newest_job, dict) else project['updated_at'],
                                 latest_job_id=recorded_id, open_job_id=open_job_id,
                                 phase=status['phase'], freshness=freshness,
                                 source_freshness=status['source_freshness'], readiness=status['readiness'],
                                 implementation=implementation, assessment=assessment_status,
                                 findings_count=status['findings_count'], checks_passed=status['checks']['passed'],
                                 checks_failed=status['checks']['failed']))
    end = offset + len(selected)
    return WorkspacePage(items=items, total=len(entries), next_offset=end if end < len(entries) else None)
