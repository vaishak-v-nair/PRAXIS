import fs from 'node:fs';

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

/**
 * Add PRAXIS's hooks to .claude/settings.json without disturbing any hooks
 * the user (or another tool) already configured. Idempotent per event.
 * Also repairs hooks written by older versions as bare `praxis <cmd>`,
 * which fail when no global `praxis` shim exists.
 */
export function patchSettings(settingsFile) {
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
    if (!JSON.stringify(settings.hooks[event]).includes(command)) {
      settings.hooks[event].push({ hooks: [{ type: 'command', command }] });
      added++;
    }
  }

  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  return { already: added === 0 && repaired === 0, repaired };
}
