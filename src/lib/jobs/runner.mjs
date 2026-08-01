#!/usr/bin/env node
// The job runner — the detached parent that gives Mission Control REAL exit
// codes. `praxis run` spawns THIS (detached, survives the terminal); this
// spawns the agent as its own child, feeds the task on stdin, waits, and
// stamps the true exit code into meta.json. No heuristics: a job that died
// on an API error is FAILED, never "done because it printed something".
//
// argv: node runner.mjs <jobDir>

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = process.argv[2];
const metaFile = path.join(dir, 'meta.json');

function patchMeta(patch) {
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    // Deliberately a plain write, matching the store — see writeMetaAtomic
    // there for why the temp-file-and-rename version was reverted.
    fs.writeFileSync(metaFile, JSON.stringify({ ...meta, ...patch }, null, 2));
  } catch {
    /* the deck degrades to pid-liveness if meta is unreadable */
  }
}

let meta;
try {
  meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
} catch (e) {
  process.exit(1);
}

const task = (() => {
  try {
    return fs.readFileSync(path.join(dir, 'task.txt'), 'utf8');
  } catch {
    return meta.task || '';
  }
})();

const out = fs.openSync(path.join(dir, 'out.log'), 'a');
const err = fs.openSync(path.join(dir, 'err.log'), 'a');

// Windows can't spawn .cmd/.bat directly without a shell (EINVAL)
const [cmd, ...args] = meta.argv || [];
const isCmdShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd || '');
const file = isCmdShim ? process.env.ComSpec || 'cmd.exe' : cmd;
const fargs = isCmdShim ? ['/c', cmd, ...args] : args;

let child;
try {
  child = spawn(file, fargs, { windowsHide: true, cwd: meta.cwd || undefined, stdio: ['pipe', out, err] });
} catch (e) {
  patchMeta({ exitCode: -1, endedAt: new Date().toISOString(), exitSource: 'spawn-failed: ' + (e && e.message) });
  process.exit(0);
}

patchMeta({ agentPid: child.pid });

child.on('error', (e) => {
  patchMeta({ exitCode: -1, endedAt: new Date().toISOString(), exitSource: 'agent-error: ' + (e && e.message) });
  process.exit(0);
});

// long jobs are the point, runaway jobs are not — hard cap, disclosed
const capMs = Number(process.env.PRAXIS_JOB_TIMEOUT_MS) || 6 * 60 * 60 * 1000;
const cap = setTimeout(() => {
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  patchMeta({ exitCode: -1, endedAt: new Date().toISOString(), exitSource: 'timeout-cap' });
  setTimeout(() => process.exit(0), 500);
}, capMs);

child.on('close', async (code) => {
  clearTimeout(cap);
  patchMeta({ exitCode: code == null ? -1 : code, endedAt: new Date().toISOString(), exitSource: 'runner' });
  // the fusion: a finished job seals its own receipt (evidence-only, free).
  // Dynamic import + catch-all: a broken receipt layer must never break jobs.
  let linked = {};
  try {
    const { sealJobReceipt } = await import(new URL('./receipt-link.js', import.meta.url));
    linked = (await sealJobReceipt(path.join(dir, '..', '..'), { id: path.basename(dir), cwd: meta.cwd })) || {};
  } catch {
    /* deck shows the job without a receipt — honest either way */
  }
  // Stamped unconditionally, even when nothing could be linked. Exit code lands
  // BEFORE this work, so anything watching for the job to finish sees "done" a
  // beat before the receipt exists — and concludes there is no receipt. This
  // field is the difference between "no receipt" and "not yet".
  patchMeta({ ...linked, receiptLinkedAt: new Date().toISOString() });
  process.exit(0);
});

try {
  child.stdin.write(task);
  child.stdin.end();
} catch {
  /* close/error handlers record the outcome */
}
