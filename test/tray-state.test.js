// The tray's brain, tested on any platform — including the Windows machine
// this was written on, which is the whole point of moving the rules out of
// PowerShell. If the macOS host draws the wrong emotion, the bug is either
// here (and these catch it) or in AppKit (and no test can).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeTrayState, relativeAge, receiptBadge, SUGGEST, TRAY_STATES } from '../src/lib/tray-state.js';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-tray-'));
  fs.mkdirSync(path.join(dir, '.praxis'), { recursive: true });
  return dir;
}
const write = (root, rel, s) => {
  const f = path.join(root, '.praxis', rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, s);
};

test('relative age speaks the tooltip vocabulary and nothing else', () => {
  assert.equal(relativeAge(5_000), 'just now');
  assert.equal(relativeAge(12 * 60_000), '12 m ago');
  assert.equal(relativeAge(3 * 3600_000), '3 h ago');
  assert.equal(relativeAge(2 * 86400_000), '2 d ago');
});

test('an empty project is idle and healthy, never a crash', () => {
  const root = sandbox();
  const s = computeTrayState(root);
  assert.equal(s.name, 'idle');
  assert.equal(s.label, 'healthy');
  assert.equal(s.entries, 0);
  assert.deepEqual(s.recent, []);
  assert.equal(s.receipt, null);
  assert.ok(TRAY_STATES.includes(s.name));
});

test('memory filling past 60% warns, past 90% hits the limit', () => {
  const root = sandbox();
  write(root, 'config.json', JSON.stringify({ maxLogBytes: 1000 }));
  write(root, 'memory.md', 'x'.repeat(650));
  assert.equal(computeTrayState(root).name, 'warning');
  write(root, 'memory.md', 'x'.repeat(950));
  assert.equal(computeTrayState(root).name, 'limit');
});

test('a carry-over outranks everything, but only while it is fresh', () => {
  const root = sandbox();
  write(root, 'config.json', JSON.stringify({ maxLogBytes: 1000 }));
  write(root, 'memory.md', 'x'.repeat(980)); // would otherwise be `limit`
  write(root, 'state.json', JSON.stringify({ phase: 'switching', ts: new Date().toISOString() }));
  assert.equal(computeTrayState(root).name, 'switching');

  // ...and 10 minutes later the switch is history, so the memory cap wins again
  write(root, 'state.json', JSON.stringify({ phase: 'switching', ts: new Date(Date.now() - 600_000).toISOString() }));
  assert.equal(computeTrayState(root).name, 'limit');
});

test('a session that stopped writing 20 minutes ago must not hold the glow amber', () => {
  const root = sandbox();
  const stale = new Date(Date.now() - 20 * 60_000).toISOString();
  write(root, 'health.json', JSON.stringify({ pct: 95, level: 'critical', sessionId: 'x', updated: stale }));
  const s = computeTrayState(root);
  assert.equal(s.name, 'idle', 'history is not an alarm');
});

test('a live critical session shows the limit and says the number', () => {
  const root = sandbox();
  write(root, 'health.json', JSON.stringify({
    pct: 91, level: 'critical', sessionId: 'abc', updated: new Date().toISOString(),
  }));
  const s = computeTrayState(root);
  assert.equal(s.name, 'limit');
  assert.match(s.label, /91% full/);
});

test('the first 8 seconds say hello, then settle', () => {
  const root = sandbox();
  assert.equal(computeTrayState(root, { uptimeMs: 2000 }).name, 'happy');
  assert.equal(computeTrayState(root, { uptimeMs: 30_000 }).name, 'idle');
});

test('recent entries are trimmed and ISO stamps become readable', () => {
  const root = sandbox();
  write(
    root,
    'memory.md',
    ['# Memory', '### 2026-07-30T09:05:00.000Z - the auth refactor', '### plain heading', '### third', '### fourth'].join('\n'),
  );
  const s = computeTrayState(root);
  assert.equal(s.entries, 4);
  assert.equal(s.recent.length, 3, 'the panel shows three, never the whole log');
  assert.doesNotMatch(s.recent[0], /T09:05:00/, 'raw ISO reads like machine noise');
  assert.match(s.recent[0], /Jul/);
  assert.ok(s.recent.every((r) => r.length <= 43));
});

test('the receipt badge reports the newest verdict, or nothing at all', () => {
  const root = sandbox();
  const dir = path.join(root, '.praxis', 'receipts');
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(receiptBadge(dir), null);

  fs.writeFileSync(path.join(dir, 'r-1.jsonl'), '{"t":"open"}\n{"t":"final","verdict":"VERIFIED"}\n');
  assert.equal(receiptBadge(dir).verdict, 'VERIFIED');
  assert.match(receiptBadge(dir).text, /verified/);

  fs.writeFileSync(path.join(dir, 'r-2.jsonl'), '{"t":"final","verdict":"CLAIMS_FAILED"}\n');
  fs.utimesSync(path.join(dir, 'r-2.jsonl'), new Date(), new Date(Date.now() + 5000));
  assert.equal(receiptBadge(dir).verdict, 'CLAIMS_FAILED');
});

test('a corrupt receipt is silence, not a stack trace', () => {
  const root = sandbox();
  const dir = path.join(root, '.praxis', 'receipts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'r-x.jsonl'), 'not json at all\n');
  assert.equal(receiptBadge(dir), null);
  assert.doesNotThrow(() => computeTrayState(root));
});

test('every state the host can draw has a suggestion to show under it', () => {
  for (const s of TRAY_STATES) assert.ok(SUGGEST[s], `${s} has no suggestion`);
});
