import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { buildArchive, buildResume, extractEssence, findObsidianVault } from '../src/lib/checkpoint.js';
import { extractBrief, extractRecentEntries, buildCapsule } from '../src/lib/handoff.js';

const line = (o) => JSON.stringify(o);

function sampleTranscript() {
  return [
    line({ type: 'user', timestamp: '2026-07-17T10:00:00.000Z', message: { content: 'fix the login bug' } }),
    line({
      type: 'assistant',
      timestamp: '2026-07-17T10:00:05.000Z',
      message: {
        id: 'm1',
        usage: { input_tokens: 1000, cache_read_input_tokens: 50000 },
        content: [
          { type: 'text', text: 'Found it — expiry check uses < not <=.' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/auth.js' } },
          { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'src/session.js' } },
        ],
      },
    }),
    // streamed repeat of the same assistant message: must not duplicate
    line({
      type: 'assistant',
      timestamp: '2026-07-17T10:00:06.000Z',
      message: { id: 'm1', content: [{ type: 'text', text: 'Found it — expiry check uses < not <=.' }] },
    }),
    line({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-07-17T10:10:00.000Z' }),
    // sidechain noise must be invisible
    line({ type: 'user', isSidechain: true, message: { content: 'agent internal chatter' } }),
    line({ type: 'user', timestamp: '2026-07-17T10:20:00.000Z', message: { content: 'now add a test, TOKEN=abc123secret' } }),
    line({
      type: 'assistant',
      timestamp: '2026-07-17T10:20:09.000Z',
      message: { id: 'm2', usage: { input_tokens: 2000, cache_read_input_tokens: 90000 }, content: [{ type: 'text', text: 'Test added and passing.' }] },
    }),
  ].join('\n');
}

test('buildArchive: full words, one-line actions, dedup, sidechains and repeats excluded', () => {
  const { markdown, stats } = buildArchive(sampleTranscript(), { project: 'MyApp', now: '2026-07-17T10:30:00.000Z' });

  assert.match(markdown, /# Session archive — MyApp/);
  assert.match(markdown, /## You\n\nfix the login bug/);
  assert.match(markdown, /## Claude\n\nFound it/);
  // a burst of the same tool collapses to one ×N line
  assert.match(markdown, /- Reading a file — src\/session\.js ×2/);
  assert.match(markdown, /compacted here/);
  assert.doesNotMatch(markdown, /agent internal chatter/);
  // the streamed repeat appears exactly once
  assert.equal(markdown.split('Found it').length - 1, 1);

  assert.equal(stats.userMsgs, 2);
  assert.equal(stats.claudeMsgs, 2);
  assert.equal(stats.tools, 2);
  assert.equal(stats.compactions, 1);
  assert.equal(stats.tokens, 92000); // last assistant usage wins
  assert.deepEqual(stats.files, ['src/auth.js', 'src/session.js']);
});

test('extractEssence: last asks + last Claude words, slash commands skipped', () => {
  const { asks, lastClaude } = extractEssence(sampleTranscript());
  assert.deepEqual(asks, ['fix the login bug', 'now add a test, TOKEN=abc123secret']);
  assert.equal(lastClaude, 'Test added and passing.');
});

const MEMORY = `# PRAXIS Memory
## Project
Auth service. Node ESM, zero deps.

## Session Log
### 2026-07-16 - session
- Working on: "login bug"

### 2026-07-15 - session
- Working on: "setup"
`;

test('buildResume: brief + live essence + first move, deterministic', () => {
  const md = buildResume(MEMORY, { asks: ['fix login'], lastClaude: 'Done.' }, { now: '2026-07-17T10:30:00.000Z' });
  assert.match(md, /# RESUME — continue exactly here/);
  assert.match(md, /Auth service\. Node ESM, zero deps\./);
  assert.match(md, /- fix login/);
  assert.match(md, /> Done\./);
  assert.match(md, /Do not start over/);
});

test('buildResume: empty memory and no transcript degrade honestly', () => {
  const md = buildResume('', {}, { now: '2026-07-17T10:30:00.000Z' });
  assert.match(md, /No project brief saved yet/);
  assert.match(md, /No live transcript found/);
});

test('handoff extraction: brief and entries shared with switch, capsule unchanged', () => {
  assert.equal(extractBrief(MEMORY), 'Auth service. Node ESM, zero deps.');
  assert.equal(extractBrief(''), '');
  const entries = extractRecentEntries(MEMORY, 1);
  assert.equal(entries.length, 1);
  assert.match(entries[0], /^### 2026-07-16/);
  // the capsule still carries both halves
  const capsule = buildCapsule(MEMORY, { toolName: 'Gemini', now: 'now' });
  assert.match(capsule, /Auth service/);
  assert.match(capsule, /### 2026-07-16/);
});

test('findObsidianVault: walks up, stops hard at the boundary', () => {
  const sep = path.sep;
  const vaults = new Set([path.resolve(`${sep}repo${sep}.obsidian`)]);
  const existsDir = (d) => vaults.has(path.resolve(d));

  // found from a nested folder inside the boundary
  assert.equal(
    findObsidianVault(`${sep}repo${sep}.praxis${sep}checkpoints`, [`${sep}repo`], existsDir),
    path.resolve(`${sep}repo`),
  );
  // a vault ABOVE the boundary is never reported
  const above = new Set([path.resolve(`${sep}.obsidian`)]);
  assert.equal(
    findObsidianVault(`${sep}repo${sep}sub`, [`${sep}repo`], (d) => above.has(path.resolve(d))),
    null,
  );
  // no vault anywhere: null, and the walk terminates
  assert.equal(findObsidianVault(`${sep}a${sep}b`, [], () => false), null);
});
