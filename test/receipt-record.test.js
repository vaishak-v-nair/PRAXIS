import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordReceipt, summarizeVerdicts } from '../src/lib/receipt/record.js';
import { verify, receiptId, latestVersion } from '../src/lib/receipt/store.js';

function sandbox() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-rec-'));
  process.env.PRAXIS_KEY_DIR = path.join(cwd, 'keys');
  return path.join(cwd, 'receipts');
}

const TR = {
  sessionId: 'sess-rec',
  text: [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'All tests pass. Updated the docs.' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } }),
  ].join('\n'),
};

test('summarizeVerdicts rolls up honestly', () => {
  assert.equal(summarizeVerdicts([{ verdict: 'TRUE' }]).headline, 'VERIFIED');
  assert.equal(summarizeVerdicts([{ verdict: 'TRUE' }, { verdict: 'FALSE', claim: 'x' }]).headline, 'CLAIMS_FAILED');
  assert.equal(summarizeVerdicts([{ verdict: 'TRUE' }, { verdict: 'UNVERIFIABLE' }]).headline, 'PARTIAL');
  assert.equal(summarizeVerdicts([{ verdict: 'NOT_A_CLAIM' }]).headline, 'NO_CLAIMS');
});

test('evidence-only records a sealed, verifiable receipt with no judge', async () => {
  const dir = sandbox();
  const r = await recordReceipt(dir, TR, { verify: false });
  assert.equal(r.verified, false);
  assert.equal(r.verdict, 'UNVERIFIED');
  assert.equal(r.evidence.counts.commands, 1);
  const v = verify(dir, r.id);
  assert.ok(v.ok);
  assert.equal(v.finalized, true); // sealed at session end => tamper-evident now
});

test('verify=true with an injected judge seals the honest headline', async () => {
  const dir = sandbox();
  const judge = async () => ({
    ok: true,
    verdicts: [
      { claim: 'all tests pass', verdict: 'TRUE' },
      { claim: 'updated the docs', verdict: 'FALSE' },
    ],
  });
  const r = await recordReceipt(dir, TR, { verify: true, judge });
  assert.equal(r.verified, true);
  assert.equal(r.verdict, 'CLAIMS_FAILED');
  assert.deepEqual(r.summary.failed, ['updated the docs']);
});

test('a judge failure degrades to UNVERIFIED — no fabricated verdict', async () => {
  const dir = sandbox();
  const judge = async () => ({ ok: false, reason: 'timeout' });
  const r = await recordReceipt(dir, TR, { verify: true, judge });
  assert.equal(r.verified, false);
  assert.equal(r.verdict, 'UNVERIFIED');
  assert.equal(r.judgeError, 'timeout');
});

test('verify=true with no judge configured degrades, never throws', async () => {
  const dir = sandbox();
  const r = await recordReceipt(dir, TR, { verify: true }); // no judge fn
  assert.equal(r.verified, false);
  assert.match(r.judgeError, /no judge/);
});

test('a second record on a sealed session opens v2, never mutates v1', async () => {
  const dir = sandbox();
  await recordReceipt(dir, TR, { verify: false });
  const judge = async () => ({ ok: true, verdicts: [{ claim: 'x', verdict: 'TRUE' }] });
  await recordReceipt(dir, TR, { verify: true, judge });
  assert.equal(latestVersion(dir, receiptId(TR.sessionId)), 2);
  // v1 stays UNVERIFIED and still verifies
  assert.ok(verify(dir, receiptId(TR.sessionId), 1).ok);
});
