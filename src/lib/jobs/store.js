// The job store — Mission Control's ledger of background agent work.
//
// A job is one task handed to an AI agent to do WITHOUT you watching: PRAXIS
// spawns the agent CLI detached, its output streams to files, and this store
// remembers what was asked, who ran it, and how it ended. Jobs survive the
// terminal that started them; the deck (`praxis jobs`) reads this ledger.
//
// Layout: .praxis/jobs/<id>/meta.json + out.log + err.log
// The id is time-ordered (sortable) + random tail (collision-proof).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function jobsDir(praxisDir) {
  return path.join(praxisDir, 'jobs');
}

export function newJobId(now = new Date()) {
  const t = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14); // yyyymmddhhmmss
  return 'j-' + t + '-' + crypto.randomBytes(2).toString('hex');
}

export function jobDir(praxisDir, id) {
  return path.join(jobsDir(praxisDir), id);
}

/**
 * Write meta.json.
 *
 * Two processes own this file: the CLI that starts a job, and the detached
 * runner it spawns. The obvious hardening — write a temp file and rename over
 * the target — was tried and REVERTED, and the reason is worth keeping: on
 * Windows a rename onto a path another process holds open throws EPERM, so it
 * converted a rare read race into a frequent write failure. Measured: the suite
 * went from failing about one run in three to failing every run.
 *
 * A single small writeFileSync is the lesser evil here, paired with a tolerant
 * reader below. If this ever needs to be truly atomic it needs a lock, not a
 * rename.
 */
export function writeMetaAtomic(file, meta) {
  fs.writeFileSync(file, JSON.stringify(meta, null, 2));
}

/** Create the job's folder + meta before spawn. Returns paths the runner uses. */
export function createJob(praxisDir, { id, task, tool, argv, cwd, now }) {
  const dir = jobDir(praxisDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const meta = {
    id,
    task: String(task),
    tool,
    argv,
    cwd,
    startedAt: now || new Date().toISOString(),
    pid: null,
    endedAt: null,
    exitCode: null,
  };
  writeMetaAtomic(path.join(dir, 'meta.json'), meta);
  return { dir, metaFile: path.join(dir, 'meta.json'), outFile: path.join(dir, 'out.log'), errFile: path.join(dir, 'err.log') };
}

/**
 * Sleep, synchronously, for a couple of milliseconds.
 *
 * readMeta is sync and called from sync render paths, so the usual answer
 * (await a timer) is not available. Atomics.wait on a throwaway buffer is the
 * one honest way to pause a synchronous function in Node.
 */
function pauseSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* SharedArrayBuffer unavailable: fall through and just retry immediately */
  }
}

/**
 * The retry policy, separated from the filesystem so it can be tested for what
 * it actually promises rather than by racing a real process.
 *
 * Proving "the second read wins" against a live detached child is not something
 * a test can do honestly: Node's own startup is tens of milliseconds, longer
 * than the window being tested, so such a test measures process boot and calls
 * it a race. Injecting the read makes the contract checkable in microseconds.
 *
 * @param {() => string} readFn returns the file's contents, or throws
 * @param {(ms: number) => void} pauseFn
 */
export function readMetaWith(readFn, pauseFn = pauseSync) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const meta = JSON.parse(readFn());
      // Valid JSON without an id is a partial write that happened to parse.
      // Treat it as not-yet-there rather than as truth.
      if (meta && typeof meta === 'object' && meta.id) return meta;
    } catch {
      /* mid-write, denied, or genuinely absent — the retry decides which */
    }
    if (!attempt) pauseFn(5);
  }
  return null;
}

