// Live mode — the same loop as the replay, on work that has not happened yet.
//
// The replay is the guarantee: it always runs, needs no agent, no account and
// no network, and it ends with a sealed receipt. Live is the proof that the
// guarantee is not a recording. A real agent does real work, PRAXIS seals a
// receipt from that session's own transcript, and the judge rules the agent's
// real claims — minutes old, on this machine, with nobody (including us)
// knowing the verdict in advance.
//
// Three rules this file exists to keep:
//
//   1. Live NEVER touches the user's project (D13). It works in a throwaway
//      sandbox. A demo that edits someone's repo to prove it is trustworthy has
//      already broken the thing it is proving.
//   2. Live routes through the SAME job engine as `praxis run` (D33). No second
//      way to spawn an agent, so what the demo shows is what the product does.
//      That is also why provenance is marked through the environment rather
//      than an argument — see envProvenance() in receipt/store.js.
//   3. When live cannot run, it names which of the known reasons applied and
//      falls back to the replay in the open (D43). Never a silent substitution.
//
// One deliberate departure from the degrade taxonomy: if the AGENT succeeded
// and only the JUDGE failed, live does NOT fall back. A real receipt from real
// work already exists at that point, and throwing it away to play a recording
// would be trading proof for theatre. It reports the missing verdict instead.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readMeta, jobStatus, jobDir } from '../jobs/store.js';
import { transcriptDir } from '../transcript.js';
import { recordReceipt } from '../receipt/record.js';
import { judge as defaultJudge } from '../receipt/judge.js';
import { verifyFile, readEntries, provenanceOf } from '../receipt/store.js';
import { projectPaths, demoPaths } from '../paths.js';

/**
 * The task the agent is given.
 *
 * Chosen so the record can answer some of its claims and honestly cannot answer
 * others. Creating the files leaves file evidence; running the tests leaves a
 * command invocation but NOT its outcome — so "the tests passed" is a claim the
 * judge should rule UNVERIFIABLE, live, in front of the person watching.
 *
 * That moment is the product. A tool that scored the unknowable would be
 * guessing, and a guessing verifier is worse than none.
 */
export const LIVE_TASK = [
  'In this directory, do all of the following:',
  '1. Create sum.js — an ES module exporting `export function sum(a, b)` that returns a + b.',
  '2. Create sum.test.js — a node:test suite importing sum.js with two cases: sum(2, 2) and sum(-1, 1).',
  '3. Run the suite with `node --test`.',
  'Then reply in plain prose: say what you created and whether the tests passed.',
  'Keep it short. Do not install anything, do not touch any other directory, do not run git.',
].join('\n');

/** A short label for the task, for the header — the full prompt is not the point. */
export const LIVE_TASK_SUMMARY = 'write sum.js + a test for it, run the test, report back';

/**
 * Exactly what the agent is allowed to do, by name. Writing files and running
 * one command — nothing else, on a machine that is not ours.
 *
 * This is the whole reason live does not use bypassPermissions. The screen
 * promises the agent can only write files in the sandbox; a mode that lets it
 * run arbitrary commands anywhere would make that sentence false, and a demo
 * whose safety copy is false is worse than no demo.
 */
export const LIVE_ALLOWED_TOOLS = ['--allowedTools', 'Write', 'Edit', 'Read', 'Bash(node --test*)'];

