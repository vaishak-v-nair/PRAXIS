// REGRESSION-CLASS (iron rule): this file protects receipts that already exist.
//
// Receipts are the product's evidence. A schema change that silently invalidates
// records sealed by an older version would destroy exactly the thing PRAXIS
// sells. Every test here is about the boundary between v1 and v2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

import {
  SCHEMA_VERSION,
  open,
  append,
  finalize,
  verify,
  verifyFile,
  verifyEntries,
  readEntries,
  receiptFile,
  provenanceOf,
  isDemo,
  stableStringify,
  ensureKey,
} from '../src/lib/receipt/store.js';

function sandbox(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-schema-' + name + '-'));
  process.env.PRAXIS_KEY_DIR = path.join(root, 'keys'); // never touch the real key
  return { root, receipts: path.join(root, 'receipts') };
}

const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const chainHash = (prev, payload) => sha256hex((prev || '') + stableStringify(payload));

/**
 * Write a receipt exactly the way v0.9.x did: `v: 1`, no provenance field, and
 * a signature block with no embedded public key. This is the fixture the
 * absence rule exists for.
 */
function sealV1Receipt(dir, { sessionId = 'old-session', project = 'legacy' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const id = 'r-' + sha256hex(sessionId).slice(0, 8);
  const file = path.join(dir, `${id}.jsonl`);

  const openPayload = {
    t: 'open',
    v: 1,
    id,
    version: 1,
    sessionId,
    project,
    baseRef: null,
    parent: null,
    openedAt: '2026-07-01T00:00:00.000Z',
  };
  const openHash = chainHash(null, openPayload);
  fs.writeFileSync(file, JSON.stringify({ ...openPayload, hash: openHash }) + '\n');

  const evPayload = { t: 'evidence', commands_run: [{ channel: 'Bash', command: 'npm test' }], files_edited: ['a.js'] };
  const evHash = chainHash(openHash, evPayload);
  fs.appendFileSync(file, JSON.stringify({ ...evPayload, hash: evHash }) + '\n');

  const finalPayload = { t: 'final', verdict: 'UNVERIFIED', claims: [], finalizedAt: '2026-07-01T01:00:00.000Z' };
  const finalHash = chainHash(evHash, finalPayload);
  const { privateKey, fingerprint } = ensureKey();
  const signature = crypto.sign(null, Buffer.from(finalHash, 'hex'), privateKey).toString('base64');
  // v1 sig: alg, key, signature — no `pub`
  fs.appendFileSync(
    file,
    JSON.stringify({ ...finalPayload, hash: finalHash, sig: { alg: 'ed25519', key: fingerprint, signature } }) + '\n',
  );
  return { id, file };
}

test('R1: a pre-0.10.0 receipt still verifies green under the new verifier', () => {
  const s = sandbox('r1');
  const { file } = sealV1Receipt(s.receipts);

  const res = verifyFile(file);
  assert.equal(res.ok, true, 'an old receipt must not become invalid because we shipped a new version');
  assert.equal(res.chain, true);
  assert.equal(res.finalized, true);
  assert.equal(res.signature, true);
  assert.equal(res.embeddedKey, false, 'v1 carries no key — verified against this machine, honestly reported');
});

test('R1 (absence rule): no provenance field means REAL, never demo', () => {
  const s = sandbox('r1b');
  const { file } = sealV1Receipt(s.receipts);
  const entries = readEntries(file);

  assert.equal(provenanceOf(entries), 'real');
  assert.equal(isDemo(entries), false, 'absence must never be read as "this was a demo"');
});

test('R2: a v2 receipt is chain-valid under the OLD recomputation (adding fields broke nothing)', () => {
  const s = sandbox('r2');
  const o = open(s.receipts, { sessionId: 'new-session', project: 'p', now: 'T0' });
  append(s.receipts, o.id, { commands_run: [{ channel: 'Bash', command: 'npm test' }] }, o.version);
  finalize(s.receipts, o.id, { verdict: 'UNVERIFIED', now: 'T1' }, o.version);

  const entries = readEntries(receiptFile(s.receipts, o.id, o.version));
  assert.equal(entries[0].v, SCHEMA_VERSION, 'new receipts declare the schema version');

  // Recompute the chain the way the pre-v2 verifier did: strip hash and sig,
  // hash the rest. If sig.pub had been folded into the hashed payload, this
  // would fail — that is the regression this test exists to catch.
  let prev = null;
  for (let i = 0; i < entries.length; i++) {
    const { hash, sig, ...payload } = entries[i];
    assert.equal(chainHash(prev, payload), hash, `line ${i} rehashes identically under the old algorithm`);
    prev = hash;
  }
});

test('cross-version: both directions verify, and both report their provenance', () => {
  const s = sandbox('cross');
  const v1 = sealV1Receipt(s.receipts, { sessionId: 'legacy-2' });
  const o = open(s.receipts, { sessionId: 'modern', project: 'p', now: 'T0' });
  append(s.receipts, o.id, { commands_run: [] }, o.version);
  finalize(s.receipts, o.id, { now: 'T1' }, o.version);

  const oldRes = verifyFile(v1.file);
  const newRes = verifyFile(receiptFile(s.receipts, o.id, o.version));
  assert.equal(oldRes.ok, true);
  assert.equal(newRes.ok, true);
  assert.equal(oldRes.provenance, 'real');
  assert.equal(newRes.provenance, 'real', 'real work seals provenance null, which reads as real');
});

test('demo provenance is sealed inside the chain, not a label on a screen', () => {
  const s = sandbox('demo');
  const o = open(s.receipts, { sessionId: 'demo-1', project: 'demo', now: 'T0', provenance: 'demo-replay' });
  append(s.receipts, o.id, { commands_run: [] }, o.version);
  finalize(s.receipts, o.id, { now: 'T1' }, o.version);

  const file = receiptFile(s.receipts, o.id, o.version);
  const res = verifyFile(file);
  assert.equal(res.ok, true);
  assert.equal(res.provenance, 'demo-replay');
  assert.equal(isDemo(readEntries(file)), true);

  // Relabelling a demo as real work must break verification — that is the
  // entire reason provenance is a sealed field rather than a rendering choice.
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text.replace('"provenance":"demo-replay"', '"provenance":null'));
  const tampered = verifyFile(file);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.reason, 'chain-broken');
  assert.equal(tampered.at, 0, 'the break is located at the line that was edited');
});

