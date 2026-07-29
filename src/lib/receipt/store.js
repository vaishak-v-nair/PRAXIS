// The receipt store — the spine of PRAXIS receipts.
//
// A receipt is one Claude Code session's proof-of-work: a hash-chained,
// Ed25519-signed JSONL file where every line links to the one before it, so a
// finalized receipt is tamper-EVIDENT (an agent, tool, or later process cannot
// quietly rewrite history without breaking the chain). It is NOT third-party
// proof — the keyholder signs their own receipts; see RECEIPT-SPEC.md.
//
//   open ──▶ append ──▶ append ──▶ … ──▶ finalize (signs the chain head)
//    │         │                              │
//    ▼         ▼                              ▼
//  line 0    evidence lines            final line + signature
//  {t:open}  {t:evidence}              {t:final, sig}
//
// Locked design (from /plan-eng-review, 2026-07-23):
//  - id = r-<8hex sha256(sessionId)>: derived, so retro capture and the Stop
//    hook can never double-create (idempotent upsert keyed by session id).
//  - Appending after a receipt is finalized opens a NEW version, never mutates.
//  - Ed25519 key is generated lazily at first sign with an O_EXCL create, so
//    upgraders who never ran `praxis init` still get a key, and two concurrent
//    finalizers cannot fork it.
//  - Reads tolerate a partial trailing line (a crash mid-append) by dropping it.
//
// Never throws on the hook path except where a caller must branch (finalized
// receipts reject appends with a typed result, they do not throw).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { redact } from '../redact.js';

/**
 * On-disk format version, written as `v` on the open line.
 *
 * v1 → v2 (0.10.0) adds two things and removes nothing:
 *   - `provenance` on the open line: null for real work, "demo-replay" or
 *     "demo-live" for a receipt the demo produced. It lives on line 0, so the
 *     chain and the final signature cover it — a demo receipt cannot be
 *     relabelled as real work without breaking verification. That is why it is
 *     a sealed field and not a screen label.
 *   - `sig.pub`: the signer's public key, so a receipt can be verified by
 *     someone who does not hold the private key. See the note on verifyFile.
 *
 * THE ABSENCE RULE: a receipt with no `provenance` field was sealed before
 * 0.10.0 and is treated as REAL. Demo receipts cannot lack the field by
 * construction, so absence can never mean "demo".
 */
export const SCHEMA_VERSION = 2;

/** Deterministic JSON: keys sorted at every level, so a payload hashes and
 *  re-hashes to the same string regardless of insertion order. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function sha256hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Receipt id for a Claude Code session — stable, so the same session always
 *  maps to the same receipt (idempotency by construction). */
export function receiptId(sessionId) {
  return 'r-' + sha256hex(String(sessionId || 'unknown')).slice(0, 8);
}

/** Version 1 is `<id>.jsonl`; later versions are `<id>.vN.jsonl`. */
export function receiptFile(receiptsDir, id, version = 1) {
  return path.join(receiptsDir, version <= 1 ? `${id}.jsonl` : `${id}.v${version}.jsonl`);
}

/** Highest existing version number for an id (0 if none). */
export function latestVersion(receiptsDir, id) {
  let v = 0;
  if (fs.existsSync(receiptFile(receiptsDir, id, 1))) v = 1;
  for (let n = 2; n < 1000; n++) {
    if (fs.existsSync(receiptFile(receiptsDir, id, n))) v = n;
    else break;
  }
  return v;
}

/** Parse a receipt file into entries, dropping a partial trailing line left by
 *  a crash mid-append (every complete line is valid JSON; a torn one is not). */
export function readEntries(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // torn trailing line — stop; nothing valid can follow it
      break;
    }
  }
  return out;
}

function chainHash(prevHash, payload) {
  return sha256hex((prevHash || '') + stableStringify(payload));
}

/** Build a signed/hashed entry from a bare payload and append it to `file`.
 *  Redaction runs on the serialized payload BEFORE it is hashed or written, so
 *  what is hashed is exactly what is stored (at rest, not just at egress). */
function writeEntry(file, prevHash, payload, sig) {
  const redacted = JSON.parse(redact(stableStringify(payload)));
  const hash = chainHash(prevHash, redacted);
  const entry = sig ? { ...redacted, hash, sig } : { ...redacted, hash };
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  return entry;
}

function isFinal(entries) {
  return entries.length > 0 && entries[entries.length - 1].t === 'final';
}

function headHash(entries) {
  return entries.length ? entries[entries.length - 1].hash : null;
}

/**
 * Provenance inherited from the environment.
 *
 * The demo's LIVE mode seals through the SAME job engine every real run uses
 * (D33). Marking those receipts by argument would mean threading a demo-only
 * concern through the shared engine — run → meta → runner → receipt-link — for
 * one caller's benefit. An inherited variable does it in one line, and the
 * runner already inherits the demo's environment.
 *
 * Safe by direction: this can only mark work as LESS real than it is. The
 * pattern accepts nothing but `demo…`, so the dangerous direction — something
 * fabricated posing as real — is not reachable from here. It stays closed by
 * the absence rule, which the demo can never exploit because the demo always
 * sets the field.
 */
