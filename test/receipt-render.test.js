import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { recordReceipt } from '../src/lib/receipt/record.js';
import { loadReceipt, listReceipts, renderTerminal, renderHtml } from '../src/lib/receipt/render.js';

function sandbox() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-ren-'));
  process.env.PRAXIS_KEY_DIR = path.join(cwd, 'keys');
  return path.join(cwd, 'receipts');
}

// recompute an id the way store.js does, to assert list output
function idFor(sessionId) {
  return 'r-' + crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
}

const TR = {
  sessionId: 'sess-ren',
  text: [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/a/b.js' } }] } }),
  ].join('\n'),
};

test('loadReceipt returns a structured receipt with a verified chain', async () => {
  const dir = sandbox();
  const r = await recordReceipt(dir, TR, { verify: false });
  const loaded = loadReceipt(dir, r.id);
  assert.equal(loaded.id, r.id);
  assert.equal(loaded.sealed, true);
  assert.ok(loaded.chain.ok);
  assert.equal(loaded.evidence.counts.commands, 1);
  assert.equal(loaded.evidence.counts.files_edited, 1);
  assert.ok(loaded.keyFingerprint); // signed
});

test('loadReceipt on a missing id returns null', () => {
  const dir = sandbox();
  assert.equal(loadReceipt(dir, 'r-deadbeef'), null);
});

test('renderTerminal shows the id and a verdict', async () => {
  const dir = sandbox();
  const r = await recordReceipt(dir, TR, { verify: false });
  const out = renderTerminal(loadReceipt(dir, r.id));
  assert.match(out, new RegExp(r.id));
  assert.match(out, /UNVERIFIED|evidence only/);
});

test('renderHtml is self-contained — no external network refs', async () => {
  const dir = sandbox();
  const r = await recordReceipt(dir, TR, { verify: false });
  const html = renderHtml(loadReceipt(dir, r.id));
  assert.match(html, /<style/);
  assert.match(html, new RegExp(r.id));
  assert.doesNotMatch(html, /https?:\/\//); // opens offline, nothing phones home
});

test('listReceipts returns newest-first rows with verdicts', async () => {
  const dir = sandbox();
  await recordReceipt(dir, TR, { verify: false });
  const rows = listReceipts(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].verdict, 'UNVERIFIED');
  assert.equal(rows[0].id, idFor('sess-ren'));
});

test('claims render with per-verdict markers, terminal and HTML', async () => {
  const dir = sandbox();
  const judge = async () => ({ ok: true, verdicts: [{ claim: 'did a real thing', verdict: 'FALSE' }] });
  const r = await recordReceipt(dir, TR, { verify: true, judge });
  const out = renderTerminal(loadReceipt(dir, r.id, r.version));
  assert.match(out, /did a real thing/);
  assert.match(out, /FALSE/);
  assert.match(renderHtml(loadReceipt(dir, r.id, r.version)), /did a real thing/);
});
