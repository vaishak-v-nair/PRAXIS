// Live mode: the demo's claim that none of it is a recording.
//
// Every test here runs the REAL path — the real job engine, the real receipt
// store, the real judge plumbing — with fixture processes standing in for the
// two things that cost money. If this suite passes, the only untested thing
// left in live mode is whether Anthropic's API is up.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  LIVE_TASK,
  liveTimeoutMs,
  makeSandbox,
  classifyLiveFailure,
  waitForJob,
  preserveReceipt,
  boundaryLines,
  hasUnverifiable,
  runLive,
} from '../src/lib/demo/live.js';
import { startJob } from '../src/commands/run.js';
import { judge } from '../src/lib/receipt/judge.js';
import { verifyFile, readEntries, provenanceOf, isDemo, envProvenance } from '../src/lib/receipt/store.js';
import { DEGRADE, degradeMessage } from '../src/lib/demo/epilogue.js';

const FIXTURE_AGENT = path.resolve('test', 'fixtures', 'live-agent.mjs');
const FIXTURE_JUDGE = path.resolve('test', 'fixtures', 'judge-fixture.mjs');
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-live-t-' + n + '-'));

/**
 * One live run, entirely on fixtures. Everything the real command does happens
 * here except spending tokens.
 */
async function liveRun({ mode = 'ok', timeoutMs = 30000, judgeFn, session } = {}) {
  const home = tmp('home');
  const keys = tmp('keys');
  const keep = path.join(tmp('keep'), 'receipts');
  const prev = {
    run: process.env.PRAXIS_RUN_CMD,
    key: process.env.PRAXIS_KEY_DIR,
    home: process.env.PRAXIS_TRANSCRIPT_HOME,
    mode: process.env.PRAXIS_LIVE_FIXTURE_MODE,
    sess: process.env.PRAXIS_LIVE_FIXTURE_SESSION,
    judge: process.env.PRAXIS_JUDGE_CMD,
  };
  process.env.PRAXIS_RUN_CMD = JSON.stringify([process.execPath, FIXTURE_AGENT]);
  process.env.PRAXIS_KEY_DIR = keys;
  process.env.PRAXIS_TRANSCRIPT_HOME = home;
  process.env.PRAXIS_LIVE_FIXTURE_MODE = mode;
  process.env.PRAXIS_LIVE_FIXTURE_SESSION = session || 'live-' + Math.random().toString(16).slice(2);
  process.env.PRAXIS_JUDGE_CMD = JSON.stringify([process.execPath, FIXTURE_JUDGE]);
  try {
    const res = await runLive({
      startJob,
      timeoutMs,
      transcriptHome: home,
      keepDir: keep,
      judgeFn: judgeFn || judge,
      waitOpts: { pollMs: 120 },
    });
    return { ...res, keep };
  } finally {
    for (const [k, v] of Object.entries({
      PRAXIS_RUN_CMD: prev.run,
      PRAXIS_KEY_DIR: prev.key,
      PRAXIS_TRANSCRIPT_HOME: prev.home,
      PRAXIS_LIVE_FIXTURE_MODE: prev.mode,
      PRAXIS_LIVE_FIXTURE_SESSION: prev.sess,
      PRAXIS_JUDGE_CMD: prev.judge,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ── the whole loop, end to end ────────────────────────────────────────────────

test('live does real work in a sandbox and seals a judged receipt from it', async () => {
  const res = await liveRun();
  assert.equal(res.ok, true, res.reason || 'live should complete on the happy path');

  // 1. the work is REAL — the agent's files are on disk in the sandbox
  assert.ok(fs.existsSync(path.join(res.sandbox, 'sum.js')), 'the agent actually wrote sum.js');
  assert.ok(fs.existsSync(path.join(res.sandbox, 'sum.test.js')), 'and its test');

  // 2. the receipt is real, sealed, and verifiable offline
  assert.equal(res.receipt.verification.ok, true, 'a live receipt must verify the moment it is sealed');
  assert.ok(fs.existsSync(res.receipt.file), 'and it survives outside the throwaway sandbox');

  // 3. the verdict came from a judging that actually happened
  assert.equal(res.judged, true);
  assert.ok(res.receipt.verdicts.length > 0, 'claims were extracted and ruled');
  assert.ok(['VERIFIED', 'PARTIAL', 'CLAIMS_FAILED', 'NO_CLAIMS'].includes(res.receipt.verdict));

  // 4. the evidence is the session's own — the collectors saw the real tool calls
  const entries = readEntries(res.receipt.file);
  const ev = entries.find((e) => e.t === 'evidence');
  assert.ok(ev, 'the receipt carries an evidence entry');
  assert.ok(
    ev.files_edited.some((f) => f.endsWith('sum.js')),
    'file evidence comes from the transcript, not from what the agent said',
  );
  assert.ok(ev.test_activity.length > 0, 'and `node --test` was categorized as test activity');
});

test('a live receipt is knowable as the demo’s work, forever', async () => {
  const res = await liveRun();
  assert.equal(res.ok, true, res.reason);
  const entries = readEntries(res.receipt.file);
  assert.equal(provenanceOf(entries), 'demo-live');
  assert.equal(isDemo(entries), true, 'sandbox work must never be countable as the user’s own');
  assert.equal(res.receipt.provenance, 'demo-live');
});

test('the preserved receipt is the sealed one, byte for byte', async () => {
  const res = await liveRun();
  assert.equal(res.ok, true, res.reason);
  assert.notEqual(res.receipt.file, res.receipt.sandboxFile, 'kept somewhere the OS will not sweep');
  assert.equal(
    fs.readFileSync(res.receipt.file, 'utf8'),
    fs.readFileSync(res.receipt.sandboxFile, 'utf8'),
    'copying, never re-sealing — a rewritten chain is a different receipt',
  );
  assert.equal(verifyFile(res.receipt.file).ok, true, 'and the copy verifies exactly as the original does');
});

test('the environment can only ever mark work as LESS real', () => {
  assert.equal(envProvenance({ PRAXIS_RECEIPT_PROVENANCE: 'demo-live' }), 'demo-live');
  assert.equal(envProvenance({ PRAXIS_RECEIPT_PROVENANCE: 'demo' }), 'demo');
  assert.equal(envProvenance({ PRAXIS_RECEIPT_PROVENANCE: 'real' }), null, 'nothing can declare itself real this way');
  assert.equal(envProvenance({ PRAXIS_RECEIPT_PROVENANCE: 'demo; rm -rf /' }), null);
  assert.equal(envProvenance({}), null);
});

test('live leaves the provenance mark behind it, not on the whole process', async () => {
  const before = process.env.PRAXIS_RECEIPT_PROVENANCE;
  await liveRun();
  assert.equal(process.env.PRAXIS_RECEIPT_PROVENANCE, before, 'a demo must not stamp the rest of the session');
});

// ── the failure paths, each named honestly ────────────────────────────────────

test('an unauthenticated CLI is named as that, not as a crash', async () => {
  const res = await liveRun({ mode: 'auth' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'cli-unauthenticated', 'the difference is a two-minute fix versus a bug report');
});

test('an adapter that yields no session gets no invented receipt', async () => {
  const res = await liveRun({ mode: 'no-session' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'nothing-sealed');
});

test('a judge that cannot be reached does NOT throw away a real receipt', async () => {
  const res = await liveRun({ judgeFn: async () => ({ ok: false, reason: 'judge is down' }) });
  assert.equal(res.ok, true, 'the agent worked and the evidence is sealed — that is not a failure');
  assert.equal(res.judged, false);
  assert.equal(res.receipt.verdict, 'UNVERIFIED', 'and no verdict was invented in the judge’s absence');
  assert.deepEqual(res.receipt.verdicts, []);
  assert.equal(res.receipt.verification.ok, true, 'evidence stands on its own');
});

test('live gives up rather than waiting forever, and kills what it started', async () => {
  const res = await liveRun({ mode: 'hang', timeoutMs: 2500 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'timed-out');
});

// ── the command itself, not just the library ─────────────────────────────────

test('`demo --live` renders the live screen and exits clean', { skip: !hasAgentCli() }, () => {
  // A redirected home so the test cannot write into the real one; the CLI keeps
  // its receipt under ~/.praxis/demo by design, and that design is the thing
  // being exercised here.
  const home = tmp('cli-home');
  const r = spawnSync(process.execPath, [path.resolve('src', 'cli.js'), 'demo', '--live'], {
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      PRAXIS_RUN_CMD: JSON.stringify([process.execPath, FIXTURE_AGENT]),
      PRAXIS_JUDGE_CMD: JSON.stringify([process.execPath, FIXTURE_JUDGE]),
      PRAXIS_TRANSCRIPT_HOME: home,
      PRAXIS_KEY_DIR: path.join(home, 'keys'),
      PRAXIS_LIVE_FIXTURE_MODE: 'ok',
      PRAXIS_LIVE_FIXTURE_SESSION: 'cli-live-' + Math.random().toString(16).slice(2),
      PRAXIS_DEMO_SPEED: '0',
    },
  });
  const out = r.stdout || '';
  assert.equal(r.status, 0, out.slice(-800));
  assert.match(out, /None of this was a recording/);
  assert.match(out, /chain intact · signature valid/);
  assert.match(out, /provenance: demo-live/);
  assert.match(out, /ruled just now, on this machine/);
  assert.match(out, /not a review of the code/i, 'the boundary is never dropped from the real screen');
  assert.doesNotMatch(out, /Nothing left your machine/, 'live calls a model twice — that line belongs to the replay alone');
  assert.doesNotMatch(out, /demo --live` can run the same loop/, 'do not invite someone to the thing they just watched');
});

/** Live is gated on an agent CLI existing; without one there is no screen to render. */
function hasAgentCli() {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return ['claude', 'codex', 'gemini'].some((b) => {
    try {
      return spawnSync(probe, [b], { encoding: 'utf8', timeout: 5000, windowsHide: true }).status === 0;
    } catch {
      return false;
    }
  });
}

// ── the pure parts ────────────────────────────────────────────────────────────

test('the live task is written so the record can answer some claims and not others', () => {
  assert.match(LIVE_TASK, /sum\.js/);
  assert.match(LIVE_TASK, /node --test/, 'running the tests is what makes iron rule 5 visible live');
  assert.match(LIVE_TASK, /do not touch any other directory/i, 'the sandbox is stated to the agent too');
});

test('liveTimeoutMs is overridable and never zero', () => {
  assert.equal(liveTimeoutMs({}), 240000);
  assert.equal(liveTimeoutMs({ PRAXIS_DEMO_LIVE_TIMEOUT_MS: '5000' }), 5000);
  assert.equal(liveTimeoutMs({ PRAXIS_DEMO_LIVE_TIMEOUT_MS: 'nonsense' }), 240000);
  assert.equal(liveTimeoutMs({ PRAXIS_DEMO_LIVE_TIMEOUT_MS: '-1' }), 240000);
});

test('the sandbox is a throwaway outside the project, and survives git being absent', () => {
  const root = tmp('sbx');
  const dir = makeSandbox({ root, git: false });
  assert.ok(dir.startsWith(root), 'never the user’s project');
  assert.ok(fs.existsSync(path.join(dir, 'README.md')), 'and it says what it is');
  assert.match(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), /throwaway/i);
});

test('classifyLiveFailure separates the fixable from the broken', () => {
  assert.equal(classifyLiveFailure({ status: 'failed', output: 'Please run claude login' }), 'cli-unauthenticated');
  assert.equal(classifyLiveFailure({ status: 'failed', output: 'invalid api key' }), 'cli-unauthenticated');
  assert.equal(classifyLiveFailure({ status: 'failed', meta: { exitSource: 'spawn-failed: ENOENT' } }), 'spawn-failed');
  assert.equal(classifyLiveFailure({ status: 'failed', meta: { exitSource: 'timeout-cap' } }), 'timed-out');
  assert.equal(classifyLiveFailure({ status: 'gone', meta: {} }), 'spawn-failed');
  assert.equal(classifyLiveFailure({ status: 'failed', meta: {} }), 'nothing-sealed');
});

test('waitForJob returns on a terminal status, on timeout, and on abort', async () => {
  const running = { pid: process.pid, exitCode: null };
  const finished = { pid: 999999, exitCode: 0 };

  let calls = 0;
  const settling = await waitForJob('p', 'j', {
    read: () => (++calls < 3 ? running : finished),
    wait: async () => {},
    pollMs: 0,
  });
  assert.equal(settling.status, 'done');

  let t = 0;
  const timedOut = await waitForJob('p', 'j', {
    read: () => running,
    wait: async () => {},
    clock: () => (t += 100),
    timeoutMs: 500,
  });
  assert.equal(timedOut.status, 'timeout');

  const aborted = await waitForJob('p', 'j', {
    read: () => running,
    wait: async () => {},
    shouldAbort: () => true,
  });
  assert.equal(aborted.status, 'abort', 'Ctrl-C must stop the agent, not just stop watching it');
});

test('preserveReceipt copies rather than re-seals', () => {
  const src = path.join(tmp('src'), 'r-x.v1.jsonl');
  fs.writeFileSync(src, '{"t":"open"}\n');
  const dest = preserveReceipt(src, path.join(tmp('dst'), 'receipts'));
  assert.equal(path.basename(dest), 'r-x.v1.jsonl', 'the receipt keeps its own name');
  assert.equal(fs.readFileSync(dest, 'utf8'), '{"t":"open"}\n');
});

test('every reason live can return has an honest sentence waiting for it', () => {
  // The classes live actually emits. A reason with no entry falls through to
  // "an unexpected problem", which is exactly the shrug the taxonomy exists to
  // prevent — so the set is asserted rather than trusted.
  for (const cls of [
    'no-agent-cli',
    'cli-unauthenticated',
    'spawn-failed',
    'timed-out',
    'nothing-sealed',
    'user-abort',
    'live-error',
  ]) {
    assert.ok(DEGRADE[cls], `${cls} has no line`);
    assert.equal(DEGRADE[cls].degrades, true, `${cls} must fall back to the replay, not stop the demo`);
    assert.match(degradeMessage(cls, null, 'praxis'), /Falling back to the recorded replay/);
  }
});

test('the boundary copy refuses the one dangerous misreading', () => {
  const plain = boundaryLines({}).join(' ');
  assert.match(plain, /not a review of the code/i, 'TRUE has never meant the code is good');
  assert.match(plain, /never claims to be complete/i);

  const withUnknowns = boundaryLines({ hadUnverifiable: true }).join(' ');
  assert.match(withUnknowns, /UNVERIFIABLE is not a failure/);
  assert.match(withUnknowns, /attempted, never that it succeeded/i, 'iron rule 5, said out loud to the viewer');

  assert.equal(hasUnverifiable([{ verdict: 'TRUE' }, { verdict: 'UNVERIFIABLE' }]), true);
  assert.equal(hasUnverifiable([{ verdict: 'TRUE' }]), false);
  assert.equal(hasUnverifiable(null), false);
});