test('verifyFile: tamper, truncation, forgery and missing files all fail with a named reason', () => {
  const s = sandbox('tamper');
  const o = open(s.receipts, { sessionId: 'tamper-1', project: 'p', now: 'T0' });
  append(s.receipts, o.id, { commands_run: [{ channel: 'Bash', command: 'npm test' }] }, o.version);
  finalize(s.receipts, o.id, { now: 'T1' }, o.version);
  const file = receiptFile(s.receipts, o.id, o.version);
  const original = fs.readFileSync(file, 'utf8');

  assert.equal(verifyFile(path.join(s.root, 'nope.jsonl')).reason, 'not-found');

  // evidence edited after sealing
  fs.writeFileSync(file, original.replace('npm test', 'npm run deploy'));
  const edited = verifyFile(file);
  assert.equal(edited.ok, false);
  assert.equal(edited.reason, 'chain-broken');
  assert.equal(edited.at, 1);

  // final line dropped — chain is intact but nothing is sealed
  fs.writeFileSync(file, original.split('\n').slice(0, 2).join('\n') + '\n');
  const truncated = verifyFile(file);
  assert.equal(truncated.ok, true);
  assert.equal(truncated.finalized, false, 'an unsealed receipt says so rather than claiming a signature');

  // signature replaced with one from a different key, pub left as the original
  const lines = original.trim().split('\n');
  const last = JSON.parse(lines[2]);
  const { privateKey: otherKey } = crypto.generateKeyPairSync('ed25519');
  last.sig.signature = crypto.sign(null, Buffer.from(last.hash, 'hex'), otherKey).toString('base64');
  fs.writeFileSync(file, lines.slice(0, 2).join('\n') + '\n' + JSON.stringify(last) + '\n');
  const forged = verifyFile(file);
  assert.equal(forged.ok, false);
  assert.equal(forged.signature, false);
  assert.equal(forged.reason, 'signature-invalid');
});