export function envProvenance(env = process.env) {
  const v = String(env.PRAXIS_RECEIPT_PROVENANCE || '').trim();
  return /^demo(-[a-z]+)?$/.test(v) ? v : null;
}

/**
 * Open (or resume) the receipt for a session. Idempotent: if an unfinalized
 * receipt for this session already exists, its head is returned and nothing is
 * written. If the latest version is finalized, a new version is started so a
 * resumed session never mutates a sealed receipt.
 *
 * @returns {{id:string, version:number, file:string, created:boolean}}
 */
export function open(receiptsDir, { sessionId, project, baseRef = null, parent = null, now, provenance = null }) {
  fs.mkdirSync(receiptsDir, { recursive: true });
  const id = receiptId(sessionId);
  let version = latestVersion(receiptsDir, id);

  if (version >= 1) {
    const cur = readEntries(receiptFile(receiptsDir, id, version));
    if (!isFinal(cur)) {
      return { id, version, file: receiptFile(receiptsDir, id, version), created: false };
    }
    version += 1; // latest is sealed — start the next version
  } else {
    version = 1;
  }

  const file = receiptFile(receiptsDir, id, version);
  writeEntry(file, null, {
    t: 'open',
    v: SCHEMA_VERSION,
    id,
    version,
    sessionId: String(sessionId),
    project: project || null,
    baseRef,
    parent: parent || (version > 1 ? `${id}.v${version - 1}` : null),
    openedAt: now || null,
    provenance: provenance || envProvenance(),
  });
  return { id, version, file, created: true };
}

/**
 * Append one evidence entry to the open receipt. Returns `{ok:true}` on success
 * or `{ok:false, finalized:true}` if the receipt is already sealed — the caller
 * then re-opens a new version rather than mutating history.
 */
export function append(receiptsDir, id, evidence, version) {
  const v = version || latestVersion(receiptsDir, id);
  const file = receiptFile(receiptsDir, id, v);
  const entries = readEntries(file);
  if (!entries.length) return { ok: false, missing: true };
  if (isFinal(entries)) return { ok: false, finalized: true };
  const entry = writeEntry(file, headHash(entries), { t: 'evidence', ...evidence });
  return { ok: true, hash: entry.hash };
}

// ── signing key (per-machine, lazy, race-safe) ─────────────────────────────

function keyDir() {
  return process.env.PRAXIS_KEY_DIR || path.join(os.homedir(), '.praxis', 'keys');
}

/** Load the machine Ed25519 key, generating it on first use. The O_EXCL ('wx')
 *  create means if two finalizers race, exactly one writes the key and the
 *  loser falls through to read the winner's — the ledger never forks a key. */
/** Block this thread briefly — the only way to wait inside a sync API. */
function nap(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Read a key file that a racing process may be a few milliseconds from writing.
 *
 * The exclusive-create on the private key decides the winner, but the loser
 * returns from that failure and immediately reads BOTH files — and the winner
 * has not necessarily written the public one yet. Without this, two sessions
 * ending at the same moment on a machine with no key yet could crash one of
 * them on ENOENT. Rare, and a crash in the middle of sealing evidence is
 * exactly the wrong place to be rare.
 */
function readKeyWithRetry(file, attempts = 50, waitMs = 20) {
  for (let i = 0; ; i++) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes('-----END')) return text; // never parse a half-written PEM
      if (i >= attempts) return text;
    } catch (e) {
      if (i >= attempts || (e.code !== 'ENOENT' && e.code !== 'EBUSY' && e.code !== 'EPERM')) throw e;
    }
    nap(waitMs);
  }
}

export function ensureKey() {
  const dir = keyDir();
  const priv = path.join(dir, 'ed25519.pkcs8.pem');
  const pub = path.join(dir, 'ed25519.spki.pem');
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(priv)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
    try {
      fs.writeFileSync(priv, privPem, { flag: 'wx' }); // fails if another proc won
      // Publish the public half atomically: a loser that arrives mid-write must
      // never read a truncated PEM and conclude the key is corrupt.
      const staging = `${pub}.${process.pid}.tmp`;
      fs.writeFileSync(staging, pubPem);
      fs.renameSync(staging, pub);
    } catch (e) {
      if (!(e && e.code === 'EEXIST')) throw e; // real error, not a lost race
    }
  }
  const privateKey = crypto.createPrivateKey(readKeyWithRetry(priv));
  const publicKey = crypto.createPublicKey(readKeyWithRetry(pub));
  const fingerprint = sha256hex(publicKey.export({ type: 'spki', format: 'der' }).toString('hex')).slice(0, 16);
  return { privateKey, publicKey, fingerprint };
}

/**
 * Finalize (seal + sign) the receipt. Idempotent: a receipt that already has a
 * final entry is returned unchanged, never re-signed. The signature covers the
 * chain-head hash, which transitively covers every prior line.
 */
