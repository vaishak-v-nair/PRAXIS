import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { redact } from '../src/lib/redact.js';
import { patchClaudeMd } from '../src/lib/claudemd.js';
import { patchSettings } from '../src/lib/settings.js';
import { addSessionEntry, defaultMemory } from '../src/lib/memory.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-test-'));
}

test('redact strips common secrets', () => {
  assert.match(redact('key sk-ant-ABCDEFGHIJKLMNOPQRST12345'), /REDACTED/);
  assert.match(redact('AWS_SECRET_ACCESS_KEY=abcd1234efgh'), /\[REDACTED\]/);
  assert.equal(redact('nothing secret here'), 'nothing secret here');
});

test('patchClaudeMd creates the managed block', () => {
  const dir = tmp();
  const file = path.join(dir, 'CLAUDE.md');
  const r = patchClaudeMd(file);
  assert.equal(r.existed, false);
  const out = fs.readFileSync(file, 'utf8');
  assert.match(out, /PRAXIS:START/);
  assert.match(out, /@\.praxis\/memory\.md/);
  assert.match(out, /PRAXIS:END/);
});

test('patchClaudeMd preserves user content and is idempotent', () => {
  const dir = tmp();
  const file = path.join(dir, 'CLAUDE.md');
  fs.writeFileSync(file, '# My Rules\n\nAlways use tabs.\n');
  patchClaudeMd(file);
  patchClaudeMd(file); // second run must not duplicate
  const out = fs.readFileSync(file, 'utf8');
  assert.match(out, /Always use tabs\./);
  assert.equal((out.match(/PRAXIS:START/g) || []).length, 1);
});

test('patchSettings adds a Stop hook without clobbering existing hooks', () => {
  const dir = tmp();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }));
  patchSettings(file);
  patchSettings(file); // idempotent
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(s.hooks.PreToolUse, 'existing hooks preserved');
  assert.equal(s.hooks.Stop.length, 1, 'no duplicate Stop hook');
  assert.match(JSON.stringify(s.hooks.Stop), /praxis capture/);
});

test('addSessionEntry prepends, redacts, and caps size', () => {
  const dir = tmp();
  const file = path.join(dir, 'memory.md');
  fs.writeFileSync(file, defaultMemory());

  addSessionEntry(file, 'entry-alpha', '- did a thing\n- token sk-ABCDEFGHIJKLMNOPQRSTUVWX');
  let out = fs.readFileSync(file, 'utf8');
  assert.match(out, /entry-alpha/);
  assert.match(out, /REDACTED/, 'secret in entry was redacted');
  assert.doesNotMatch(out, /sk-ABCDEFGHIJKLMNOPQRSTUVWX/);

  // newest-first ordering (distinctive tokens so we don't match the log comment)
  addSessionEntry(file, 'entry-beta', '- another thing');
  out = fs.readFileSync(file, 'utf8');
  assert.ok(out.indexOf('entry-beta') < out.indexOf('entry-alpha'), 'newest entry is on top');

  // cap: many big entries should trim, and Project section must survive
  for (let i = 0; i < 50; i++) {
    addSessionEntry(file, `2026-02-${i} — bulk`, '- '.padEnd(500, 'x'), { maxBytes: 2048 });
  }
  out = fs.readFileSync(file, 'utf8');
  assert.ok(Buffer.byteLength(out) < 6000, 'log stayed bounded');
  assert.match(out, /## Project/, 'Project section preserved through trimming');
  assert.match(out, /trimmed by PRAXIS/, 'trim note present');
});
