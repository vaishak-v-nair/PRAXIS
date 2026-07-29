// The machine surface (D8): `--json` on status, receipt, jobs, doctor.
//
// The contract these tests hold is small and absolute:
//   - stdout is exactly ONE parseable JSON document, nothing else
//   - no ANSI anywhere in it — a pipe is not a terminal
//   - `ok` mirrors the exit code, so a script never reconciles two opinions
//   - keys are an API; renaming one is a breaking change
//
// Each command runs against a real throwaway project, not mocks, because the
// promise is about what a script actually receives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { open, append, finalize, receiptFile } from '../src/lib/receipt/store.js';

const CLI = path.resolve('src', 'cli.js');
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-json-' + n + '-'));

/** Run the CLI and insist stdout is one clean JSON document. */
function runJson(cwd, args, { expectExit } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, PRAXIS_SKIP_TRAY: '1' },
  });
  if (expectExit !== undefined) assert.equal(r.status, expectExit, `exit code of ${args.join(' ')}:\n${r.stdout}${r.stderr}`);
  // eslint-disable-next-line no-control-regex
  assert.ok(!/\x1b\[/.test(r.stdout), 'no ANSI reaches a pipe');
  let doc;
  try {
    doc = JSON.parse(r.stdout);
  } catch {
    assert.fail(`stdout of \`${args.join(' ')}\` is not one JSON document:\n${r.stdout}`);
  }
  assert.equal(doc.ok, r.status === 0, '`ok` mirrors the exit code — one opinion of success, not two');
  return doc;
}

/** A project with memory, so status has something to report. */
function project() {
  const dir = tmp('proj');
  fs.mkdirSync(path.join(dir, '.praxis'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.praxis', 'memory.md'),
    '# PRAXIS Memory\n## Project\n\n### 2026-01-01 - session\n- worked\n### 2026-01-02 - session\n- worked more\n',
  );
  return dir;
}

/** A real sealed receipt in the project's own receipts dir. */
function sealOne(dir, sessionId = 'json-test-1') {
  process.env.PRAXIS_KEY_DIR = process.env.PRAXIS_KEY_DIR || path.join(tmp('keys'), 'keys');
  const receiptsDir = path.join(dir, '.praxis', 'receipts');
  fs.mkdirSync(receiptsDir, { recursive: true });
  const o = open(receiptsDir, { sessionId, project: 'json-test', now: '2026-07-29T00:00:00.000Z' });
  append(receiptsDir, o.id, { commands_run: ['npm test'], files_edited: ['a.js'], counts: {} }, o.version);
  finalize(receiptsDir, o.id, { verdict: 'UNVERIFIED', claims: [], now: '2026-07-29T00:00:01.000Z' }, o.version);
  return { id: o.id, version: o.version, file: receiptFile(receiptsDir, o.id, o.version) };
}

// ── status ───────────────────────────────────────────────────────────────────

test('status --json: the same reads the human sees, as one document', () => {
  const dir = project();
  const doc = runJson(dir, ['status', '--json'], { expectExit: 0 });
  assert.equal(doc.initialized, true);
  assert.ok(doc.memory.bytes > 0);
  assert.equal(doc.memory.entries, 2);
  assert.equal(doc.memory.state, 'healthy');
  assert.ok(doc.memory.capBytes >= doc.memory.bytes);
  assert.match(doc.memory.updatedAt, /^\d{4}-\d{2}-\d{2}T/, 'timestamps are ISO, not prose like "8m ago"');
  assert.equal(doc.claude.connected, false, 'a throwaway dir has no session, and the document says so');
  assert.deepEqual(doc.receipts, { count: 0, armed: false, latest: null });
});

test('status --json: an uninitialized directory is an answer, not a lecture', () => {
  const doc = runJson(tmp('empty'), ['status', '--json'], { expectExit: 0 });
  assert.equal(doc.initialized, false);
  assert.equal(doc.memory, undefined, 'no invented stats for memory that does not exist');
});

// ── doctor ───────────────────────────────────────────────────────────────────

test('doctor --json: every check as data, exit code preserved', () => {
  const dir = project();
  const r = spawnSync(process.execPath, [CLI, 'doctor', '--json'], { cwd: dir, encoding: 'utf8', timeout: 60000, env: { ...process.env, PRAXIS_SKIP_TRAY: '1' } });
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.ok, r.status === 0);
  assert.ok(doc.checks.length >= 8, 'all the checks, not a summary of them');
  for (const c of doc.checks) {
    assert.ok(typeof c.id === 'string' && typeof c.ok === 'boolean', `check ${c.id} carries id and verdict`);
    if (!c.ok) assert.ok(c.fix, `a failing check (${c.id}) always names its fix`);
  }
  assert.equal(doc.passed + doc.checks.filter((c) => !c.ok).length, doc.total, 'the totals add up');
});

