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
 * Capture's OWN liveness record — `.praxis/capture.json`.
 *
 * This exists because the first version of the "Capture ran" check read
 * state.json, which four commands write: capture, checkpoint (five times),
 * switch, and trace. That produced exactly the failure the check was built to
 * end. `praxis checkpoint` wrote `restored` and doctor then reported a
 * successful capture that never happened — a FALSE GREEN, which is worse than
 * no check at all, because it actively tells you the thing is fine. An
 * unrelated vault error in checkpoint reported as capture failing, the same
 * mistake in the other direction.
 *
 * state.json stays what it always was: a shared breadcrumb for the tray, which
 * genuinely wants to know context is moving whoever moved it. Liveness is a
 * narrower claim and needs a file with exactly one writer.
 *
 * @param {string} praxisDir
 * @param {'started'|'done'} phase
 * @param {{error?: {phase: string, message: string, at: string}}} [extra]
 */
export function writeCaptureState(praxisDir, phase, extra = {}) {
  try {
    fs.writeFileSync(
      path.join(praxisDir, 'capture.json'),
      JSON.stringify({ phase, ts: new Date().toISOString(), ...extra }) + '\n',
    );
  } catch {
    /* best-effort: a hook must never fail on its own bookkeeping */
  }
}

/** @returns {{phase: string, ts: string, ageMs: number, error?: object}|null} */
export function readCaptureState(praxisDir, now = Date.now()) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(praxisDir, 'capture.json'), 'utf8'));
    if (!s || typeof s.phase !== 'string') return null;
    const t = Date.parse(s.ts);
    return { ...s, ageMs: Number.isFinite(t) ? Math.max(0, now - t) : Infinity };
  } catch {
    return null;
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
