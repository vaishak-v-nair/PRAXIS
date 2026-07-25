import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordReceipt, summarizeVerdicts, rightSizeForJudge } from '../src/lib/receipt/record.js';
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

test('rightSizeForJudge windows a monster session honestly', () => {
  const evidence = {
    commands_run: Array.from({ length: 300 }, (_, i) => ({ channel: 'Bash', command: 'cmd-' + i })),
    git_activity: Array.from({ length: 50 }, (_, i) => ({ channel: 'Bash', command: 'git commit -m ' + i })),
    test_activity: [],
    build_activity: [],
    files_edited: ['a.js'],
    completeness_note: 'base note.',
    counts: { commands: 300 },
  };
  const prose = Array.from({ length: 40 }, (_, i) => ({ turn: i, text: 'done ' + i }));
  const v = rightSizeForJudge(evidence, prose);
  assert.equal(v.evidence.commands_run.length, 60);
  // recency wins: the LAST commands survive, not the first
  assert.equal(v.evidence.commands_run[59].command, 'cmd-299');
  assert.equal(v.evidence.git_activity.length, 15);
  assert.equal(v.claimProse.length, 10);
  assert.equal(v.claimProse[9].text, 'done 39');
  assert.equal(v.omittedCommands, 240);
  // the trimmed view says so, and restates the absence rule
  assert.match(v.evidence.completeness_note, /most recent 60 of 300/);
  assert.match(v.evidence.completeness_note, /UNVERIFIABLE, never FALSE/);
  // the ORIGINAL record is untouched
  assert.equal(evidence.commands_run.length, 300);
  assert.equal(evidence.completeness_note, 'base note.');
});

test('rightSizeForJudge leaves small sessions alone (no misleading note)', () => {
  const evidence = { commands_run: [{ channel: 'Bash', command: 'npm test' }], git_activity: [], test_activity: [], build_activity: [], files_edited: [], completeness_note: 'base.', counts: {} };
  const v = rightSizeForJudge(evidence, [{ turn: 1, text: 'done' }]);
  assert.equal(v.evidence.commands_run.length, 1);
  assert.equal(v.omittedCommands, 0);
  assert.equal(v.evidence.completeness_note, 'base.'); // nothing omitted, nothing claimed
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
