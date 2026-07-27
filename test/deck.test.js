import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test as _t } from 'node:test';
import { createDeckServer, listenLocal, buildState } from '../src/lib/deck/server.js';
const OPEN = [];
_t.after(() => { for (const s of OPEN) { try { s.close(); s.closeAllConnections && s.closeAllConnections(); } catch {} } });
import { createJob, updateMeta, readMeta, listJobs } from '../src/lib/jobs/store.js';

function sandbox() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-deck-'));
  fs.mkdirSync(path.join(cwd, '.praxis'), { recursive: true });
  return cwd;
}

function makeDraft(praxisDir, id, task) {
  const { dir } = createJob(praxisDir, { id, task, tool: 'claude', argv: [], cwd: '' });
  updateMeta(praxisDir, id, { mode: 'plan', approval: 'pending', exitCode: 0, endedAt: 'x', resultTail: 'Plan: do it.' });
  fs.writeFileSync(path.join(dir, 'out.log'), 'Plan: do it.');
  return id;
}

let PORT = 4900;
async function boot(cwd, extras = {}) {
  const praxisDir = path.join(cwd, '.praxis');
  const startedJobs = [];
  const { server, token } = createDeckServer({
    cwd,
    praxisDir,
    memoryFile: path.join(praxisDir, 'memory.md'),
    project: 'test-proj',
    startJob: async ({ task, mode, goal, approvedFrom }) => {
      const id = 'j-spawned-' + (startedJobs.length + 1);
      createJob(praxisDir, { id, task, tool: 'claude', argv: [], cwd });
      updateMeta(praxisDir, id, { mode, goal: goal || null, approvedFrom: approvedFrom || null });
      startedJobs.push({ id, task, mode });
      return { id };
    },
    executionTask: (meta, plan) => meta.task + ' :: ' + plan,
    governFn: extras.governFn || (async () => ({ ok: true, jobs: [{ task: 'gov job 1', why: 'w' }], note: 'one queued' })),
  });
  const port = await listenLocal(server, (PORT += 7));
  OPEN.push(server);
  const base = `http://127.0.0.1:${port}`;
  const call = (p, body) =>
    fetch(base + p, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-praxis-token': token }, body: JSON.stringify(body) } : { headers: { 'x-praxis-token': token } });
  return { server, token, base, call, praxisDir, startedJobs };
}

test('the page serves, and api requests without the token are refused', async () => {
  const { server, base } = await boot(sandbox());
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /THE DECK|the deck/i);
  const noToken = await fetch(base + '/api/state');
  assert.equal(noToken.status, 403); // drive-by localhost gets nothing
  server.close();
});

test('state reflects jobs; draft carries its plan for the inbox card', async () => {
  const cwd = sandbox();
  const { server, call, praxisDir } = await boot(cwd);
  makeDraft(praxisDir, 'j-d1', 'write the notes');
  const s = await (await call('/api/state')).json();
  assert.equal(s.jobs.length, 1);
  assert.equal(s.jobs[0].status, 'draft');
  assert.equal(s.jobs[0].resultTail, 'Plan: do it.');
  assert.equal(s.project, 'test-proj');
  server.close();
});

test('approve from the browser: twin starts with acceptEdits, both linked', async () => {
  const cwd = sandbox();
  const { server, call, praxisDir, startedJobs } = await boot(cwd);
  makeDraft(praxisDir, 'j-d2', 'make a file');
  const r = await (await call('/api/approve', { id: 'j-d2' })).json();
  assert.ok(r.ok);
  assert.equal(startedJobs[0].mode, 'acceptEdits');
  assert.match(startedJobs[0].task, /make a file :: Plan: do it\./); // plan traveled
  assert.equal(readMeta(praxisDir, 'j-d2').approvedTo, r.twin);
  server.close();
});

test('deny from the browser closes the draft; approving non-drafts refuses', async () => {
  const cwd = sandbox();
  const { server, call, praxisDir } = await boot(cwd);
  makeDraft(praxisDir, 'j-d3', 'sketchy');
  const r = await (await call('/api/approve', { id: 'j-d3', deny: true })).json();
  assert.ok(r.denied);
  assert.equal(readMeta(praxisDir, 'j-d3').approval, 'denied');
  const again = await call('/api/approve', { id: 'j-d3' });
  assert.equal(again.status, 409);
  server.close();
});

test('goal via the browser: governor runs async, fleet lands goal-tagged', async () => {
  const cwd = sandbox();
  const { server, call, praxisDir } = await boot(cwd);
  const r = await call('/api/gov', { goal: 'do the thing' });
  assert.equal(r.status, 202); // accepted, not blocking the page
  // poll state until the async governor settles
  let s;
  for (let i = 0; i < 30; i++) {
    s = await (await call('/api/state')).json();
    if (!s.governor.busy && s.jobs.length) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.equal(s.jobs.length, 1);
  assert.equal(s.jobs[0].goal, 'do the thing');
  assert.match(s.governor.lastNote, /one queued/);
  server.close();
});

test('a failed governor reports the error and queues nothing', async () => {
  const cwd = sandbox();
  const { server, call, praxisDir } = await boot(cwd, { governFn: async () => ({ ok: false, reason: 'timeout' }) });
  await call('/api/gov', { goal: 'x' });
  let s;
  for (let i = 0; i < 30; i++) {
    s = await (await call('/api/state')).json();
    if (!s.governor.busy) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.equal(listJobs(praxisDir).length, 0);
  assert.match(s.governor.lastError, /timeout/);
  server.close();
});

test('buildState never throws on an empty project', () => {
  const cwd = sandbox();
  const s = buildState(path.join(cwd, '.praxis'), path.join(cwd, '.praxis', 'memory.md'));
  assert.deepEqual(s.jobs, []);
  assert.equal(s.memoryBrief, '');
});
