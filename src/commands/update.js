// `praxis update` — bring an existing install up to date.
//
//   praxis update            refresh this project, report what else is stale
//   praxis update --check    report only, change nothing
//   praxis update --global   also upgrade the `praxis` on your PATH
//
// The honest headline is that most people need nothing: hooks and the MCP
// server resolve `npx -y praxis-memory` fresh every session, so they are always
// on the newest release. What goes stale is the global shim and the slash
// commands copied into a project at init time — and a release that ADDS a
// command never reaches projects that already exist, so those users simply
// never find out it is there.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { projectPaths } from '../lib/paths.js';
import { updatePlan } from '../lib/update.js';
import { praxisCmd } from '../lib/runner.js';
import { miniHeader, sage, amber, rose, bold, grey, dim } from '../lib/ui.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(HERE, '..', 'templates');

/**
 * Run a tool that ships as a .cmd shim on Windows (npm, praxis).
 *
 * Two constraints meet here. Windows cannot exec a .cmd or .bat directly —
 * execFile gives EINVAL — and `shell: true` is deprecated (DEP0190) precisely
 * because it CONCATENATES arguments instead of escaping them, which node now
 * warns the user about on every run. Handing the shim to cmd.exe with the args
 * still in an array satisfies both: it runs, and nothing is string-joined.
 *
 * This is the same trick src/lib/jobs/runner.mjs uses for agent shims. One
 * problem, one answer.
 */
function runTool(bin, args, opts = {}) {
  // windowsHide is forced HERE, last, so no caller can turn it off even by
  // accident. A missing one pops a console window on somebody's desktop, and no
  // assertion can see that happen — which is why the suite checks the source,
  // and why it wants to read the guarantee at the call itself rather than trust
  // that a variable three lines up still contains it.
  if (process.platform === 'win32') {
    return execFileSync(process.env.ComSpec || 'cmd.exe', ['/c', bin, ...args], { ...opts, windowsHide: true });
  }
  return execFileSync(bin, args, { ...opts, windowsHide: true });
}

export function pkgVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

/** The `praxis-*.md` templates this build ships. The directory is the list. */
export function shippedTemplates(dir = TEMPLATES) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('praxis-') && f.endsWith('.md'))
      .sort();
  } catch {
    return [];
  }
}

/** What a directory currently has installed. */
export function installedCommands(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('praxis-') && f.endsWith('.md'))
      .sort();
  } catch {
    return [];
  }
}

/**
 * The newest published version, or null when the registry cannot be reached.
 *
 * Deliberately short-timeout and never fatal: an update command that fails
 * because someone is on a train is a worse experience than one that says so and
 * gets on with the parts it can do offline.
 */
