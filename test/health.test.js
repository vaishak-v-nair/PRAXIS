import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeTranscript, classifyContext, suggestNext } from '../src/lib/health.js';
import { freshHudState, applyLine } from '../src/lib/transcript.js';

const j = (o) => JSON.stringify(o);

test('analyzeTranscript reads real token usage, compactions, errors', () => {
  const text = [
    j({ type: 'user', timestamp: '2026-07-15T09:00:00.000Z', message: { content: 'hi' } }),
    j({
      type: 'assistant',
      timestamp: '2026-07-15T09:00:10.000Z',
      message: {
        model: 'claude-fable-5',
        usage: { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 50000, output_tokens: 10 },
        content: [{ type: 'text', text: 'hello' }],
      },
    }),
    j({
      type: 'system',
      subtype: 'compact_boundary',
      content: 'Conversation compacted',
      compactMetadata: { trigger: 'auto', preTokens: 180000, postTokens: 9000 },
    }),
    j({
      type: 'assistant',
      timestamp: '2026-07-15T10:00:00.000Z',
      message: {
        model: 'claude-fable-5',
        usage: { input_tokens: 2, cache_creation_input_tokens: 500, cache_read_input_tokens: 159498, output_tokens: 9 },
        content: [{ type: 'text', text: 'later' }],
      },
    }),
    j({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'boom' }] },
    }),
  ].join('\n');

  const a = analyzeTranscript(text);
  assert.equal(a.contextTokens, 160000, 'last assistant usage wins');
  assert.equal(a.model, 'claude-fable-5');
  assert.equal(a.compactions, 1);
  assert.equal(a.lastCompact.postTokens, 9000);
  assert.equal(a.toolResults, 1);
  assert.equal(a.toolErrors, 1);
  assert.equal(a.firstTs, '2026-07-15T09:00:00.000Z');
  assert.equal(a.lastTs, '2026-07-15T10:00:00.000Z');
});

test('analyzeTranscript ignores sidechain usage and garbage lines', () => {
  const text = [
    'garbage {{{',
    j({
      type: 'assistant',
      isSidechain: true,
      message: { usage: { input_tokens: 2, cache_read_input_tokens: 999999 }, content: [] },
    }),
  ].join('\n');
  const a = analyzeTranscript(text);
  assert.equal(a.contextTokens, 0);
});

test('classifyContext levels and percentages', () => {
  assert.deepEqual(classifyContext(40000, 200000), { pct: 20, level: 'fresh' });
  assert.deepEqual(classifyContext(120000, 200000), { pct: 60, level: 'warming' });
  assert.deepEqual(classifyContext(160000, 200000), { pct: 80, level: 'heavy' });
  assert.deepEqual(classifyContext(181000, 200000), { pct: 91, level: 'critical' });
  assert.deepEqual(classifyContext(250000, 200000), { pct: 100, level: 'critical' }, 'clamped, never >100%');
});

test('suggestNext: directional, honest about what is installed', () => {
  const withGemini = suggestNext('critical', { gemini: true, codex: false });
  assert.equal(withGemini.target, 'gemini');
  assert.equal(withGemini.command, 'praxis switch gemini');
  assert.equal(withGemini.urgent, true);

  const codexOnly = suggestNext('heavy', { gemini: false, codex: true });
  assert.equal(codexOnly.target, 'codex');
  assert.equal(codexOnly.urgent, false);

  const nothing = suggestNext('critical', {});
  assert.ok(!nothing.target, 'no fake suggestions');
  assert.match(nothing.text, /\/compact/, 'still gives a way out');

  assert.equal(suggestNext('fresh', {}).urgent, false);
});

test('hud reducer tracks context tokens and compactions', () => {
  const s = freshHudState();
  applyLine(
    s,
    j({
      type: 'assistant',
      message: {
        usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 99998 },
        content: [{ type: 'text', text: 'working' }],
      },
    }),
  );
  applyLine(s, j({ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto' } }));
  assert.equal(s.contextTokens, 100000);
  assert.equal(s.compactions, 1);
});
