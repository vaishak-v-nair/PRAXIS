import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJob, updateMeta, readMeta, jobStatus, listJobs, tailOutput } from '../src/lib/jobs/store.js';
import { run } from '../src/commands/run.js';
import { approve, executionTask } from '../src/commands/approve.js';

const FIXTURE_AGENT = JSON.stringify([
  process.execPath,
  '-e',
  "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{console.log('EXEC: '+s.slice(0,80));process.exit(0);});",
]);

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-appr-'));
  fs.mkdirSync(path.join(dir, '.praxis'), { recursive: true });
  return dir;
}

async function settled(p, id, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const m = readMeta(p, id);
    if (m && jobStatus(m) !== 'running') return m;
    await new Promise((r) => setTimeout(r, 200));
  }
  return readMeta(p, id);
}

/** A finished safe-draft job, hand-built — no spawn needed. */
function makeDraft(praxisDir, id, task) {
  const { dir } = createJob(praxisDir, { id, task, tool: 'claude', argv: [], cwd: '' });
  updateMeta(praxisDir, id, { mode: 'plan', approval: 'pending', exitCode: 0, endedAt: new Date().toISOString() });
  fs.writeFileSync(path.join(dir, 'out.log'), 'Plan: create the file with the exact content.\n');
  return id;
}

test('a finished plan-mode job is a draft — the inbox state', () => {
  assert.equal(jobStatus({ exitCode: 0, mode: 'plan', approval: 'pending' }), 'draft');
  assert.equal(jobStatus({ exitCode: 0, mode: 'plan', approval: 'approved' }), 'done');
  assert.equal(jobStatus({ exitCode: 0, mode: 'plan', approval: 'denied' }), 'done');
  assert.equal(jobStatus({ exitCode: 0, mode: 'acceptEdits', approval: 'none' }), 'done');
});

test('run() defaults to safe draft; --allow-edits records acceptEdits', async () => {
  const cwd = sandbox();
  const prev = process.cwd();
  process.chdir(cwd);
  process.env.PRAXIS_RUN_CMD = FIXTURE_AGENT;
  try {
    await run(['do', 'a', 'thing']);
    await run(['--allow-edits', 'do', 'another']);
    const p = path.join(cwd, '.praxis');
    const rows = listJobs(p);
    const draft = rows.find((r) => r.task === 'do a thing');
    const edits = rows.find((r) => r.task === 'do another');
    assert.equal(draft.mode, 'plan');
    assert.equal(draft.approval, 'pending');
    assert.equal(edits.mode, 'acceptEdits');
    assert.equal(edits.approval, 'none');
  } finally {
    delete process.env.PRAXIS_RUN_CMD;
    process.chdir(prev);
  }
});

test('executionTask carries the original ask, the approval, and the plan', () => {
  const t = executionTask({ task: 'make NOTES.md' }, 'Plan: write the file.');
  assert.match(t, /make NOTES\.md/);
  assert.match(t, /APPROVED/);
  assert.match(t, /Plan: write the file\./);
});

test('approve executes a draft: twin job spawns, both sides linked', async () => {
  const cwd = sandbox();
  const prev = process.cwd();
  process.chdir(cwd);
  process.env.PRAXIS_RUN_CMD = FIXTURE_AGENT;
  try {
    const p = path.join(cwd, '.praxis');
    const id = makeDraft(p, 'j-20260727000000-d001', 'create DEMO.md saying hi');
    await approve([id]);

    const parent = readMeta(p, id);
    assert.equal(parent.approval, 'approved');
    assert.ok(parent.approvedTo, 'parent points at the execution twin');

    const child = await settled(p, parent.approvedTo);
    assert.equal(child.approvedFrom, id);
    assert.equal(child.mode, 'acceptEdits');
    const out = tailOutput(p, child.id, 5).join(' ');
    assert.match(out, /EXEC: create DEMO\.md saying hi/); // task + plan reached the twin
  } finally {
    delete process.env.PRAXIS_RUN_CMD;
    process.chdir(prev);
  }
});

test('a failing agent yields a REAL failed status (no done-because-it-printed)', async () => {
  const cwd = sandbox();
  const prev = process.cwd();
  process.chdir(cwd);
  process.env.PRAXIS_RUN_CMD = JSON.stringify([
    process.execPath,
    '-e',
    "console.log('API Error: 529 Overloaded');process.exit(7);", // prints, then dies
  ]);
  try {
    await run(['doomed', 'task']);
    const p = path.join(cwd, '.praxis');
    const id = listJobs(p)[0].id;
    const meta = await settled(p, id);
    assert.equal(meta.exitCode, 7); // the true code, from the runner parent
    assert.equal(meta.exitSource, 'runner');
    assert.equal(jobStatus(meta), 'failed'); // printed output does NOT make it done
  } finally {
    delete process.env.PRAXIS_RUN_CMD;
    process.chdir(prev);
  }
});

test('a draft whose execution twin failed can be approved AGAIN (retry)', async () => {
  const cwd = sandbox();
  const prev = process.cwd();
  process.chdir(cwd);
  process.env.PRAXIS_RUN_CMD = FIXTURE_AGENT;
  try {
    const p = path.join(cwd, '.praxis');
    const id = makeDraft(p, 'j-20260727000000-d003', 'retry me');
    // simulate an approved draft whose twin died on a transient API error
    createJob(p, { id: 'j-20260727000001-t001', task: 'x', tool: 'claude', argv: [], cwd: '' });
    updateMeta(p, 'j-20260727000001-t001', { exitCode: 1, endedAt: new Date().toISOString() });
    updateMeta(p, id, { approval: 'approved', approvedTo: 'j-20260727000001-t001' });

    await approve([id]); // must NOT refuse — twin is failed
    const parent = readMeta(p, id);
    assert.notEqual(parent.approvedTo, 'j-20260727000001-t001', 'a fresh twin was started');
    const child = await settled(p, parent.approvedTo);
    assert.equal(child.approvedFrom, id);
  } finally {
    delete process.env.PRAXIS_RUN_CMD;
    process.chdir(prev);
  }
});

test('deny closes a draft without executing; non-drafts refuse politely', async () => {
  const cwd = sandbox();
  const prev = process.cwd();
  process.chdir(cwd);
  try {
    const p = path.join(cwd, '.praxis');
    const id = makeDraft(p, 'j-20260727000000-d002', 'sketchy task');
    await approve([id, '--deny']);
    const meta = readMeta(p, id);
    assert.equal(meta.approval, 'denied');
    assert.equal(meta.approvedTo, undefined); // nothing ran
    assert.equal(jobStatus(meta), 'done'); // out of the inbox

    // approving a denied draft: no crash, no twin
    await approve([id]);
    assert.equal(readMeta(p, id).approvedTo, undefined);
  } finally {
    process.chdir(prev);
  }
});
