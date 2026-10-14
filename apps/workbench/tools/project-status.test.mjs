import test from 'node:test';
import assert from 'node:assert/strict';
import { applyProjectStatus, unavailableProjectStatus, projectState } from '../lib/project-status.mjs';

const item = { kind: 'project', id: 'project-1', project_revision: 2,
  latest_job_id: 'job-1', open_job_id: 'job-1', freshness: 'checking',
  source_freshness: 'unknown', readiness: 'not_established',
  implementation: 'not_established', assessment: 'incomplete',
  checks_passed: 0, checks_failed: 0, findings_count: 0 };
const page = { items: [item], total: 1, next_offset: null };
const status = { project_id: 'project-1', project_revision: 2, job_id: 'job-1',
  phase: 'complete', freshness: 'current', source_freshness: 'current',
  readiness: 'release_candidate', implementation: 'demonstrated',
  assessment: 'checked', checks: { passed: 2, failed: 0 }, findings_count: 0 };

test('current status hydrates only the matching project and review', () => {
  assert.equal(applyProjectStatus(page, status).items[0].readiness, 'release_candidate');
  assert.equal(applyProjectStatus(page, { ...status, project_revision: 3 }), page);
  assert.equal(applyProjectStatus(page, { ...status, job_id: 'old-job' }), page);
  assert.equal(applyProjectStatus({ ...page, items: [{ ...item, open_job_id: 'new-running-job' }] }, status).items[0].checks_passed, 0);
});

test('failed freshness request cannot preserve a success badge', () => {
  const failed = unavailableProjectStatus(page, 'project-1', 2, 'job-1').items[0];
  assert.equal(failed.freshness, 'unavailable');
  assert.equal(failed.readiness, 'not_established');
  assert.equal(failed.checks_passed, 0);
});

test('malformed status response cannot crash the home or create a healthy badge', () => {
  const malformed = applyProjectStatus(page, { ...status, checks: null }).items[0];
  assert.equal(malformed.freshness, 'unavailable');
  assert.equal(malformed.readiness, 'not_established');
  assert.equal(malformed.checks_passed, 0);
  const stale = applyProjectStatus(page, { ...status, freshness: 'stale' }).items[0];
  assert.equal(stale.freshness, 'stale');
  assert.equal(stale.readiness, 'not_established');
  assert.equal(stale.implementation, 'not_established');
  assert.equal(stale.checks_passed, 0);
});

test('a stopped or paused review is identified before missing snapshot evidence', () => {
  const failed = { ...item, open_job_id: 'new-job', phase: 'error', freshness: 'unavailable' };
  assert.equal(projectState(failed).label, 'Review stopped');
  assert.equal(projectState({ ...failed, phase: 'cancelled' }).label, 'Review stopped');
  assert.equal(projectState({ ...failed, phase: 'paused' }).label, 'Review paused');
  assert.equal(projectState({ ...item, open_job_id: 'job-1', phase: 'complete', freshness: 'checking' }).label, 'Updating status');
  assert.equal(projectState({ ...item, open_job_id: 'job-1', phase: 'complete', freshness: 'stale', readiness: 'release_candidate' }).label, 'Review needs updating');
});