export function readMeta(praxisDir, id) {
  const file = path.join(jobDir(praxisDir, id), 'meta.json');
  // Two processes own this file — the CLI that starts a job and the detached
  // runner it spawns — and writeMeta is a plain writeFileSync, because the
  // rename-based fix was tried and reverted (see above: on Windows it turned a
  // rare read race into a constant write failure).
  //
  // So the reader has to absorb the race, and the previous version could not:
  // it retried TWICE IN A TIGHT LOOP, microseconds apart, which is no wait at
  // all. A file caught mid-write failed both attempts and returned null — and
  // listJobs turns a null into `{ id, status: 'unknown' }`, a row with no task
  // name, no mode and no goal. The deck then shows a job that looks like it
  // never existed, for no reason other than having been glanced at while it was
  // being written. Backing off across a few attempts costs ~15 ms in the worst
  // case and nothing at all in the common one, because the first read wins.
  // ONE retry, after a real pause. The write window is a single writeFileSync
  // of a few hundred bytes — sub-millisecond — so one wait clears it. More
  // attempts would not help: Windows timer granularity is ~15.6 ms, so every
  // pause costs at least that whatever you ask for, and listJobs calls this
  // once PER JOB. Four retries measured 62 ms on a file that was never going to
  // become readable, which would make `praxis jobs` crawl for anyone holding a
  // single corrupt job directory. Bounded at one.
  return readMetaWith(() => fs.readFileSync(file, 'utf8'));
}

export function updateMeta(praxisDir, id, patch) {
  const meta = readMeta(praxisDir, id);
  if (!meta) return null;
  const next = { ...meta, ...patch };
  writeMetaAtomic(path.join(jobDir(praxisDir, id), 'meta.json'), next);
  return next;
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0); // signal 0 = existence check, no effect
    return true;
  } catch {
    return false;
  }
}

/**
 * A job's honest status, derived — never trusted from stale meta alone:
 *  running   — the recorded pid is still alive
 *  draft     — finished a SAFE-DRAFT run (plan mode) and awaits your call:
 *              approve to execute, deny to close. THE INBOX STATE.
 *  done      — recorded exit 0
 *  failed    — recorded non-zero exit
 *  gone      — no exit recorded and the pid is dead (crash, kill, reboot)
 * 'gone' matters: a Mission Control that shows a dead job as "running"
 * forever is lying — the exact failure mode cloud dashboards have.
 */
export const JOB_STARTUP_GRACE_MS = 10000;

export function jobStatus(meta, now = Date.now()) {
  if (!meta) return 'unknown';
  if (meta.exitCode === 0) {
    if (meta.mode === 'plan' && meta.approval === 'pending') return 'draft';
    return 'done';
  }
  if (meta.exitCode != null) return 'failed';
  if (pidAlive(meta.pid)) return 'running';

  // A job whose runner has not recorded its pid YET is starting, not dead.
  //
  // createJob writes `pid: null` and the detached runner patches the real pid
  // in a moment later. Between those two writes, pidAlive(null) is false and
  // this used to answer 'gone' — so a job that had just been launched read as
  // crashed. The demo's live mode maps 'gone' straight to 'spawn-failed', which
  // is how a perfectly healthy run reported that the agent had failed to start,
  // 449 ms after starting it. Mission Control calling a live job dead is the
  // same lie as calling a dead one running, just in the other direction.
  //
  // A REAL spawn failure is not covered by this grace and does not need to be:
  // the runner records exitCode -1 with exitSource 'spawn-failed', so it is
  // caught above by the exitCode branch within milliseconds.
  if (meta.pid == null) {
    const started = Date.parse(meta.startedAt || '');
    if (Number.isFinite(started) && now - started < JOB_STARTUP_GRACE_MS) return 'running';
  }
  return 'gone';
}

/** All jobs, newest first (ids are time-ordered by construction). */
export function listJobs(praxisDir) {
  let ids;
  try {
    ids = fs.readdirSync(jobsDir(praxisDir)).filter((d) => d.startsWith('j-'));
  } catch {
    return [];
  }
  return ids
    .sort()
    .reverse()
    .map((id) => {
      const meta = readMeta(praxisDir, id);
      return meta ? { ...meta, status: jobStatus(meta) } : { id, status: 'unknown' };
    });
}

/** Last N lines of the job's output — the glance, not the archive. */
export function tailOutput(praxisDir, id, lines = 12) {
  try {
    const text = fs.readFileSync(path.join(jobDir(praxisDir, id), 'out.log'), 'utf8');
    return text.split('\n').filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}
