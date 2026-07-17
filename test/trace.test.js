import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scanWindow, buildTraceBlock, patchHookScript, unpatchHookScript, HOOK_LINE } from '../src/lib/trace.js';

const j = (o) => JSON.stringify(o);
const T0 = Date.parse('2026-07-16T10:00:00Z');

function sampleTranscript() {
  return [
    // before the window — must be ignored
    j({ type: 'user', timestamp: '2026-07-16T09:00:00Z', message: { content: 'old ask from last commit' } }),
    j({ type: 'user', timestamp: '2026-07-16T10:05:00Z', message: { content: 'fix the login bug' } }),
    j({
      type: 'assistant',
      timestamp: '2026-07-16T10:06:00Z',
      message: {
        usage: { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 99000 },
        content: [
          { type: 'text', text: 'The token expiry check uses < instead of <= — off by one second. Fixing it and adding a regression test.' },
          { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'E:/repo/src/auth.js' } },
          { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test && echo sk-ant-SECRETSECRETSECRET123' } },
        ],
      },
    }),
  ].join('\n');
}

test('scanWindow: respects the time window, collects asks/files/commands/tokens', () => {
  const s = scanWindow(sampleTranscript(), T0);
  assert.deepEqual(s.asks, ['fix the login bug'], 'pre-window ask excluded');
  assert.deepEqual([...s.files], ['E:/repo/src/auth.js']);
  assert.equal(s.commands, 1);
  assert.equal(s.lastTokens, 100000);
  assert.equal(s.said.length, 1);
});

test('buildTraceBlock: readable, relative paths, session fact, redacted', () => {
  const s = scanWindow(sampleTranscript(), T0);
  const block = buildTraceBlock(s, { root: 'E:/repo', version: '0.6.0', contextLimit: 200000 });
  assert.match(block, /Asked:\n {2}· fix the login bug/);
  assert.match(block, /Touched: src\/auth\.js/);
  assert.match(block, /In its words:/);
  assert.match(block, /off by one second/);
  assert.match(block, /session 50% full at commit/);
  assert.match(block, /praxis v0\.6\.0/);
});

test('buildTraceBlock: paths outside the repo become a count, never a path', () => {
  const s = scanWindow(sampleTranscript(), T0);
  s.files.add('E:/PRIVATE-repo/secret-plan.md');
  const block = buildTraceBlock(s, { root: 'E:/repo', version: '0.6.0', contextLimit: 200000 });
  assert.match(block, /src\/auth\.js/);
  assert.doesNotMatch(block, /PRIVATE-repo|secret-plan/, 'foreign path never printed');
  assert.match(block, /1 outside this repo/);
});

test('buildTraceBlock: an autonomous window says so instead of showing nothing', () => {
  const s = scanWindow('', 0);
  const block = buildTraceBlock(s, {});
  assert.match(block, /autonomous follow-through/);
});

test('hook patch is additive, idempotent, and reversible', () => {
  const fresh = patchHookScript('');
  assert.match(fresh.content, /^#!\/bin\/sh\n/);
  assert.ok(fresh.content.includes(HOOK_LINE));

  const existing = '#!/bin/sh\nnpm run lint\n';
  const patched = patchHookScript(existing);
  assert.ok(patched.content.startsWith(existing.trimEnd()), 'existing hook preserved');
  assert.ok(patched.content.includes(HOOK_LINE));

  const again = patchHookScript(patched.content);
  assert.equal(again.changed, false, 'second patch is a no-op');

  const removed = unpatchHookScript(patched.content);
  assert.ok(!removed.content.includes(HOOK_LINE));
  assert.match(removed.content, /npm run lint/, 'only our line removed');
});
