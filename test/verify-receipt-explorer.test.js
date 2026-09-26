import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { signVerifyReceipt } from '../src/lib/verify/verify-receipt.js';
import { canonicalJson, receiptFromFragment, receiptToFragment, verifyPublicReceipt } from '../web/receipt/explorer.js';

test('browser canonical JSON matches recursively sorted receipt encoding', () => {
  assert.equal(canonicalJson({ z: [2, { b: 1, a: 0 }], a: 'x' }), '{"a":"x","z":[2,{"a":0,"b":1}]}');
});

test('receipt explorer verifies a real Ed25519 Verify receipt and catches tampering', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-explorer-'));
  const receipt = signVerifyReceipt({ id: 'v-test', task: { description: 'test' }, commitRange: { base: 'a', head: 'b' }, claims: [], verdicts: [], evidence: [], verifier: { name: 'praxis-memory', version: 'test' }, timestamp: '2026-01-01T00:00:00.000Z' }, dir);
  assert.deepEqual(await verifyPublicReceipt(receipt, webcrypto), { ok: true, reason: null });
  assert.equal((await verifyPublicReceipt({ ...receipt, id: 'v-tampered' }, webcrypto)).ok, false);
  const roundTrip = receiptFromFragment(`#${receiptToFragment(receipt)}`);
  assert.deepEqual(roundTrip, receipt);
});

test('public explorer has no external script, style, or network permission', () => {
  const html = fs.readFileSync(path.resolve('web/receipt/index.html'), 'utf8');
  assert.match(html, /connect-src 'none'/); assert.doesNotMatch(html, /https?:\/\//); assert.match(html, /\.\/explorer\.js/);
});
