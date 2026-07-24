import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  receiptId,
  receiptFile,
  stableStringify,
  readEntries,
  open,
  append,
  finalize,
  verify,
  ensureKey,
} from '../src/lib/receipt/store.js';

// Each test gets an isolated receipts dir + key dir so nothing touches the real
// ~/.praxis. The key dir is injected via PRAXIS_KEY_DIR.
function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-receipt-'));
  const receiptsDir = path.join(base, 'receipts');
  process.env.PRAXIS_KEY_DIR = path.join(base, 'keys');
  return { base, receiptsDir };
}

test('receiptId is deterministic and stable-shaped', () => {
  assert.equal(receiptId('sess-abc'), receiptId('sess-abc'));
  assert.notEqual(receiptId('sess-abc'), receiptId('sess-xyz'));
  assert.match(receiptId('sess-abc'), /^r-[0-9a-f]{8}$/);
});

test('stableStringify sorts keys at every level', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(stableStringify({ z: { y: 1, x: 2 } }), '{"z":{"x":2,"y":1}}');
  assert.equal(stableStringify([3, { b: 1, a: 2 }]), '[3,{"a":2,"b":1}]');
});

test('open is idempotent — same session never double-creates', () => {
  const { receiptsDir } = sandbox();
  const a = open(receiptsDir, { sessionId: 's1', project: 'p' });
  assert.equal(a.created, true);
  const b = open(receiptsDir, { sessionId: 's1', project: 'p' });
  assert.equal(b.created, false);
  assert.equal(a.id, b.id);
  assert.equal(a.file, b.file);
  // exactly one open line on disk
  const entries = readEntries(a.file);
  assert.equal(entries.filter((e) => e.t === 'open').length, 1);
});

test('append chains, finalize seals, verify passes', () => {
  const { receiptsDir } = sandbox();
  const { id } = open(receiptsDir, { sessionId: 's2', project: 'p' });
  assert.equal(append(receiptsDir, id, { kind: 'test-run', exit: 0 }).ok, true);
  assert.equal(append(receiptsDir, id, { kind: 'files', touched: 3 }).ok, true);
  const fin = finalize(receiptsDir, id, { verdict: 'TRUE', claims: [{ id: 1, verdict: 'TRUE' }] });
  assert.equal(fin.ok, true);
  const v = verify(receiptsDir, id);
  assert.equal(v.ok, true);
  assert.equal(v.finalized, true);
  assert.equal(v.signature, true);
});

test('append after finalize is rejected, not mutated', () => {
  const { receiptsDir } = sandbox();
  const { id, file } = open(receiptsDir, { sessionId: 's3' });
  append(receiptsDir, id, { kind: 'a' });
  finalize(receiptsDir, id, { verdict: 'FALSE' });
  const before = fs.readFileSync(file, 'utf8');
  const res = append(receiptsDir, id, { kind: 'sneaky' });
  assert.equal(res.ok, false);
  assert.equal(res.finalized, true);
  assert.equal(fs.readFileSync(file, 'utf8'), before); // untouched
});

test('resume after seal opens a new version, never mutates the sealed one', () => {
  const { receiptsDir } = sandbox();
  const { id } = open(receiptsDir, { sessionId: 's4' });
  finalize(receiptsDir, id, { verdict: 'TRUE' });
  const again = open(receiptsDir, { sessionId: 's4' });
  assert.equal(again.created, true);
  assert.equal(again.version, 2);
  assert.equal(again.file, receiptFile(receiptsDir, id, 2));
  // v1 still verifies (untouched); v2 links back to v1
  assert.equal(verify(receiptsDir, id, 1).ok, true);
  const v2open = readEntries(again.file)[0];
  assert.equal(v2open.parent, `${id}.v1`);
});

test('finalize is idempotent — never re-signs', () => {
  const { receiptsDir } = sandbox();
  const { id } = open(receiptsDir, { sessionId: 's5' });
  const first = finalize(receiptsDir, id, { verdict: 'TRUE' });
  const second = finalize(receiptsDir, id, { verdict: 'FALSE' }); // must NOT overwrite
  assert.equal(second.already, true);
  assert.equal(second.hash, first.hash);
});

test('verify catches a tampered evidence line', () => {
  const { receiptsDir } = sandbox();
  const { id, file } = open(receiptsDir, { sessionId: 's6' });
  append(receiptsDir, id, { kind: 'claim', text: 'tests pass' });
  finalize(receiptsDir, id, { verdict: 'TRUE' });
  // tamper: flip a byte in the middle evidence line's payload
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  const ev = JSON.parse(lines[1]);
  ev.text = 'docs updated'; // changed content, stale hash
  lines[1] = JSON.stringify(ev);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const v = verify(receiptsDir, id);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'chain-broken');
});

test('readEntries drops a torn trailing line (crash mid-append)', () => {
  const { receiptsDir } = sandbox();
  const { id, file } = open(receiptsDir, { sessionId: 's7' });
  append(receiptsDir, id, { kind: 'good' });
  fs.appendFileSync(file, '{"t":"evidence","kind":"tor'); // partial write, no newline/close
  const entries = readEntries(file);
  assert.equal(entries.length, 2); // open + good, torn line dropped
  assert.equal(entries[entries.length - 1].kind, 'good');
});

test('secrets are redacted at rest before write', () => {
  const { receiptsDir } = sandbox();
  const { id, file } = open(receiptsDir, { sessionId: 's8' });
  append(receiptsDir, id, { kind: 'log', line: 'export KEY sk-ant-abcdef0123456789ABCDEF0123' });
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.includes('sk-ant-abcdef0123456789'), false);
  assert.equal(raw.includes('[REDACTED_ANTHROPIC_KEY]'), true);
  // chain still verifies over the redacted content
  finalize(receiptsDir, id, { verdict: 'TRUE' });
  assert.equal(verify(receiptsDir, id).ok, true);
});

test('ensureKey is stable across calls (one machine key)', () => {
  sandbox();
  const a = ensureKey();
  const b = ensureKey();
  assert.equal(a.fingerprint, b.fingerprint);
  assert.match(a.fingerprint, /^[0-9a-f]{16}$/);
});
