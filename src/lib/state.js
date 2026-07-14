import fs from 'node:fs';
import path from 'node:path';

/**
 * Breadcrumb for the tray companion: which phase the capture loop is in.
 * Written best-effort — state is cosmetic, it must never break a hook.
 * @param {string} praxisDir
 * @param {'switching'|'restored'} phase
 */
export function writeState(praxisDir, phase) {
  try {
    fs.writeFileSync(
      path.join(praxisDir, 'state.json'),
      JSON.stringify({ phase, ts: new Date().toISOString() }) + '\n',
    );
  } catch {
    /* cosmetic only */
  }
}