// ── jobs ─────────────────────────────────────────────────────────────────────

test('jobs --json: the whole list, statuses derived live, no 15-row cap', () => {
  const dir = project();
  const jobsDir = path.join(dir, '.praxis', 'jobs');
  for (let i = 0; i < 18; i++) {
    const id = `j-2026072900${String(i).padStart(2, '0')}`;
    fs.mkdirSync(path.join(jobsDir, id), { recursive: true });
    fs.writeFileSync(
      path.join(jobsDir, id, 'meta.json'),
      JSON.stringify({ id, task: 'task ' + i, tool: 'claude', startedAt: '2026-07-29T00:00:00.000Z', pid: 999999, exitCode: i % 2 ? 0 : 1 }),
    );
  }
  const doc = runJson(dir, ['jobs', '--json'], { expectExit: 0 });
  assert.equal(doc.jobs.length, 18, 'a machine reader gets everything — the cap is for eyes');
  assert.ok(doc.jobs.every((j) => j.status === 'done' || j.status === 'failed'), 'status is derived, present on every row');
});

test('jobs <id> --json: the close-up, and an honest miss', () => {
  const dir = project();
  const id = 'j-20260729aaaa';
  fs.mkdirSync(path.join(dir, '.praxis', 'jobs', id), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.praxis', 'jobs', id, 'meta.json'),
    JSON.stringify({ id, task: 'write docs', tool: 'claude', startedAt: '2026-07-29T00:00:00.000Z', pid: 999999, exitCode: 0, receiptId: 'r-abcd1234' }),
  );
  const hit = runJson(dir, ['jobs', id, '--json'], { expectExit: 0 });
  assert.equal(hit.job.id, id);
  assert.equal(hit.job.status, 'done');
  assert.equal(hit.job.receiptId, 'r-abcd1234');

  const miss = runJson(dir, ['jobs', 'j-nope', '--json'], { expectExit: 1 });
  assert.equal(miss.error, 'no-such-job');
});

// ── receipt ──────────────────────────────────────────────────────────────────

test('receipt --json and --list --json: the receipt as data, chain check included', () => {
  const dir = project();
  const sealed = sealOne(dir);

  const list = runJson(dir, ['receipt', '--list', '--json'], { expectExit: 0 });
  assert.equal(list.receipts.length, 1);
  assert.equal(list.receipts[0].id, sealed.id);

  const doc = runJson(dir, ['receipt', '--json'], { expectExit: 0 });
  assert.equal(doc.receipt.id, sealed.id);
  assert.equal(doc.receipt.sealed, true);
  assert.equal(doc.receipt.chain.ok, true, 'the document carries whether to believe itself');

  const missing = runJson(dir, ['receipt', 'r-00000000', '--json'], { expectExit: 1 });
  assert.equal(missing.error, 'no-such-receipt');
});

test('receipt --json with none is null, not an error — absence is an answer', () => {
  const doc = runJson(project(), ['receipt', '--json'], { expectExit: 0 });
  assert.equal(doc.receipt, null);
  const list = runJson(project(), ['receipt', '--list', '--json'], { expectExit: 0 });
  assert.deepEqual(list.receipts, []);
});

test('receipt verify --json: the CI gate — VERIFIED, and NOT_VERIFIED with the why', () => {
  const dir = project();
  const sealed = sealOne(dir, 'json-verify-1');

  const good = runJson(dir, ['receipt', 'verify', sealed.file, '--json'], { expectExit: 0 });
  assert.equal(good.status, 'VERIFIED');
  assert.ok(good.entries >= 3);
  assert.equal(good.explanation, null);

  // Tamper: append a line after sealing. The chain must break, the document
  // must say where, and the exit code must fail the gate.
  fs.appendFileSync(sealed.file, JSON.stringify({ t: 'evidence', forged: true }) + '\n');
  const bad = runJson(dir, ['receipt', 'verify', sealed.file, '--json'], { expectExit: 1 });
  assert.equal(bad.status, 'NOT_VERIFIED');
  assert.ok(bad.reason, 'the failure is named, not just false');
  assert.ok(bad.explanation, 'and explained in words a log line can carry');

  const nofile = runJson(dir, ['receipt', 'verify', '--json'], { expectExit: 2 });
  assert.equal(nofile.error, 'missing-file');
});