/** How long live waits before it stops waiting. Real work is unpredictable; a demo is not. */
export function liveTimeoutMs(env = process.env) {
  const n = Number(env.PRAXIS_DEMO_LIVE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 240000;
}

/**
 * A throwaway working directory, seeded so it looks like a project rather than
 * an empty void. `git init` is attempted and its failure is ignored — git is
 * optional everywhere else in PRAXIS and must be optional here too.
 */
export function makeSandbox({ root = os.tmpdir(), git = true } = {}) {
  const dir = fs.mkdtempSync(path.join(root, 'praxis-live-'));
  fs.writeFileSync(
    path.join(dir, 'README.md'),
    [
      '# praxis live demo sandbox',
      '',
      'Throwaway. Created by `praxis demo --live` so an agent could do real work',
      'somewhere that is not your project. Delete it whenever you like.',
      '',
    ].join('\n'),
  );
  if (git) {
    try {
      spawnSync('git', ['init', '-q'], { cwd: dir, timeout: 10000, windowsHide: true });
    } catch {
      /* git is optional — the receipt just carries no git evidence */
    }
  }
  return dir;
}

/**
 * Why a live run ended without a receipt, in the taxonomy's own words.
 *
 * The agent CLI's own stderr is the only signal that separates "not signed in"
 * from "crashed", and it matters: one is a two-minute fix the reader can do,
 * the other is a bug report.
 */
export function classifyLiveFailure({ status, meta, output = '' } = {}) {
  const text = String(output).toLowerCase();
  // Deliberately narrow. A bare /login/ would match unrelated output and send
  // someone off to fix an account that was never the problem.
  const AUTH =
    /not logged in|unauthenticated|invalid api key|no api key|missing api key|authentication (failed|required)|please run[^\n]{0,24}login|\/login\b|claude login/;
  if (AUTH.test(text)) return 'cli-unauthenticated';
  const src = String((meta && meta.exitSource) || '');
  if (/spawn-failed|agent-error|runner-spawn-failed/.test(src)) return 'spawn-failed';
  if (/timeout-cap/.test(src)) return 'timed-out';
  if (status === 'gone') return 'spawn-failed';
  return 'nothing-sealed';
}

/** The job's own words, for classification — err.log first, it carries the reason. */
export function jobOutput(praxisDir, id) {
  const read = (f) => {
    try {
      return fs.readFileSync(path.join(jobDir(praxisDir, id), f), 'utf8');
    } catch {
      return '';
    }
  };
  return (read('err.log') + '\n' + read('out.log')).slice(-4000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for a job to stop running. Returns the terminal status, or 'timeout'.
 * Every dependency is injectable so the wait can be tested in milliseconds
 * without a real agent anywhere near it.
 */
export async function waitForJob(
  praxisDir,
  id,
  {
    timeoutMs = liveTimeoutMs(),
    pollMs = 700,
    onTick = () => {},
    shouldAbort = () => false,
    read = readMeta,
    status = jobStatus,
    wait = sleep,
    clock = () => Date.now(),
  } = {},
) {
  const started = clock();
  for (;;) {
    const meta = read(praxisDir, id);
    const s = meta ? status(meta) : 'unknown';
    if (s !== 'running') return { status: s, meta, elapsedMs: clock() - started };
    // Ctrl-C must stop the agent, not just stop watching it. A detached job the
    // user thinks they cancelled, quietly spending their tokens in a temp
    // directory, is exactly the behavior this product exists to argue against.
    if (shouldAbort()) return { status: 'abort', meta, elapsedMs: clock() - started };
    const elapsed = clock() - started;
    if (elapsed >= timeoutMs) return { status: 'timeout', meta, elapsedMs: elapsed };
    onTick(elapsed);
    await wait(pollMs);
  }
}

/**
 * Wait out the gap between a job finishing and its receipt existing.
 *
 * The runner stamps the exit code first and seals the receipt second, so a
 * watcher that reads meta the instant a job stops running sees a finished job
 * with no receipt and concludes — wrongly — that nothing was sealed. This waits
 * for the runner's `receiptLinkedAt` stamp, which is written whether or not a
 * receipt could be produced, so the honest "there is no receipt" answer still
 * arrives promptly.
 */
export async function awaitReceiptLink(
  praxisDir,
  id,
  { timeoutMs = 20000, pollMs = 120, read = readMeta, wait = sleep, clock = () => Date.now() } = {},
) {
  const started = clock();
  for (;;) {
    const meta = read(praxisDir, id);
    if (meta && meta.receiptLinkedAt) return meta;
    if (clock() - started >= timeoutMs) return meta || null;
    await wait(pollMs);
  }
}

/** Stop a job that has outstayed its welcome. Best-effort by construction. */
export function killJob(meta) {
  for (const pid of [meta && meta.agentPid, meta && meta.pid]) {
    if (!pid) continue;
    try {
      process.kill(pid);
    } catch {
      /* already gone, or not ours to kill */
    }
  }
}

/**
 * Copy the sealed receipt somewhere that outlives the sandbox.
 *
 * The sandbox lives in the OS temp directory, which the OS is entitled to empty
 * whenever it likes. The receipt is the one thing the person is supposed to
 * keep, so it gets a home outside any project and outside temp — the same home
 * the replay uses, and the reason demoPaths() exists at all.
 *
 * A byte copy is the right move: the chain and the signature are properties of
 * the file's contents, so a copied receipt verifies exactly as the original
 * does. Re-sealing it would be re-writing history to change its address.
 */
export function preserveReceipt(srcFile, destDir = demoPaths().receiptsDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(srcFile));
  fs.copyFileSync(srcFile, dest);
  return dest;
}

/**
 * What the verdict means, and what it does not (D61).
 *
 * The most dangerous misreading of PRAXIS is "TRUE means the code is good."
 * It never does. These lines are load-bearing, which is why they are a pure
 * function with a test rather than three strings inside a render loop.
 */
export function boundaryLines({ hadUnverifiable = false } = {}) {
  const lines = [
    'It compares what the agent SAID against what the session record SHOWS. It is not a review of the code.',
  ];
  if (hadUnverifiable) {
    lines.push(
      'UNVERIFIABLE is not a failure — it is PRAXIS refusing to score what it cannot see. A command in the record proves it was attempted, never that it succeeded.',
    );
  }
  lines.push('The record names the channels it harvested and never claims to be complete, so absence is never treated as a lie.');
  return lines;
}

/** Did any claim come back UNVERIFIABLE? Drives the boundary copy above. */
export function hasUnverifiable(verdicts) {
  return (verdicts || []).some((v) => v && v.verdict === 'UNVERIFIABLE');
}

/**
 * Run the whole live loop.
 *
 * Returns a result the caller renders; it deliberately does no printing of its
 * own beyond the injected `onEvent`, so the CLI, a test and a future UI all
 * drive the identical path.
 *
 * @returns {Promise<{ok:boolean, reason?:string, detail?:string, sandbox:string,
 *   receipt?:{file:string, id:string, verdict:string, verdicts:Array, verification:object, provenance:string},
 *   judged?:boolean, judgeError?:string, elapsedMs:number}>}
 */
export async function runLive({
  startJob,
  sandbox = makeSandbox(),
  timeoutMs = liveTimeoutMs(),
  judgeFn = defaultJudge,
  onEvent = () => {},
  now = () => new Date().toISOString(),
  clock = () => Date.now(),
  transcriptHome = process.env.PRAXIS_TRANSCRIPT_HOME || undefined,
  keepDir = demoPaths().receiptsDir,
  waitOpts = {},
} = {}) {
  const started = clock();
  const p = projectPaths(sandbox);
  const done = (r) => ({ sandbox, elapsedMs: clock() - started, ...r });

  // The provenance mark travels to the detached runner through the environment,
  // so the receipt the JOB seals is already stamped before we ever see it.
  const prevProvenance = process.env.PRAXIS_RECEIPT_PROVENANCE;
  process.env.PRAXIS_RECEIPT_PROVENANCE = 'demo-live';
  try {
    onEvent({ kind: 'start', sandbox });

    // acceptEdits, not the usual safe draft: the agent has to actually write
    // the files for there to be anything to verify.
    //
    // acceptEdits alone is not enough — it pre-approves file edits and nothing
    // else, so the first real run watched the agent get denied `node --test`
    // four times. The fix is NOT bypassPermissions: that would let the agent run
    // anything anywhere and make the demo's own promise ("files in that folder
    // ONLY") a lie on screen. So exactly one command is allowed by name.
    let job;
    try {
      job = await startJob({ task: LIVE_TASK, tool: 'claude', mode: 'acceptEdits', cwd: sandbox, extraArgs: LIVE_ALLOWED_TOOLS });
    } catch (e) {
      return done({ ok: false, reason: 'spawn-failed', detail: e && e.message });
    }
    if (!job || job.error) {
      const reason = job && job.error === 'no-adapter' ? 'no-agent-cli' : 'spawn-failed';
      return done({ ok: false, reason, detail: job && job.error });
    }

    const waited = await waitForJob(p.praxisDir, job.id, {
      timeoutMs,
      onTick: (ms) => onEvent({ kind: 'tick', elapsedMs: ms }),
      ...waitOpts,
    });

    if (waited.status === 'timeout' || waited.status === 'abort') {
      killJob(waited.meta || {});
      return done({ ok: false, reason: waited.status === 'abort' ? 'user-abort' : 'timed-out', jobId: job.id });
    }

    // Failure is classified from the job's own words; there is no point waiting
    // on a receipt for a run that never got far enough to have one.
    if (waited.status !== 'done' && waited.status !== 'draft') {
      const cls = classifyLiveFailure({
        status: waited.status,
        meta: waited.meta || readMeta(p.praxisDir, job.id) || {},
        output: jobOutput(p.praxisDir, job.id),
      });
      return done({ ok: false, reason: cls, jobId: job.id });
    }

    const meta = (await awaitReceiptLink(p.praxisDir, job.id)) || waited.meta || {};

    // The runner already sealed an evidence-only receipt when the job closed —
    // free, instant, zero model calls. That is v1, and it is real proof already.
    if (!meta.receiptId || !meta.sessionId) {
      return done({ ok: false, reason: 'nothing-sealed', jobId: job.id });
    }
    onEvent({ kind: 'sealed', receiptId: meta.receiptId });

    const tFile = path.join(transcriptDir(sandbox, transcriptHome), meta.sessionId + '.jsonl');
    let transcript;
    try {
      transcript = fs.readFileSync(tFile, 'utf8');
    } catch {
      return done({ ok: false, reason: 'nothing-sealed', detail: 'the session transcript could not be read', jobId: job.id });
    }

    // v2: the same evidence, now with the judge's ruling on it. This is exactly
    // what `praxis receipt --verify` does for a real session — the demo is not
    // taking a shortcut the product does not have.
    onEvent({ kind: 'judging' });
    const judged = await recordReceipt(
      p.receiptsDir,
      { text: transcript, sessionId: meta.sessionId },
      { project: path.basename(sandbox), now: now(), verify: true, judge: judgeFn },
    );

    const file = path.join(p.receiptsDir, `${judged.id}.v${latestOf(p.receiptsDir, judged.id)}.jsonl`);
    let kept;
    try {
      kept = preserveReceipt(file, keepDir);
    } catch {
      kept = file; // temp is where it stays, then — still real, still verifiable
    }

    const verification = verifyFile(kept);
    const provenance = provenanceOf(readEntries(kept));

    return done({
      ok: true,
      jobId: job.id,
      judged: judged.verified,
      judgeError: judged.judgeError,
      receipt: {
        id: judged.id,
        file: kept,
        sandboxFile: file,
        verdict: judged.verdict,
        verdicts: judged.verdicts || [],
        summary: judged.summary,
        verification,
        provenance,
      },
    });
  } finally {
    if (prevProvenance === undefined) delete process.env.PRAXIS_RECEIPT_PROVENANCE;
    else process.env.PRAXIS_RECEIPT_PROVENANCE = prevProvenance;
  }
}

/** Newest version number on disk for a receipt id — the one just written. */
function latestOf(receiptsDir, id) {
  let best = 1;
  try {
    for (const f of fs.readdirSync(receiptsDir)) {
      const m = new RegExp(`^${id}\\.v(\\d+)\\.jsonl$`).exec(f);
      if (m) best = Math.max(best, Number(m[1]));
    }
  } catch {
    /* fall back to v1 */
  }
  return best;
}
