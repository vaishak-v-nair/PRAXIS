import fs from 'node:fs';

// Hook commands require `praxis` on PATH (npm install -g praxis-memory).
// Without it the hooks fail silently and /praxis-save still covers capture.
//
// - Stop:         capture the session into memory when it ends
// - PreCompact:   snapshot BEFORE Claude squeezes the session (detail rescue)
// - SessionStart: make sure the tray companion is up the moment Claude starts
//                 (health must be ambient, not a command you remember to run)
const HOOKS = {
  Stop: 'praxis capture',
  PreCompact: 'praxis capture',
  SessionStart: 'praxis tray --ensure',
};

/**
 * Add PRAXIS's hooks to .claude/settings.json without disturbing any hooks
 * the user (or another tool) already configured. Idempotent per event.
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
  for (const [event, command] of Object.entries(HOOKS)) {
    settings.hooks[event] = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    if (!JSON.stringify(settings.hooks[event]).includes(command)) {
      settings.hooks[event].push({ hooks: [{ type: 'command', command }] });
      added++;
    }
  }

  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  return { already: added === 0 };
}
