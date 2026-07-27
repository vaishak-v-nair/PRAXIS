import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildTools, summarizeVerdicts } from '../src/lib/mcp/tools.js';

// Recompute a receipt id the way store.js does, to locate what a tool wrote.
function idFor(sessionId) {
  return 'r-' + crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
}

function sandbox() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-mcp-'));
  fs.mkdirSync(path.join(cwd, '.praxis'), { recursive: true });
  process.env.PRAXIS_KEY_DIR = path.join(cwd, 'keys');
  return cwd;
}

const TRANSCRIPT = [
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'All tests pass. Updated the docs.' }] } }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } }),
].join('\n');

function tools(cwd, opts = {}) {
  return buildTools({
    cwd,
    now: '2026-07-24T00:00:00Z',
    readTranscript: opts.noTranscript ? () => null : () => ({ text: TRANSCRIPT, sessionId: 'sess-mcp' }),
    judge: opts.judge || (async () => ({ ok: true, verdicts: [] })),
  });
}
function byName(list, name) {
  return list.find((t) => t.name === name);
}

test('summarizeVerdicts rolls up honestly', () => {
  assert.equal(summarizeVerdicts([{ verdict: 'TRUE' }, { verdict: 'TRUE' }]).headline, 'VERIFIED');
  assert.equal(summarizeVerdicts([{ verdict: 'TRUE' }, { verdict: 'FALSE', claim: 'docs' }]).headline, 'CLAIMS_FAILED');
  assert.equal(summarizeVerdicts([{ verdict: 'TRUE' }, { verdict: 'UNVERIFIABLE' }]).headline, 'PARTIAL');
  assert.equal(summarizeVerdicts([{ verdict: 'NOT_A_CLAIM' }]).headline, 'NO_CLAIMS');
});

test('all four tools are registered with schemas', () => {
  const list = tools(sandbox());
  const names = list.map((t) => t.name).sort();
  assert.deepEqual(names, ['praxis_recall', 'praxis_receipt', 'praxis_receipts', 'praxis_verify']);
  for (const t of list) assert.equal(t.inputSchema.type, 'object');
});

test('praxis_receipt (evidence only) writes a verifiable receipt', async () => {
  const cwd = sandbox();
  const list = tools(cwd);
  const out = await byName(list, 'praxis_receipt').handler({ verify: false });
  assert.match(out, /evidence only/);
  assert.match(out, /Bash/);
  // a receipt file now exists and verifies
  const v = await byName(list, 'praxis_verify').handler({ id: idFor('sess-mcp') });
  assert.match(v, /chain intact/);
});

test('praxis_receipt with verify=true surfaces the FALSE claim', async () => {
  const cwd = sandbox();
  const list = tools(cwd, {
    judge: async () => ({ ok: true, verdicts: [
      { claim: 'all tests pass', verdict: 'TRUE' },
      { claim: 'updated the docs', verdict: 'FALSE' },
      { claim: 'thematic mood', verdict: 'NOT_A_CLAIM' },
    ] }),
  });
  const out = await byName(list, 'praxis_receipt').handler({ verify: true });
  assert.match(out, /CLAIMS_FAILED/);
  assert.match(out, /1\/2 claims TRUE/);
  assert.match(out, /updated the docs/);
});

test('praxis_receipt degrades honestly when the judge is unavailable', async () => {
  const cwd = sandbox();
  const list = tools(cwd, { judge: async () => ({ ok: false, reason: 'timeout' }) });
  const out = await byName(list, 'praxis_receipt').handler({ verify: true });
  assert.match(out, /UNVERIFIED/);
  assert.match(out, /timed out|timeout/);
});

test('praxis_verify confirms an untampered sealed receipt', async () => {
  const cwd = sandbox();
  const list = tools(cwd, { judge: async () => ({ ok: true, verdicts: [{ claim: 'x', verdict: 'TRUE' }] }) });
  await byName(list, 'praxis_receipt').handler({ verify: true });
  const out = await byName(list, 'praxis_verify').handler({ id: idFor('sess-mcp') });
  assert.match(out, /untampered/);
});

test('praxis_receipts lists recorded receipts with verdicts', async () => {
  const cwd = sandbox();
  const list = tools(cwd);
  await byName(list, 'praxis_receipt').handler({ verify: false });
  const out = await byName(list, 'praxis_receipts').handler({});
  assert.match(out, /r-[0-9a-f]{8}/);
  assert.match(out, /UNVERIFIED/);
});

test('praxis_recall returns project memory', async () => {
  const cwd = sandbox();
  fs.writeFileSync(path.join(cwd, '.praxis', 'memory.md'), '# Memory\nThe project ships receipts.');
  const out = await byName(tools(cwd), 'praxis_recall').handler({});
  assert.match(out, /ships receipts/);
});

test('praxis_receipt with no session degrades to a clear message', async () => {
  const out = await byName(tools(sandbox(), { noTranscript: true }), 'praxis_receipt').handler({ verify: false });
  assert.match(out, /No Claude Code session/);
});
