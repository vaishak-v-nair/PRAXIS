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
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return { dir, metaFile: path.join(dir, 'meta.json'), outFile: path.join(dir, 'out.log'), errFile: path.join(dir, 'err.log') };
}

export function readMeta(praxisDir, id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(jobDir(praxisDir, id), 'meta.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function updateMeta(praxisDir, id, patch) {
  const meta = readMeta(praxisDir, id);
  if (!meta) return null;
  const next = { ...meta, ...patch };
  fs.writeFileSync(path.join(jobDir(praxisDir, id), 'meta.json'), JSON.stringify(next, null, 2));
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
 *  done      — recorded exit 0
 *  failed    — recorded non-zero exit
 *  gone      — no exit recorded and the pid is dead (crash, kill, reboot)
 * 'gone' matters: a Mission Control that shows a dead job as "running"
 * forever is lying — the exact failure mode cloud dashboards have.
 */
export function jobStatus(meta) {
  if (!meta) return 'unknown';
  if (meta.exitCode === 0) return 'done';
  if (meta.exitCode != null) return 'failed';
  if (pidAlive(meta.pid)) return 'running';
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