export function latestPublished({ timeout = 15000 } = {}) {
  try {
    const out = runTool('npm', ['view', 'praxis-memory', 'version'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const v = String(out).trim();
    return /^\d+\.\d+\.\d+/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** The version of the `praxis` shim on PATH, or null when there is no global install. */
export function globalVersion({ timeout = 15000 } = {}) {
  if (praxisCmd() !== 'praxis') return null; // no shim on PATH — nothing global to be stale
  try {
    const out = runTool('praxis', ['--version'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const v = String(out).trim();
    return /^\d+\.\d+\.\d+/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export async function update(args = []) {
  const checkOnly = args.includes('--check') || args.includes('--dry-run');
  const doGlobal = args.includes('--global');
  const p = projectPaths();
  const running = pkgVersion();

  console.log('\n  ' + miniHeader(running, 'update') + '\n');

  const shipped = shippedTemplates();
  const here = installedCommands(p.commandsDir);
  const inProject = fs.existsSync(p.praxisDir);

  // Only meaningful inside a project — otherwise there is nothing local to sync.
  const missing = inProject ? shipped.filter((f) => !here.includes(f)) : [];
  const retired = inProject ? here.filter((f) => !shipped.includes(f)) : [];

  const plan = updatePlan({
    running,
    latest: latestPublished(),
    global: globalVersion(),
    missingCommands: missing.map((f) => '/' + f.replace(/\.md$/, '')),
    retiredCommands: retired.map((f) => '/' + f.replace(/\.md$/, '')),
  });

  // ── where things stand ───────────────────────────────────────────────────
  console.log('  ' + bold('running   ') + running + (plan.behind ? grey('  (this copy)') : ''));
  console.log(
    '  ' + bold('published ') + (plan.latest || grey('unknown — registry unreachable')) +
      (plan.behind ? '  ' + amber('← newer') : plan.latest ? '  ' + sage('✓') : ''),
  );
  if (plan.global) console.log('  ' + bold('on PATH   ') + plan.global);
  console.log('');

  for (const n of plan.notes) console.log('  ' + sage('✓') + ' ' + n.text);

  if (plan.upToDate) {
    console.log('\n  ' + bold('Nothing to do.') + grey(' Everything here is current.') + '\n');
    return 0;
  }

  console.log('\n  ' + bold('Needs updating:'));
  for (const a of plan.actions) console.log('    ' + amber('•') + ' ' + a.why);

  if (checkOnly) {
    console.log('\n  ' + dim('--check: nothing was changed.') + '\n');
    return 0;
  }

  // ── the part this command can do itself ──────────────────────────────────
  const did = [];
  if (inProject && (missing.length || retired.length)) {
    try {
      fs.mkdirSync(p.commandsDir, { recursive: true });
      // Rewrite every shipped template, not just the missing ones: a command
      // whose CONTENT changed in a release is otherwise stale forever.
      for (const name of shipped) {
        fs.copyFileSync(path.join(TEMPLATES, name), path.join(p.commandsDir, name));
      }
      // Retired ones go. init never removed them, which is how praxis-cost,
      // praxis-roi and praxis-hud outlived the 0.11.0 release that deleted them.
      for (const name of retired) fs.rmSync(path.join(p.commandsDir, name), { force: true });
      did.push(
        `.claude/commands — ${shipped.length} refreshed` +
          (retired.length ? `, ${retired.length} retired removed` : ''),
      );
    } catch (e) {
      console.log('\n  ' + amber('!') + ' could not refresh the slash commands: ' + (e && e.message));
    }

    // Same in the user-wide directory, so every project sees the new commands.
    try {
      const userCmds = path.join(os.homedir(), '.claude', 'commands');
      if (fs.existsSync(userCmds)) {
        for (const name of shipped) fs.copyFileSync(path.join(TEMPLATES, name), path.join(userCmds, name));
        for (const name of installedCommands(userCmds).filter((f) => !shipped.includes(f))) {
          fs.rmSync(path.join(userCmds, name), { force: true });
        }
        did.push('~/.claude/commands — the same, for every project');
      }
    } catch {
      /* user scope is best-effort; the project copy is what matters */
    }
  }

  const globalAction = plan.actions.find((a) => a.id === 'global');
  if (globalAction) {
    if (doGlobal) {
      console.log('\n  ' + grey('running ') + rose(globalAction.run) + grey(' …'));
      try {
        runTool('npm', ['install', '-g', 'praxis-memory'], {
          windowsHide: true,
          stdio: 'inherit',
          timeout: 180000,
        });
        did.push(`the \`praxis\` on your PATH — now ${plan.latest}`);
      } catch (e) {
        console.log('  ' + amber('!') + ' that failed: ' + (e && e.message));
        console.log('  ' + dim('run it yourself, or keep using ') + rose('npx -y praxis-memory') + dim(' which is always current.'));
      }
    } else {
      console.log(
        '\n  ' + bold('One command left, and it is yours to run:') + '\n    ' + rose(globalAction.run) +
          grey('   (or ') + rose(`${praxisCmd()} update --global`) + grey(')'),
      );
      console.log('  ' + dim('Not run for you: a global install changes a tool outside this project.'));
    }
  }

  if (did.length) {
    console.log('\n  ' + bold('Updated:'));
    for (const d of did) console.log('    ' + sage('✓') + ' ' + d);
    if (missing.length) console.log('\n  ' + dim('Restart Claude Code to pick up new slash commands.'));
  }
  console.log('');
  return 0;
}
