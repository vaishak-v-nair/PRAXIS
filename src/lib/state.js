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

/**
 * Read the breadcrumb back.
 *
 * It stopped being only cosmetic the moment the doctor started using it: the
 * two phases are written at opposite ends of the capture loop ('switching'
 * first, 'restored' last, both unconditionally), which makes them a free
 * liveness signal. A recent 'restored' means capture ran all the way through.
 * An old 'switching' means it started and died somewhere in the middle — the
 * one thing a swallowed error could never tell anybody.
 *
 * @returns {{phase: string, ts: string, ageMs: number}|null}
 */
export function readState(praxisDir, now = Date.now()) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(praxisDir, 'state.json'), 'utf8'));
    if (!s || typeof s.phase !== 'string') return null;
    const t = Date.parse(s.ts);
    return { phase: s.phase, ts: s.ts, ageMs: Number.isFinite(t) ? Math.max(0, now - t) : Infinity };
  } catch {
    return null;
  }
}
