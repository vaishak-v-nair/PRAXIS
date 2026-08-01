// What PRAXIS does when PRAXIS itself breaks.
//
// The capture hook runs at the end of every session on every install, and it is
// wrapped so that nothing it does can crash the user's Claude session. That
// part is right and stays. The part that was missing is the other half: an
// error that is swallowed leaves no trace anywhere, so a broken capture looks
// exactly like a working one. Memory just quietly stops growing, and the first
// person to find out is the user, weeks later, asking Claude about last month.
//
// PRAXIS's whole argument is that presence proves ATTEMPTED and evidence proves
// DONE. This file applies that standard to PRAXIS. Swallowing the error is
// still correct; swallowing it *silently* was not.
//
// One file, last error only — never a growing log. A hook that appends on every
// failure turns a broken transcript reader into a disk-filling one.

import fs from 'node:fs';
import path from 'node:path';

export const ERROR_FILE = 'last-error.json';

/** Trim a stack to something a human reads and a file can hold. */
function briefStack(err) {
  const raw = err && err.stack ? String(err.stack) : '';
  return raw.split('\n').slice(0, 6).join('\n');
}

/**
 * Leave a record that something was swallowed.
 *
 * Best-effort by definition: this is called from inside catch blocks on the
 * hook path, so it must never throw. If it cannot write, the behaviour is
 * exactly what it was before this file existed.
 *
 * @param {string} praxisDir  the project's .praxis directory
 * @param {string} phase      where it broke, in words a user could act on
 * @param {unknown} err       the thing that was caught
 * @param {{version?: string, now?: Date}} [meta]
 */
export function recordError(praxisDir, phase, err, meta = {}) {
  try {
    if (!fs.existsSync(praxisDir)) return false;
    const e = err instanceof Error ? err : new Error(String(err));
    fs.writeFileSync(
      path.join(praxisDir, ERROR_FILE),
      JSON.stringify(
        {
          phase,
          message: e.message || String(err),
          code: e.code || null,
          stack: briefStack(e),
          at: (meta.now || new Date()).toISOString(),
          version: meta.version || null,
        },
        null,
        2,
      ) + '\n',
    );
    return true;
  } catch {
    // If we cannot even record the failure, there is nothing further to try.
    return false;
  }
}

/**
 * An expected absence: this file might legitimately not be here, carry on.
 *
 * `catch { }` says nothing about WHY. Half the swallowed errors in this
 * codebase are a config that has not been written yet or a transcript line that
 * is half-flushed — correct to ignore, and correct to say so at the call site.
 * The other half were real failures wearing the same clothes, which is how a
 * broken capture stayed invisible for months. Naming the two apart is the
 * point; the fallback is what the caller wanted when nothing was there.
 */
export function ifMissing(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * A real failure we are choosing not to crash on — recorded, not discarded.
 *
 * For the places where continuing is right but silence is not: the vault mirror
 * on an unmounted drive, MCP registration on a locked file, a receipt that
 * could not be sealed. The user keeps working; `praxis doctor` can still tell
 * them what stopped happening and when.
 */
export function swallow(fn, { praxisDir, phase, fallback = null } = {}) {
  try {
    return fn();
  } catch (e) {
    if (praxisDir) recordError(praxisDir, phase || 'unknown', e);
    return fallback;
  }
}

/** The last swallowed error, or null. Never throws. */
export function readLastError(praxisDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(praxisDir, ERROR_FILE), 'utf8'));
    return raw && typeof raw === 'object' && raw.phase ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Forget the last error, because a later run got all the way through.
 *
 * Without this, one bad session would show a fault forever and the check would
 * become the thing people learn to ignore. A stale alarm is worse than none —
 * the same reasoning that took memory-fill off the tray glow.
 */
export function clearLastError(praxisDir) {
  try {
    fs.rmSync(path.join(praxisDir, ERROR_FILE), { force: true });
    return true;
  } catch {
    return false;
  }
}
