import test from 'node:test';
import assert from 'node:assert/strict';
import { statusMeta } from '../apps/workbench/lib/status.mjs';
test('status presentation keeps severity, warning, neutral, and execution distinct', () => {
  for (const status of ['blocked','high','critical','contradicted']) assert.equal(statusMeta(status).tone,'negative');
  for (const status of ['uncertain','limited','not_established','needs_human_review']) assert.equal(statusMeta(status).tone,'warning');
  for (const status of ['skipped','unrecognized']) assert.equal(statusMeta(status).tone,'neutral');
  assert.equal(statusMeta('passed').icon,'check');
});
test('model hypotheses keep model icons instead of execution checks', () => {
  assert.equal(statusMeta('model says works').icon,'model');
  assert.equal(statusMeta('model flags failure').icon,'model');
  assert.equal(statusMeta('model says works').tone,'positive');
  assert.equal(statusMeta('model flags failure').tone,'negative');
});
