import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newJobId, createJob, readMeta, updateMeta, jobStatus, listJobs, tailOutput, readMetaWith } from '../src/lib/jobs/store.js';
import { withEnvRetry } from './helpers/flaky-env.mjs';
import { resolveRunCmd, run } from '../src/commands/run.js';

// CI runners spawn processes far more slowly than a dev machine, and this file
// starts a detached child. Same reasoning as demo-live.test.js: generous on CI,
// unchanged locally.
const SLOW = process.env.CI ? 4 : 1;

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

test('a job that has not recorded its pid yet is starting, not dead', () => {
  // createJob writes pid:null and the detached runner patches the real pid in a
  // moment later. In that window pidAlive(null) is false, and jobStatus used to
  // answer 'gone' — so a job that had just been launched read as crashed. The
  // demo's live mode maps 'gone' straight to 'spawn-failed', which is how a
  // healthy run reported that the agent failed to start, 449ms after starting
  // it, and took a CI leg red on nearly every push.
  const now = Date.parse('2026-08-01T12:00:00Z');
  const justStarted = { pid: null, exitCode: null, startedAt: '2026-08-01T11:59:59Z' };
  assert.equal(jobStatus(justStarted, now), 'running', 'one second old: still starting');

  const stale = { pid: null, exitCode: null, startedAt: '2026-08-01T11:59:00Z' };
  assert.equal(jobStatus(stale, now), 'gone', 'a minute later with no pid, it really is gone');

  // A REAL spawn failure is caught by exitCode and never waits out the grace.
  assert.equal(jobStatus({ pid: null, exitCode: -1, startedAt: '2026-08-01T11:59:59Z' }, now), 'failed');

  // No startedAt at all is not a licence to assume health.
  assert.equal(jobStatus({ pid: null, exitCode: null }, now), 'gone');
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
  // `now` is passed explicitly and set in the past, so these are jobs whose
  // runner never attached — genuinely gone. They used to be created with the
  // current time and still expected to read 'gone', which quietly encoded the
  // bug above: that a job with no pid is dead even if it was launched a
  // millisecond ago. It is not; it is starting.
  const longAgo = '2026-01-01T00:00:00.000Z';
  createJob(p, { id: 'j-20260101000000-aaaa', task: 'old', tool: 'claude', argv: [], cwd: '', now: longAgo });
  createJob(p, { id: 'j-20260102000000-bbbb', task: 'new', tool: 'claude', argv: [], cwd: '', now: longAgo });
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

test('a job read while it is being written is retried, not reported as nameless', () => {
  // The bug this fixes: meta.json has two writer processes (the CLI that starts
  // a job, the detached runner that finishes it) and writeMeta is a plain
  // writeFileSync, because the rename-based fix was tried and reverted — on
  // Windows it turned a rare read race into a constant write failure.
  //
  // So the reader has to absorb the race, and it could not: it retried twice in
  // a tight loop, microseconds apart, which is no wait at all. A file caught
  // mid-write failed both reads and returned null — and listJobs turns null
  // into `{ id, status: 'unknown' }`, a row with no task, no mode, no goal. The
  // deck showed a job as though it had never existed, purely for having been
  // looked at while it was being written. It also made this suite flake on CI.
  const good = JSON.stringify({ id: 'j-1', task: 'summarize the repo', mode: 'plan' });

  let reads = 0;
  const tornThenGood = () => {
    reads++;
    if (reads === 1) throw new Error('EBUSY'); // caught mid-write
    return good;
  };
  const paused = [];
  const meta = readMetaWith(tornThenGood, (ms) => paused.push(ms));
  assert.equal(meta.task, 'summarize the repo', 'the second read wins');
  assert.equal(reads, 2);
  assert.deepEqual(paused, [5], 'and it actually waited between them');

  // valid JSON that is still a partial write — an object with no id
  assert.equal(readMetaWith(() => '{}', () => {}), null, 'half a write is not truth');
  assert.equal(readMetaWith(() => 'not json', () => {}), null);

  // the healthy path pays nothing
  const cheap = [];
  assert.ok(readMetaWith(() => good, (ms) => cheap.push(ms)).id);
  assert.deepEqual(cheap, [], 'a file that reads first time never waits');
});

test('run() spawns detached, job completes, deck shows done', async () => withEnvRetry('run() spawns detached', async () => {
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

    // Wait for the detached child and its watcher to settle.
    //
    // Deadline-based, not iteration-based: the old version counted 40 sleeps of
    // 200 ms and called that "~8s", which it is only if every iteration is
    // free. On a loaded CI runner spawning a second node process takes far
    // longer than locally, and this test failed with the useless message
    // `Input: ''` — no status, no stderr, nothing to act on.
    const deadline = Date.now() + 8000 * SLOW;
    let meta;
    let out = [];
    while (Date.now() < deadline) {
      meta = readMeta(p, rows[0].id);
      out = tailOutput(p, rows[0].id, 3);
      if (out.length && jobStatus(meta) !== 'running') break;
      await new Promise((r) => setTimeout(r, 200));
    }

    // If it did time out, say WHY. A failure that names the job's status and
    // its stderr is a bug report; `Input: ''` is a shrug.
    const diag = () => {
      const m = readMeta(p, rows[0].id);
      let err = '';
      try {
        err = fs.readFileSync(path.join(p, 'jobs', rows[0].id, 'err.log'), 'utf8').slice(0, 300);
      } catch {
        err = '(no err.log)';
      }
      return `status=${jobStatus(m)} exitCode=${m && m.exitCode} pid=${m && m.pid} out=${JSON.stringify(out)} err=${err}`;
    };
    assert.match(tailOutput(p, rows[0].id, 3).join(' '), /agent did: summarize the repo/, diag());
    assert.notEqual(jobStatus(readMeta(p, rows[0].id)), 'running', diag());
  } finally {
    delete process.env.PRAXIS_RUN_CMD;
    process.chdir(prev);
  }
}));
