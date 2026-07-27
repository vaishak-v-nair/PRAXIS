import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnvelope, sealJobReceipt } from '../src/lib/jobs/receipt-link.js';
import { createJob } from '../src/lib/jobs/store.js';
import { verify } from '../src/lib/receipt/store.js';
import { transcriptDir } from '../src/lib/transcript.js';

test('parseEnvelope: a claude json envelope yields result + session id', () => {
  const raw = JSON.stringify({ type: 'result', result: 'All done.', session_id: 'sess-42', total_cost_usd: 0.12 });
  const p = parseEnvelope(raw);
  assert.equal(p.resultText, 'All done.');
  assert.equal(p.sessionId, 'sess-42');
  assert.equal(p.costUsd, 0.12);
});

test('parseEnvelope: junk-prefixed output still finds the envelope line', () => {
  const raw = 'npm warn something\n' + JSON.stringify({ result: 'ok', session_id: 's1' });
  const p = parseEnvelope(raw);
  assert.equal(p.sessionId, 's1');
});

test('parseEnvelope: plain text (fixture/other adapters) falls back honestly', () => {
  const p = parseEnvelope('EXEC: did the thing\n');
  assert.equal(p.resultText, 'EXEC: did the thing');
  assert.equal(p.sessionId, null);
});

test('sealJobReceipt: finds the job transcript and seals a verifiable receipt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-link-'));
  const cwd = path.join(root, 'proj');
  const home = path.join(root, 'home');
  const praxisDir = path.join(cwd, '.praxis');
  fs.mkdirSync(praxisDir, { recursive: true });
  process.env.PRAXIS_KEY_DIR = path.join(root, 'keys');

  // the job's own session transcript, where claude -p wrote it
  const tDir = transcriptDir(cwd, home);
  fs.mkdirSync(tDir, { recursive: true });
  fs.writeFileSync(
    path.join(tDir, 'sess-job-1.jsonl'),
    [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Tests pass.' }] } }),
    ].join('\n'),
  );

  const { dir } = createJob(praxisDir, { id: 'j-link1', task: 't', tool: 'claude', argv: [], cwd });
  fs.writeFileSync(path.join(dir, 'out.log'), JSON.stringify({ result: 'Tests pass.', session_id: 'sess-job-1' }));

  const linked = await sealJobReceipt(praxisDir, { id: 'j-link1', cwd }, { home });
  assert.ok(linked.receiptId, 'receipt sealed');
  assert.equal(linked.receiptVerdict, 'UNVERIFIED'); // evidence-only, judge untouched
  assert.equal(linked.resultTail, 'Tests pass.');
  const v = verify(path.join(praxisDir, 'receipts'), linked.receiptId);
  assert.ok(v.ok && v.finalized, 'chain intact and sealed');
});

test('sealJobReceipt: no envelope session -> result tail only, no receipt, no throw', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-link-'));
  const praxisDir = path.join(root, '.praxis');
  const { dir } = createJob(praxisDir, { id: 'j-link2', task: 't', tool: 'claude', argv: [], cwd: root });
  fs.writeFileSync(path.join(dir, 'out.log'), 'plain text output only');
  const linked = await sealJobReceipt(praxisDir, { id: 'j-link2', cwd: root }, { home: path.join(root, 'nohome') });
  assert.equal(linked.receiptId, undefined);
  assert.equal(linked.resultTail, 'plain text output only');
});
