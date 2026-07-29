import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectPaths } from './paths.js';

// Hook commands go through `npx -y praxis-memory` on purpose: it works
// whether the user installed globally OR only ever ran `npx praxis-memory`.
// (Bare `praxis` broke every session for npx-only users: the SessionStart
// and Stop hooks failed with "praxis: command not found".)
// `-y` skips npx's install prompt — hooks run non-interactively.
//
// - Stop:         capture the session into memory when it ends
// - PreCompact:   snapshot BEFORE Claude squeezes the session (detail rescue)
// - SessionStart: make sure the tray companion is up the moment Claude starts
//                 (health must be ambient, not a command you remember to run)
const RUNNER = 'npx -y praxis-memory';
const HOOKS = {
  Stop: 'capture',
  PreCompact: 'capture',
  SessionStart: 'tray --ensure',
};

/** Does this settings file already carry PRAXIS's hooks? */
export function hasPraxisHooks(file) {
  try {
    return fs.readFileSync(file, 'utf8').includes('praxis-memory capture');
  } catch {
    return false;
  }
}

/**
 * How many people have committed here.
 *
 * A repo with one author is somebody's own project, and asking them to choose
 * a sharing scope for an audience of one is noise. More than one author means
 * a decision with consequences for people who are not in the room, and those
 * get asked about. Errors and non-repos count as solo — the quiet default is
 * also the safe one.
 */
export function contributorCount(cwd = process.cwd()) {
  try {
    const r = spawnSync('git', ['log', '--format=%aE', '-n', '200'], {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    if (r.status !== 0 || !r.stdout) return 1;
    const authors = new Set(
      String(r.stdout)
        .split('\n')
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean),
    );
    return Math.max(1, authors.size);
  } catch {
    return 1;
  }
}

/**
 * Where this project's hooks should be written, and whether to ask first.
 *
 * The rules, in order:
 *   1. An existing PRAXIS install keeps the file it already uses. Upgrades
 *      never silently move somebody's hooks out from under them, and never
 *      leave the same hook in two files firing twice.
 *   2. No TTY (CI, a piped installer, a hook calling init) takes the private
 *      default without asking. A prompt nobody can answer must never block,
 *      and must never resolve itself by picking the more public option.
 *   3. A solo repo takes the private default silently. There is no one else
 *      to consult.
 *   4. Anything else asks.
 *
 * @returns {{file:string, scope:'local'|'project', ask:boolean, reason:string}}
 */
export function resolveHookScope(cwd = process.cwd(), { interactive = false, contributors } = {}) {
  const p = projectPaths(cwd);
  if (hasPraxisHooks(p.settingsFile)) {
    return { file: p.settingsFile, scope: 'project', ask: false, reason: 'already installed for the project' };
  }
  if (hasPraxisHooks(p.settingsLocalFile)) {
    return { file: p.settingsLocalFile, scope: 'local', ask: false, reason: 'already installed for you' };
  }
  if (!interactive) {
    return { file: p.settingsLocalFile, scope: 'local', ask: false, reason: 'no prompt available — took the private default' };
  }
  const n = contributors ?? contributorCount(cwd);
  if (n <= 1) {
    return { file: p.settingsLocalFile, scope: 'local', ask: false, reason: 'solo repo' };
  }
  return { file: p.settingsLocalFile, scope: 'local', ask: true, reason: `${n} contributors` };
}

/**
 * Keep the personal settings file out of git.
 *
 * A settings.local.json that gets committed is the exact bug this whole scope
 * split exists to prevent, so the ignore line is part of choosing "just me"
 * rather than a courtesy. Never rewrites an existing rule; appends only when
 * nothing already covers it.
 */
export function ignoreLocalSettings(cwd = process.cwd()) {
  const file = path.join(cwd, '.gitignore');
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    /* no .gitignore yet — we make one */
  }
  if (/^\s*\.claude\/settings\.local\.json\s*$/m.test(raw) || /^\s*\.claude\/\*?\s*$/m.test(raw)) {
    return { already: true };
  }
  const block = '\n# PRAXIS: your personal hooks — never commit these onto teammates\n.claude/settings.local.json\n';
  fs.writeFileSync(file, raw ? raw.replace(/\s*$/, '\n') + block : block.replace(/^\n/, ''));
  return { already: false, created: !raw };
}

/**
 * Add PRAXIS's hooks to a settings file without disturbing any hooks
 * the user (or another tool) already configured. Idempotent per event.
 * Also repairs hooks written by older versions as bare `praxis <cmd>`,
 * which fail when no global `praxis` shim exists.
 */
export function patchSettings(settingsFile, { repairOnly = false } = {}) {
  // repairOnly is what the no-args front door uses. It fixes legacy bare-`praxis`
  // commands in a file that ALREADY has hooks, and adds nothing. Without it the
  // front door would create a second copy of every hook in the shared file for
  // anyone whose hooks live in the personal one — firing capture twice a session
  // and undoing the scope choice they made at install.
  if (repairOnly && !hasPraxisHooks(settingsFile) && !fs.existsSync(settingsFile)) {
    return { already: true, repaired: 0, skipped: true };
  }
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8') || '{}');
  } catch {
    settings = {};
  }
  if (typeof settings !== 'object' || settings === null) settings = {};

  settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};

  let added = 0;
  let repaired = 0;
  for (const [event, sub] of Object.entries(HOOKS)) {
    const command = `${RUNNER} ${sub}`;
    const legacy = `praxis ${sub}`;
    // In repair mode, leave events that were never configured alone. Creating
    // an empty array for each one writes noise into a file we were only asked
    // to fix, and this file may be the user's own hand-edited settings.
    if (repairOnly && !Array.isArray(settings.hooks[event])) continue;
    settings.hooks[event] = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    for (const entry of settings.hooks[event]) {
      if (!entry || !Array.isArray(entry.hooks)) continue;
      for (const h of entry.hooks) {
        if (h && h.command === legacy) {
          h.command = command;
          repaired++;
        }
      }
    }
    if (!repairOnly && !JSON.stringify(settings.hooks[event]).includes(command)) {
      settings.hooks[event].push({ hooks: [{ type: 'command', command }] });
      added++;
    }
  }
  if (repairOnly && !repaired) return { already: true, repaired: 0 };

  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  return { already: added === 0 && repaired === 0, repaired };
}
