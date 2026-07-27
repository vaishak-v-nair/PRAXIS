// `praxis run "<task>"` — hand a task to an AI agent and get your terminal back.
//
// Mission Control's first verb. The agent CLI is spawned DETACHED with its
// output streaming to the job's own log files, so the job survives this
// command exiting (and the terminal closing). `praxis jobs` is the deck where
// you watch it land.
//
// v0 honesty: the job runs with the agent CLI's DEFAULT permissions — an
// unattended agent that can edit anything is a decision, not a default. Tasks
// that need write access will pause or fail until the permission story ships
// (deck approvals). Injectable via PRAXIS_RUN_CMD for tests and other tools.

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { projectPaths } from '../lib/paths.js';
import { newJobId, createJob, updateMeta } from '../lib/jobs/store.js';
import { bold, grey, sage, rose } from '../lib/ui.js';
import { praxisCmd } from '../lib/runner.js';

/** Resolve the agent argv for a tool name. PRAXIS_RUN_CMD (JSON array) wins. */
export function resolveRunCmd(tool = 'claude') {
  const inj = process.env.PRAXIS_RUN_CMD;
  if (inj && inj.trim()) {
    try {
      const arr = JSON.parse(inj);
      if (Array.isArray(arr) && arr.length) return arr.map(String);
    } catch {
      return inj.trim().split(/\s+/);
    }
  }
  // one adapter today; codex/gemini adapters are the roadmap, same shape
  if (tool === 'claude') return ['claude', '-p', '--output-format', 'text'];
  return null;
}

// Windows can't spawn .cmd shims directly without a shell (EINVAL).
function toSpawn(argv) {
  const [cmd, ...args] = argv;
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)) {
    return { file: process.env.ComSpec || 'cmd.exe', args: ['/c', cmd, ...args] };
  }
  return { file: cmd, args };
}

export async function run(argv = []) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const positional = argv.filter((a) => !a.startsWith('--'));
  const task = positional.join(' ').trim();
  const p = projectPaths();

  if (!task) {
    console.log('\n  ' + bold('praxis run "<task>"') + grey(' — hand a task to an agent, keep your terminal.'));
    console.log('  ' + grey('example: ') + 'praxis run "write release notes for the last 5 commits into NOTES.md"');
    console.log('  ' + grey('then:    ') + `${praxisCmd()} jobs` + grey('  — the deck: every job, status, and its receipt') + '\n');
    return;
  }

  const tool = flags.has('--codex') ? 'codex' : flags.has('--gemini') ? 'gemini' : 'claude';
  const base = resolveRunCmd(tool);
  if (!base) {
    console.log('\n  ' + rose('No adapter for ' + tool + ' yet') + grey(' — claude runs today; codex and gemini adapters are on the roadmap.') + '\n');
    process.exitCode = 1;
    return;
  }

  const id = newJobId();
  const { outFile, errFile } = createJob(p.praxisDir, { id, task, tool, argv: base, cwd: p.root });

  const out = fs.openSync(outFile, 'a');
  const err = fs.openSync(errFile, 'a');
  const { file, args } = toSpawn(base);

  let child;
  try {
    child = spawn(file, args, {
      cwd: p.root,
      detached: true, // survives this CLI and the terminal that called it
      stdio: ['pipe', out, err],
      env: { ...process.env, PRAXIS_JOB_ID: id },
    });
  } catch (e) {
    updateMeta(p.praxisDir, id, { exitCode: -1, endedAt: new Date().toISOString() });
    console.log('\n  ' + rose('Could not start the agent: ') + (e && e.message) + '\n');
    process.exitCode = 1;
    return;
  }

  child.on('error', () => {
    try {
      updateMeta(p.praxisDir, id, { exitCode: -1, endedAt: new Date().toISOString() });
    } catch {
      /* best effort */
    }
  });

  updateMeta(p.praxisDir, id, { pid: child.pid });

  // the task goes in on stdin — no shell-quoting minefield, no argv length limit
  try {
    child.stdin.write(task);
    child.stdin.end();
  } catch {
    /* error handler above records it */
  }

  // watcher: a lightweight sibling that records the exit code when the agent
  // finishes, even though THIS process is about to exit. Also detached.
  try {
    const watcher = spawn(process.execPath, ['-e', WATCHER_SRC], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, PRAXIS_WATCH_PID: String(child.pid), PRAXIS_WATCH_META: p.praxisDir + '/jobs/' + id + '/meta.json' },
    });
    watcher.unref();
  } catch {
    /* without a watcher the deck still shows running/gone honestly */
  }

  child.unref();

  console.log('\n  ' + sage('✓') + ' job ' + bold(id) + ' started — ' + grey(tool + ' is working on it in the background'));
  console.log('  ' + grey('task     ') + task.slice(0, 90) + (task.length > 90 ? '…' : ''));
  console.log('  ' + grey('watch    ') + `${praxisCmd()} jobs` + grey('   · output: .praxis/jobs/' + id + '/out.log'));
  console.log('  ' + grey('Your terminal is yours again. The job survives closing it.') + '\n');
}

// The watcher polls the agent pid; when it dies, it stamps endedAt (+ exit 0
// heuristic: out.log grew and no error marker → we can't read the real exit
// code of a process we didn't parent, so record 0 when output exists, -1 when
// the log is empty). Honest limitation, noted in meta as exitSource.
const WATCHER_SRC = `
const fs = require('fs');
const pid = Number(process.env.PRAXIS_WATCH_PID);
const metaFile = process.env.PRAXIS_WATCH_META;
function alive(p){ try { process.kill(p,0); return true; } catch { return false; } }
const t = setInterval(() => {
  if (alive(pid)) return;
  clearInterval(t);
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile,'utf8'));
    if (meta.exitCode == null) {
      let size = 0;
      try { size = fs.statSync(metaFile.replace(/meta\\.json$/,'out.log')).size; } catch {}
      meta.exitCode = size > 0 ? 0 : -1;
      meta.exitSource = 'watcher-heuristic';
      meta.endedAt = new Date().toISOString();
      fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
    }
  } catch {}
  process.exit(0);
}, 1500);
setTimeout(() => process.exit(0), 6 * 60 * 60 * 1000); // watcher never outlives 6h
`;