export function finalize(receiptsDir, id, { verdict = 'UNVERIFIED', claims = [], now } = {}, version) {
  const v = version || latestVersion(receiptsDir, id);
  const file = receiptFile(receiptsDir, id, v);
  const entries = readEntries(file);
  if (!entries.length) return { ok: false, missing: true };
  if (isFinal(entries)) {
    const last = entries[entries.length - 1];
    return { ok: true, already: true, hash: last.hash, sig: last.sig };
  }
  const prevHash = headHash(entries);
  const payload = { t: 'final', verdict, claims, finalizedAt: now || null };
  // hash first (over redacted canonical), then sign the hash
  const redacted = JSON.parse(redact(stableStringify(payload)));
  const hash = chainHash(prevHash, redacted);
  const { privateKey, publicKey, fingerprint } = ensureKey();
  const signature = crypto.sign(null, Buffer.from(hash, 'hex'), privateKey).toString('base64');
  // The public key travels with the receipt (v2). Without it, only the machine
  // that sealed a receipt could check its signature — which would make the
  // offline verifier and the PR check useless on anyone else's evidence.
  // It changes no guarantee: the threat model already says a keyholder signs
  // their own receipts and a fresh key can fabricate a corpus. What this buys
  // is that the check is possible at all, and that a SWITCHED key is visible.
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const entry = { ...redacted, hash, sig: { alg: 'ed25519', key: fingerprint, pub, signature } };
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  return { ok: true, hash, sig: entry.sig };
}

/**
 * Verify a receipt: every line's chain hash recomputes, and (if finalized) the
 * signature checks against the recorded public key. Returns a structured result
 * rather than throwing so callers can render a degraded verdict.
 */
export function verify(receiptsDir, id, version) {
  const v = version || latestVersion(receiptsDir, id);
  return verifyEntries(readEntries(receiptFile(receiptsDir, id, v)));
}

/**
 * What kind of work produced this receipt.
 *
 * THE ABSENCE RULE (v1 receipts predate the field): missing means REAL. Demo
 * receipts always carry the field, so absence can never be a demo hiding.
 * @returns {'real'|'demo-replay'|'demo-live'|string}
 */
export function provenanceOf(entries) {
  const openEntry = (entries || []).find((e) => e && e.t === 'open');
  if (!openEntry) return 'real';
  if (!Object.prototype.hasOwnProperty.call(openEntry, 'provenance')) return 'real';
  return openEntry.provenance || 'real';
}

/** True for anything the demo produced — never counted as evidence of real work. */
export function isDemo(entries) {
  return String(provenanceOf(entries)).startsWith('demo');
}

/** The chain-and-signature core, shared by every verification surface. */
export function verifyEntries(entries) {
  if (!entries || !entries.length) return { ok: false, reason: 'empty-or-missing' };

  let prev = null;
  for (let i = 0; i < entries.length; i++) {
    const { hash, sig, ...payload } = entries[i];
    if (chainHash(prev, payload) !== hash) {
      return { ok: false, reason: 'chain-broken', at: i };
    }
    prev = hash;
  }

  const last = entries[entries.length - 1];
  const provenance = provenanceOf(entries);
  if (last.t !== 'final') return { ok: true, finalized: false, chain: true, provenance };

  if (!last.sig || !last.sig.signature) {
    return { ok: false, finalized: true, chain: true, provenance, reason: 'no-signature' };
  }

  try {
    let publicKey;
    let embedded = false;
    if (last.sig.pub) {
      // v2: the signer's key travels with the receipt — verifiable anywhere.
      publicKey = crypto.createPublicKey({
        key: Buffer.from(last.sig.pub, 'base64'),
        format: 'der',
        type: 'spki',
      });
      embedded = true;
    } else {
      // v1: no key on board, so this can only be checked on the machine that
      // sealed it. Elsewhere it reports honestly rather than failing red.
      publicKey = ensureKey().publicKey;
    }
    const good = crypto.verify(
      null,
      Buffer.from(last.hash, 'hex'),
      publicKey,
      Buffer.from(last.sig.signature, 'base64'),
    );
    return {
      ok: good,
      finalized: true,
      chain: true,
      signature: good,
      provenance,
      keyFingerprint: last.sig.key || null,
      embeddedKey: embedded,
      reason: good ? undefined : embedded ? 'signature-invalid' : 'signature-unverifiable-here',
    };
  } catch {
    return { ok: false, finalized: true, chain: true, provenance, reason: 'signature-error' };
  }
}

/**
 * Verify a receipt FILE — the offline path. Zero network, zero model calls,
 * zero cost: recompute every chain hash, then check the signature against the
 * key the receipt carries. This is what a stranger runs on evidence they were
 * handed, and what the PR check runs in CI.
 */
export function verifyFile(file) {
  let entries;
  try {
    if (!fs.existsSync(file)) return { ok: false, reason: 'not-found', file };
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { ok: false, reason: 'not-a-file', file };
    entries = readEntries(file);
  } catch (e) {
    return { ok: false, reason: 'unreadable', file, detail: e.message };
  }
  if (!entries.length) return { ok: false, reason: 'empty-or-unparseable', file };
  return { ...verifyEntries(entries), file, entries: entries.length };
}
