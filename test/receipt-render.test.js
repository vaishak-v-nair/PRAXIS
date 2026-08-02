import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { recordReceipt } from '../src/lib/receipt/record.js';
import { loadReceipt, listReceipts, renderTerminal, renderHtml, renderMarkdown } from '../src/lib/receipt/render.js';

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

test('renderMarkdown on a missing receipt says so, does not throw', () => {
  assert.match(renderMarkdown(null), /No such receipt/);
});

test('renderMarkdown includes id, verdict, and a work/integrity table', async () => {
  const dir = sandbox();
  const r = await recordReceipt(dir, TR, { verify: false });
  const md = renderMarkdown(loadReceipt(dir, r.id));
  assert.match(md, new RegExp(r.id));
  assert.match(md, /UNVERIFIED/);
  assert.match(md, /\| work \|/);
  assert.match(md, /1 command/);
  assert.match(md, /1 file/);
  assert.match(md, /\| integrity \|/);
});

test('renderMarkdown renders claims as a GFM list with per-verdict markers', async () => {
  const dir = sandbox();
  const judge = async () => ({
    ok: true,
    verdicts: [
      { claim: 'did a real thing', verdict: 'TRUE' },
      { claim: 'did a fake thing', verdict: 'FALSE' },
      { claim: 'did an unclear thing', verdict: 'UNVERIFIABLE' },
    ],
  });
  const r = await recordReceipt(dir, TR, { verify: true, judge });
  const md = renderMarkdown(loadReceipt(dir, r.id, r.version));
  assert.match(md, /1 TRUE · 1 FALSE · 1 UNVERIFIABLE/);
  assert.match(md, /- ✅ did a real thing/);
  assert.match(md, /- ❌ did a fake thing — \*\*FALSE\*\*/);
  assert.match(md, /- ❔ did an unclear thing _\(unverifiable\)_/);
});

test('renderMarkdown with no judged claims says evidence-only', async () => {
  const dir = sandbox();
  const r = await recordReceipt(dir, TR, { verify: false });
  const md = renderMarkdown(loadReceipt(dir, r.id));
  assert.match(md, /Evidence only — no claims judged yet/);
});

test('renderMarkdown escapes a claim so it cannot break out of its list item', async () => {
  const dir = sandbox();
  // a hostile/careless judge output: newlines plus markdown control chars —
  // must not be able to inject a heading, checkbox, table or mention into
  // whatever PR body this markdown gets pasted into.
  const hostileClaim = 'fine\n\n# pwned\n\n- [ ] not a real checkbox\n| a | table |';
  const judge = async () => ({ ok: true, verdicts: [{ claim: hostileClaim, verdict: 'TRUE' }] });
  const r = await recordReceipt(dir, TR, { verify: true, judge });
  const md = renderMarkdown(loadReceipt(dir, r.id, r.version));
  const claimsSection = md.slice(md.indexOf('**Claims**'));
  assert.doesNotMatch(claimsSection, /\n# pwned/);
  assert.doesNotMatch(claimsSection, /\n- \[ \]/);
  assert.doesNotMatch(claimsSection, /\n\|/);
  // the claim still shows up, just as inert single-line text
  assert.match(claimsSection, /fine.*pwned.*not a real checkbox/s);
});
