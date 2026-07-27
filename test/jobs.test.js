import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newJobId, createJob, readMeta, updateMeta, jobStatus, listJobs, tailOutput } from '../src/lib/jobs/store.js';
import { resolveRunCmd, run } from '../src/commands/run.js';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-jobs-'));
  fs.mkdirSync(path.join(dir, '.praxis'), { recursive: true });
  return dir;
}

test('job ids are time-ordered and unique', () => {
  const a = newJobId(new Date('2026-07-27T10:00:00Z'));
  const b = newJobId(new Date('2026-07-27T10:00:01Z'));
  assert.ok(a.startsWith('j-20260727'));
  assert.ok(b > a);
  assert.notEqual(newJobId(), newJobId());
});

test('create/read/update meta round-trips', () => {
  const p = path.join(sandbox(), '.praxis');
  const { metaFile } = createJob(p, { id: 'j-x', task: 'do a thing', tool: 'claude', argv: ['x'], cwd: 'c', now: '2026-07-27T00:00:00Z' });
  assert.ok(fs.existsSync(metaFile));
  assert.equal(readMeta(p, 'j-x').task, 'do a thing');
  updateMeta(p, 'j-x', { pid: 12345 });
  assert.equal(readMeta(p, 'j-x').pid, 12345);
});

test('jobStatus is honest: running / done / failed / gone', () => {
  assert.equal(jobStatus({ pid: process.pid, exitCode: null }), 'running'); // a pid that IS alive
  assert.equal(jobStatus({ pid: 999999, exitCode: 0 }), 'done');
  assert.equal(jobStatus({ pid: 999999, exitCode: 1 }), 'failed');
  assert.equal(jobStatus({ pid: 999999, exitCode: null }), 'gone'); // dead pid, no exit recorded
  assert.equal(jobStatus(null), 'unknown');
});

test('listJobs returns newest first with derived status', () => {
  const p = path.join(sandbox(), '.praxis');
  createJob(p, { id: 'j-20260101000000-aaaa', task: 'old', tool: 'claude', argv: [], cwd: '' });
  createJob(p, { id: 'j-20260102000000-bbbb', task: 'new', tool: 'claude', argv: [], cwd: '' });
  const rows = listJobs(p);
  assert.equal(rows[0].task, 'new');
  assert.equal(rows[1].status, 'gone'); // no pid, no exit — honest
});

test('tailOutput returns the last lines only', () => {
  const p = path.join(sandbox(), '.praxis');
  const { dir } = createJob(p, { id: 'j-t', task: 't', tool: 'claude', argv: [], cwd: '' });
  fs.writeFileSync(path.join(dir, 'out.log'), Array.from({ length: 30 }, (_, i) => 'line ' + i).join('\n'));
  const tail = tailOutput(p, 'j-t', 5);
  assert.equal(tail.length, 5);
  assert.equal(tail[4], 'line 29');
});

test('resolveRunCmd: injectable, and claude is the default adapter', () => {
  process.env.PRAXIS_RUN_CMD = '["node","agent.mjs"]';
  assert.deepEqual(resolveRunCmd('claude'), ['node', 'agent.mjs']);
  delete process.env.PRAXIS_RUN_CMD;
  assert.deepEqual(resolveRunCmd('claude'), ['claude', '-p', '--output-format', 'json']);
  assert.equal(resolveRunCmd('codex'), null); // roadmap, not pretense
});

test('run() spawns detached, job completes, deck shows done', async () => {
  const cwd = sandbox();
  const prev = process.cwd();
  process.chdir(cwd);
  try {
    // fake agent: reads stdin, echoes, exits 0 — fast and cross-platform
    process.env.PRAXIS_RUN_CMD = JSON.stringify([
      process.execPath,
      '-e',
      "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{console.log('agent did: '+s);process.exit(0);});",
    ]);
    await run(['summarize', 'the', 'repo']);

    const p = path.join(cwd, '.praxis');
    const rows = listJobs(p);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].task, 'summarize the repo');

    // wait for the detached child + watcher to settle (poll, max ~8s)
    let meta;
    for (let i = 0; i < 40; i++) {
      meta = readMeta(p, rows[0].id);
      const out = tailOutput(p, rows[0].id, 3);
      if (out.length && jobStatus(meta) !== 'running') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const tail = tailOutput(p, rows[0].id, 3);
    assert.match(tail.join(' '), /agent did: summarize the repo/);
    assert.notEqual(jobStatus(readMeta(p, rows[0].id)), 'running');
  } finally {
    delete process.env.PRAXIS_RUN_CMD;
    process.chdir(prev);
  }
});
