// `praxis run "<task>"` — hand a task to an AI agent and get your terminal back.
//
// Mission Control's first verb. A detached RUNNER survives this command (and
// the terminal); the agent is the runner's own child, so exit codes are real.
// `praxis jobs` is the deck; `praxis approve` is the inbox.
//
// The safety model: the default run is a SAFE DRAFT (plan mode) — questions
// get answered, write tasks produce a plan, nothing on disk is touched.
// Execution happens only through `praxis approve` (or explicit flags).
// Injectable via PRAXIS_RUN_CMD for tests and other tools.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  // one adapter today; codex/gemini adapters are the roadmap, same shape.
  // json output carries session_id — how a job finds its own transcript and
  // seals its receipt (the deck's "done" vs "proven" columns).
  if (tool === 'claude') return ['claude', '-p', '--output-format', 'json'];
  return null;
}

/**
 * Start a detached agent job. The engine behind `praxis run` AND `praxis
 * approve` (which starts the execution twin of an approved draft).
 *
 * mode is the safety story:
 *   'plan'        — SAFE DRAFT (default): questions get answered, write tasks
 *                   produce a plan, NOTHING on disk is touched.
 *   'acceptEdits' — execute: file edits pre-approved (the approve flow).
 *   'bypassPermissions' — full auto, everything allowed (--full-auto, loud).
 */
export async function startJob({ task, tool = 'claude', mode = 'plan', approvedFrom = null, cwd }) {
  const p = projectPaths(cwd);
  const base = resolveRunCmd(tool);
  if (!base) return { error: 'no-adapter' };

  // permission flags only apply to the real claude adapter — an injected
  // test/other-tool command gets exactly the argv it asked for
  const argvFull = process.env.PRAXIS_RUN_CMD ? base : [...base, '--permission-mode', mode];

  const id = newJobId();
  const { dir } = createJob(p.praxisDir, { id, task, tool, argv: argvFull, cwd: p.root });
  updateMeta(p.praxisDir, id, { mode, approval: mode === 'plan' ? 'pending' : 'none', approvedFrom });
  fs.writeFileSync(path.join(dir, 'task.txt'), task); // stdin payload, no quoting minefield

  // the RUNNER is the detached survivor; the agent is the runner's own child,
  // so the exit code stamped into meta is REAL — no done-because-it-printed
  // heuristics (a job that died on an API error must read FAILED).
  const runnerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'jobs', 'runner.mjs');
  let runner;
  try {
    runner = spawn(process.execPath, [runnerPath, dir], {
      detached: true, // survives this CLI and the terminal that called it
      stdio: 'ignore', // the runner owns the job's log files itself
      env: { ...process.env, PRAXIS_JOB_ID: id },
    });
  } catch (e) {
    updateMeta(p.praxisDir, id, { exitCode: -1, endedAt: new Date().toISOString(), exitSource: 'runner-spawn-failed' });
    return { error: 'spawn: ' + (e && e.message), id };
  }
  updateMeta(p.praxisDir, id, { pid: runner.pid });
  runner.unref();
  return { id };
}

export async function run(argv = []) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const positional = argv.filter((a) => !a.startsWith('--'));
  const task = positional.join(' ').trim();
  const c = praxisCmd();

  if (!task) {
    console.log('\n  ' + bold('praxis run "<task>"') + grey(' — hand a task to an agent, keep your terminal.'));
    console.log('  ' + grey('default  ') + 'SAFE DRAFT — questions get answered; write tasks produce a plan, nothing is touched');
    console.log('  ' + grey('flags    ') + '--allow-edits' + grey(' (file edits pre-approved) · ') + '--full-auto' + grey(' (everything allowed — trusted repos only)'));
    console.log('  ' + grey('then     ') + `${c} jobs` + grey(' — the deck · ') + `${c} approve <id>` + grey(' — execute a draft') + '\n');
    return;
  }

  const tool = flags.has('--codex') ? 'codex' : flags.has('--gemini') ? 'gemini' : 'claude';
  const mode = flags.has('--full-auto') ? 'bypassPermissions' : flags.has('--allow-edits') ? 'acceptEdits' : 'plan';

  if (mode === 'bypassPermissions') {
    console.log('\n  ' + rose('! full auto:') + ' the agent may run commands and edit anything here, unattended.');
  }

  const r = await startJob({ task, tool, mode });
  if (r.error === 'no-adapter') {
    console.log('\n  ' + rose('No adapter for ' + tool + ' yet') + grey(' — claude runs today; codex and gemini adapters are on the roadmap.') + '\n');
    process.exitCode = 1;
    return;
  }
  if (r.error) {
    console.log('\n  ' + rose('Could not start the agent: ') + r.error + '\n');
    process.exitCode = 1;
    return;
  }

  console.log('\n  ' + sage('✓') + ' job ' + bold(r.id) + ' started — ' + grey(tool + ' is working on it in the background'));
  console.log('  ' + grey('task     ') + task.slice(0, 90) + (task.length > 90 ? '…' : ''));
  if (mode === 'plan') {
    console.log('  ' + grey('safety   ') + 'safe draft — if this task changes anything, you get a plan to approve first');
  }
  console.log('  ' + grey('watch    ') + `${c} jobs` + grey('   · output: .praxis/jobs/' + r.id + '/out.log'));
  console.log('  ' + grey('Your terminal is yours again. The job survives closing it.') + '\n');
}

