import fs from 'node:fs';

// Command the Stop hook runs. Requires `praxis` on PATH (global install or
// `npm link`). If it is not, auto-capture is skipped silently and the user can
// still run `/praxis-save` in-session. See README "Auto-capture".
const HOOK_COMMAND = 'praxis capture';

/**
 * Add PRAXIS's Stop hook to .claude/settings.json without disturbing any hooks
 * the user (or another tool) already configured. Idempotent.
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
  settings.hooks.Stop = Array.isArray(settings.hooks.Stop) ? settings.hooks.Stop : [];

  const already = JSON.stringify(settings.hooks.Stop).includes(HOOK_COMMAND);
  if (!already) {
    settings.hooks.Stop.push({
      hooks: [{ type: 'command', command: HOOK_COMMAND }],
    });
  }

  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  return { already };
}
