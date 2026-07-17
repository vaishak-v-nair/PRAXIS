// Tiered-consent telemetry, tier 2: anonymous usage COUNTS only, opt-in.
// The schema is the security boundary: keys are enum-shaped ([a-z0-9_]),
// values are numbers — there is no field a secret, a path, or a line of the
// user's code could fit in. Content (tier 1) never has a pipe at all.
// TELEMETRY_ENDPOINT empty = nothing is ever sent, regardless of consent.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// Receiver: a Cloudflare Worker that validates the schema server-side and
// forwards to storage the client has no credentials for. The client ships a
// URL and NOTHING else — no key of any kind.
export const TELEMETRY_ENDPOINT = 'https://praxis-pvt.vaishak-v-nair-dev.workers.dev';
export const TELEMETRY_KEY = ''; // deliberately empty: no key ever ships in this package

const FILE =
  process.env.PRAXIS_TELEMETRY_FILE ||
  path.join(os.homedir(), '.config', 'praxis', 'telemetry.json');

const SEND_EVERY_MS = 24 * 60 * 60 * 1000;
const KEY_RE = /^[a-z0-9_]{1,40}$/; // enum-shaped keys only — content can't sneak in

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return null;
  }
}

function save(s) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(s, null, 2) + '\n');
  } catch {
    /* telemetry must never break the product */
  }
}

export function telemetryState() {
  return load() || { enabled: false, decided: false, id: null, counts: {}, lastSent: 0 };
}

/** Opt in/out. Opting out wipes the counters AND the install id — no residue. */
export function setTelemetry(enabled) {
  const s = telemetryState();
  s.enabled = !!enabled;
  s.decided = true;
  if (enabled && !s.id) s.id = crypto.randomUUID();
  if (!enabled) {
    s.counts = {};
    s.id = null;
  }
  save(s);
  return s;
}

/** Count one event. No-op unless the user opted in. Never throws. */
export function record(key) {
  try {
    if (!KEY_RE.test(key)) return;
    const s = telemetryState();
    if (!s.enabled) return;
    s.counts[key] = (s.counts[key] || 0) + 1;
    save(s);
  } catch {
    /* never break the product */
  }
}

/** The EXACT payload that would be sent — what `praxis telemetry show` prints. */
export function payload(version = '') {
  const s = telemetryState();
  return {
    v: 1,
    id: s.id,
    os: process.platform,
    node: (process.version.match(/^v\d+/) || [''])[0],
    version: String(version).slice(0, 20),
    counts: s.counts,
  };
}

/** Send at most once a day, only if opted in AND an endpoint exists. */
export async function flush(version = '') {
  try {
    if (!TELEMETRY_ENDPOINT) return false;
    const s = telemetryState();
    if (!s.enabled || !Object.keys(s.counts).length) return false;
    if (Date.now() - (s.lastSent || 0) < SEND_EVERY_MS) return false;
    const headers = { 'content-type': 'application/json' };
    if (TELEMETRY_KEY) {
      headers.apikey = TELEMETRY_KEY;
      headers.authorization = 'Bearer ' + TELEMETRY_KEY;
    }
    await fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ payload: payload(version) }),
      signal: AbortSignal.timeout(3000),
    });
    s.lastSent = Date.now();
    s.counts = {};
    save(s);
    return true;
  } catch {
    return false; // offline/blocked = silently keep counting locally
  }
}
