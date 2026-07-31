import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { redact } from '../src/lib/redact.js';
import { patchClaudeMd } from '../src/lib/claudemd.js';
import { patchSettings } from '../src/lib/settings.js';
import { addSessionEntry, defaultMemory } from '../src/lib/memory.js';
import { buildFeedbackUrl } from '../src/commands/feedback.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-test-'));
}

test('redact strips common secrets', () => {
  assert.match(redact('key sk-ant-ABCDEFGHIJKLMNOPQRST12345'), /REDACTED/);
  assert.match(redact('AWS_SECRET_ACCESS_KEY=abcd1234efgh'), /\[REDACTED\]/);
  assert.equal(redact('nothing secret here'), 'nothing secret here');
});

test('redact strips connection-string credentials (the pushed-trace class)', () => {
  const out = redact('DB is postgres://admin:s3cr3tpw@db.example.com:5432/app');
  assert.doesNotMatch(out, /s3cr3tpw/, 'inline password removed');
  assert.match(out, /postgres:\/\/\[REDACTED\]:\[REDACTED\]@db\.example\.com/, 'scheme + host kept');
  assert.match(redact('mongodb+srv://u:p@cluster0.abc.mongodb.net'), /\[REDACTED\]:\[REDACTED\]@/);
  // fixtures assembled at runtime so no scannable key literal sits in source
  assert.match(redact('AIza' + 'B'.repeat(35)), /REDACTED_GOOGLE_KEY/);
  assert.match(redact('sk' + '_live_' + 'C'.repeat(24)), /REDACTED_STRIPE_KEY/);
  // a plain https URL with no credentials is untouched
  assert.equal(redact('see https://github.com/x/y'), 'see https://github.com/x/y');
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

test('patchSettings adds all hooks without clobbering existing ones', () => {
  const dir = tmp();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }));
  patchSettings(file);
  patchSettings(file); // idempotent
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(s.hooks.PreToolUse, 'existing hooks preserved');
  assert.equal(s.hooks.Stop.length, 1, 'no duplicate Stop hook');
  // hooks must work for npx-only installs — bare `praxis` is not on PATH there
  assert.match(JSON.stringify(s.hooks.Stop), /npx -y praxis-memory capture/);
  assert.equal(s.hooks.PreCompact.length, 1, 'snapshot hook present once');
  assert.match(JSON.stringify(s.hooks.PreCompact), /npx -y praxis-memory capture/);
  // The tray is opt-in as of 0.11.1: `init` installs capture, and nothing that
  // puts an icon on the user's screen. Five projects used to mean five
  // axolotls nobody asked for.
  assert.equal(s.hooks.SessionStart, undefined, 'no tray hook unless asked for');

  patchSettings(file, { tray: true });
  const t = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(t.hooks.SessionStart.length, 1, 'and exactly one once it is asked for');
  assert.match(JSON.stringify(t.hooks.SessionStart), /npx -y praxis-memory tray --ensure/);
});

test('patchSettings repairs legacy bare-praxis hooks in place', () => {
  const dir = tmp();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'praxis capture' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: 'praxis tray --ensure' }] }],
      },
    }),
  );
  const first = patchSettings(file);
  assert.equal(first.already, false, 'repair counts as a change');
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(s.hooks.Stop.length, 1, 'legacy Stop hook replaced, not duplicated');
  assert.match(JSON.stringify(s.hooks.Stop), /npx -y praxis-memory capture/);
  assert.doesNotMatch(JSON.stringify(s.hooks.Stop), /"praxis capture"/, 'broken command gone');
  assert.equal(s.hooks.SessionStart.length, 1, 'legacy tray hook replaced, not duplicated');
  assert.match(JSON.stringify(s.hooks.SessionStart), /npx -y praxis-memory tray --ensure/);
  const second = patchSettings(file);
  assert.equal(second.already, true, 'second run is a no-op');
});

test('buildFeedbackUrl pre-fills a labeled GitHub issue', () => {
  const url = buildFeedbackUrl();
  assert.match(url, /^https:\/\/github\.com\/vaishak-v-nair\/PRAXIS\/issues\/new\?/);
  assert.match(url, /labels=feedback/);
  assert.match(url, new RegExp(encodeURIComponent('What would make you pay for PRAXIS?').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(url, new RegExp(encodeURIComponent(`praxis v`)));
  assert.doesNotMatch(url, /[^%](&body|&labels)=.*\s/, 'no raw whitespace in query');
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
  assert.match(out, /moved to \.praxis\/archive/, 'trim note points at the archive');
});

test('trimmed entries are archived, never deleted', () => {
  const dir = tmp();
  const file = path.join(dir, 'memory.md');
  const archiveDir = path.join(dir, 'archive', 'sessions');
  fs.writeFileSync(file, defaultMemory());

  addSessionEntry(file, 'keep-me-oldest', '- first fact, later rotated out', { maxBytes: 2048 });
  for (let i = 0; i < 10; i++) {
    addSessionEntry(file, `bulk-${i}`, '- '.padEnd(500, 'x'), { maxBytes: 2048 });
  }

  const working = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(working, /keep-me-oldest/, 'oldest entry rotated out of working memory');

  const month = new Date().toISOString().slice(0, 7);
  const archFile = path.join(archiveDir, `${month}.md`);
  assert.ok(fs.existsSync(archFile), 'monthly archive file exists');
  const arch = fs.readFileSync(archFile, 'utf8');
  assert.match(arch, /keep-me-oldest/, 'rotated entry landed in the archive');
  assert.match(arch, /first fact, later rotated out/, 'entry body intact in the archive');
  assert.match(arch, /Nothing is deleted/, 'archive file explains itself');
});
