import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateDag,
  topologicalSort,
  interpolateStepTask,
  createWorkflowRun,
  readWorkflowRun,
  updateWorkflowRun,
} from '../src/lib/jobs/dag.js';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-dag-test-'));
  fs.mkdirSync(path.join(dir, '.praxis'), { recursive: true });
  return dir;
}

test('validateDag accepts valid acyclic DAG specs', () => {
  const spec = {
    name: 'refactor-flow',
    description: 'A test flow',
    steps: [
      { id: 'plan', task: 'Plan the change', tool: 'codex' },
      { id: 'code', task: 'Implement change', tool: 'codex', dependsOn: ['plan'] },
      { id: 'test', task: 'Run test suite', tool: 'claude', dependsOn: ['code'] },
    ],
  };
  const v = validateDag(spec);
  assert.equal(v.ok, true);
});

test('validateDag catches missing required fields and duplicates', () => {
  assert.equal(validateDag(null).ok, false);
  assert.equal(validateDag({}).ok, false);
  assert.equal(validateDag({ name: 'test', steps: [] }).ok, false);

  const duplicate = {
    name: 'dup',
    steps: [
      { id: 'step-1', task: 'task 1' },
      { id: 'step-1', task: 'task 2' },
    ],
  };
  const v = validateDag(duplicate);
  assert.equal(v.ok, false);
  assert.match(v.error, /Duplicate step id/);
});

test('validateDag detects unknown dependencies and self-dependencies', () => {
  const unknownDep = {
    name: 'unknown',
    steps: [{ id: 'step-1', task: 'task 1', dependsOn: ['non-existent'] }],
  };
  assert.equal(validateDag(unknownDep).ok, false);
  assert.match(validateDag(unknownDep).error, /depends on unknown step/);

  const selfDep = {
    name: 'self',
    steps: [{ id: 'step-1', task: 'task 1', dependsOn: ['step-1'] }],
  };
  assert.equal(validateDag(selfDep).ok, false);
  assert.match(validateDag(selfDep).error, /cannot depend on itself/);
});

test('validateDag detects circular dependency cycles', () => {
  // Simple 2-node cycle: A -> B -> A
  const cycle2 = {
    name: 'cycle2',
    steps: [
      { id: 'A', task: 'Task A', dependsOn: ['B'] },
      { id: 'B', task: 'Task B', dependsOn: ['A'] },
    ],
  };
  const v2 = validateDag(cycle2);
  assert.equal(v2.ok, false);
  assert.match(v2.error, /Circular dependency cycle/);

  // 3-node cycle: A -> B -> C -> A
  const cycle3 = {
    name: 'cycle3',
    steps: [
      { id: 'A', task: 'Task A', dependsOn: ['C'] },
      { id: 'B', task: 'Task B', dependsOn: ['A'] },
      { id: 'C', task: 'Task C', dependsOn: ['B'] },
    ],
  };
  const v3 = validateDag(cycle3);
  assert.equal(v3.ok, false);
  assert.match(v3.error, /Circular dependency cycle/);
});

test('topologicalSort groups steps into parallel tiers correctly', () => {
  // Diamond:
  //      start
  //     /     \
  //  branchA   branchB
  //     \     /
  //       join
  const steps = [
    { id: 'start', task: 'start' },
    { id: 'branchA', task: 'branch A', dependsOn: ['start'] },
    { id: 'branchB', task: 'branch B', dependsOn: ['start'] },
    { id: 'join', task: 'join', dependsOn: ['branchA', 'branchB'] },
  ];

  const res = topologicalSort(steps);
  assert.equal(res.ok, true);
  assert.equal(res.tiers.length, 3);
  assert.deepEqual(res.tiers[0].map((s) => s.id), ['start']);
  assert.deepEqual(res.tiers[1].map((s) => s.id).sort(), ['branchA', 'branchB']);
  assert.deepEqual(res.tiers[2].map((s) => s.id), ['join']);
});

test('interpolateStepTask replaces step placeholders with output', () => {
  const task = 'Review this output: {{steps.draft.output}} and report findings.';
  const stepOutputs = { draft: 'Refactored 3 functions cleanly.' };
  const res = interpolateStepTask(task, stepOutputs);
  assert.equal(res, 'Review this output: Refactored 3 functions cleanly. and report findings.');

  const missing = interpolateStepTask(task, {});
  assert.equal(missing, 'Review this output:  and report findings.');
});

test('createWorkflowRun, readWorkflowRun, and updateWorkflowRun round-trip', () => {
  const sbox = sandbox();
  const praxisDir = path.join(sbox, '.praxis');

  const spec = {
    name: 'test-wf',
    steps: [
      { id: 'step-1', task: 'Run step 1', tool: 'codex' },
      { id: 'step-2', task: 'Run step 2', tool: 'claude', dependsOn: ['step-1'] },
    ],
  };

  const created = createWorkflowRun(praxisDir, spec);
  assert.ok(created.id.startsWith('wf-'));
  assert.equal(created.meta.name, 'test-wf');
  assert.equal(created.meta.tiers.length, 2);

  const read = readWorkflowRun(praxisDir, created.id);
  assert.equal(read.id, created.id);
  assert.equal(read.status, 'running');
  assert.equal(read.steps['step-1'].status, 'pending');

  const updated = updateWorkflowRun(praxisDir, created.id, { status: 'done' });
  assert.equal(updated.status, 'done');
  assert.equal(readWorkflowRun(praxisDir, created.id).status, 'done');
});