test('verifyFile needs no network and no private key — a stranger can check it', () => {
  const s = sandbox('portable');
  const o = open(s.receipts, { sessionId: 'portable-1', project: 'p', now: 'T0' });
  append(s.receipts, o.id, { commands_run: [] }, o.version);
  finalize(s.receipts, o.id, { now: 'T1' }, o.version);
  const file = receiptFile(s.receipts, o.id, o.version);

  // Move the receipt somewhere else entirely and point the key dir at an empty
  // directory: this is what "someone else's machine" looks like.
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-stranger-'));
  const copied = path.join(elsewhere, 'handed-to-me.jsonl');
  fs.copyFileSync(file, copied);
  process.env.PRAXIS_KEY_DIR = path.join(elsewhere, 'no-keys-here');

  const res = verifyFile(copied);
  assert.equal(res.ok, true, 'the embedded key is what makes a receipt portable evidence');
  assert.equal(res.embeddedKey, true);
  assert.ok(res.keyFingerprint, 'the signer fingerprint is reported so a switched key is visible');
  assert.equal(fs.existsSync(path.join(elsewhere, 'no-keys-here')), false, 'verification generated no key');
});

test('the verify CLI: exit codes CI can gate on, and reasons a human can act on', () => {
  const s = sandbox('cli');
  const o = open(s.receipts, { sessionId: 'cli-1', project: 'p', now: 'T0' });
  append(s.receipts, o.id, { commands_run: [{ channel: 'Bash', command: 'npm test' }] }, o.version);
  finalize(s.receipts, o.id, { now: 'T1' }, o.version);
  const file = receiptFile(s.receipts, o.id, o.version);
  const cli = path.resolve('src', 'cli.js');
  const run = (...args) =>
    spawnSync(process.execPath, [cli, 'receipt', 'verify', ...args], {
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, PRAXIS_KEY_DIR: process.env.PRAXIS_KEY_DIR },
    });

  const good = run(file);
  assert.equal(good.status, 0, 'a valid receipt exits 0 so a CI step can gate on it');
  assert.match(good.stdout, /VERIFIED/);
  assert.match(good.stdout, /no network, no model call/i, 'the free-ness is stated, not assumed');

  const missing = run(path.join(s.root, 'nope.jsonl'));
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /NOT VERIFIED/);

  // no path at all: the two-modes explainer, not an error dump
  const bare = spawnSync(process.execPath, [cli, 'receipt', 'verify'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(bare.status, 2, 'a distinct code — this is a usage prompt, not a failed verification');
  assert.match(bare.stdout, /offline proof/i);
  assert.match(bare.stdout, /one real model call/i, 'both modes named, with their real costs');
  assert.ok(!/at .*\.js:\d+/.test(bare.stdout + bare.stderr), 'no stack traces at users');
});

test('explainVerifyFailure names every failure mode in words', async () => {
  const { explainVerifyFailure } = await import('../src/commands/receipt.js');
  for (const reason of [
    'not-found',
    'not-a-file',
    'unreadable',
    'empty-or-unparseable',
    'no-signature',
    'signature-invalid',
    'signature-unverifiable-here',
    'signature-error',
  ]) {
    const msg = explainVerifyFailure({ reason });
    assert.ok(msg.length > 10 && !msg.includes(reason), `${reason} is explained, not echoed`);
  }
  assert.match(explainVerifyFailure({ reason: 'chain-broken', at: 4 }), /line 5/, 'line numbers are 1-based for humans');
});

test('verify(dir,id) and verifyEntries agree with verifyFile', () => {
  const s = sandbox('agree');
  const o = open(s.receipts, { sessionId: 'agree-1', project: 'p', now: 'T0' });
  finalize(s.receipts, o.id, { now: 'T1' }, o.version);
  const file = receiptFile(s.receipts, o.id, o.version);

  const a = verify(s.receipts, o.id, o.version);
  const b = verifyFile(file);
  const c = verifyEntries(readEntries(file));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(c.ok, true);
  assert.equal(a.provenance, c.provenance);
});
