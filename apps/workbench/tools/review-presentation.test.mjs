import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceLabel, reviewPresentation } from '../lib/status.mjs';

function sourceJob() {
  return { checks: [], findings: [{ title: 'Constant success', severity: 'low', confidence: 'suggestion' }],
    assessment: { checks_failed: 0, title: '1 evidenced blocker',
      readiness: { status: 'blocked', label: 'Production readiness is blocked', blockers: ['REALITY: Constant success'] },
      implementation: { status: 'placeholder_risk' },
      dimensions: [{ id: 'reality', status: 'placeholder_risk' }, { id: 'security', status: 'not_established' }] } };
}

test('source-only suggestions require confirmation and never approve release or mutate evidence', () => {
  const job = sourceJob(); const before = JSON.stringify(job); const view = reviewPresentation(job);
  assert.equal(view.sourceConcern, true); assert.equal(view.readiness.status, 'not_established');
  assert.match(view.readiness.detail, /no runtime check was executed/);
  assert.equal(view.implementation.status, 'needs_human_review');
  assert.equal(view.dimensions[0].status, 'needs_human_review');
  assert.deepEqual(view.dimensions[1], job.assessment.dimensions[1]);
  assert.equal(JSON.stringify(job), before);
});

test('executed contradictions remain blocked, including failed native commands', () => {
  const job = sourceJob(); job.checks = [{ runtime: 'host', status: 'failed' }]; job.assessment.checks_failed = 1;
  job.assessment.implementation.status = 'contradicted';
  const view = reviewPresentation(job); assert.equal(view.sourceConcern, false);
  assert.equal(view.readiness.status, 'blocked'); assert.equal(view.implementation.status, 'contradicted');
});

test('high or confirmed concerns, mixed blockers and missing execution metadata are not softened', () => {
  for (const alter of [job => job.findings[0].severity = 'high', job => job.findings[0].confidence = 'confirmed',
    job => job.assessment.readiness.blockers.push('SECURITY: Debug enabled'), job => delete job.checks,
    job => delete job.assessment.checks_failed, job => job.assessment.readiness.blockers = ['REALITY: Unknown concern'],
    job => job.findings.push({ title: 'Constant success', severity: 'high', confidence: 'confirmed' }),
    job => job.checks.push({ runtime: 'host', status: 'passed' })]) {
    const job = sourceJob(); alter(job); assert.equal(reviewPresentation(job).readiness.status, 'blocked');
  }
});

test('human labels remove only a leading known prefix; recorded identifiers remain intact', () => {
  assert.equal(evidenceLabel('REALITY: Constant success'), 'Constant success');
  assert.equal(evidenceLabel('reality:  Constant success'), 'Constant success');
  assert.equal(evidenceLabel('src/REALITY: path'), 'src/REALITY: path');
  assert.equal(evidenceLabel('SECURITY: Debug enabled'), 'SECURITY: Debug enabled');
  assert.equal(evidenceLabel(''), '');
});
