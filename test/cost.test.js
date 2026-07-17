import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scanUsage, priceUsage, rateFor, slopScore, usd, DEFAULT_PRICING } from '../src/lib/cost.js';

const j = (o) => JSON.stringify(o);

test('scanUsage: per-model token accounting from transcript lines', () => {
  const text = [
    j({ type: 'assistant', timestamp: '2026-07-17T10:00:00Z', message: { model: 'claude-sonnet-5', usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 200, cache_read_input_tokens: 90000 } } }),
    j({ type: 'assistant', timestamp: '2026-07-17T11:00:00Z', message: { model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
    j({ type: 'assistant', isSidechain: true, message: { model: 'claude-sonnet-5', usage: { input_tokens: 9e6, output_tokens: 9e6 } } }),
    'garbage line',
  ].join('\n');
  const { byModel, firstTs, lastTs } = scanUsage(text);
  assert.equal(byModel['claude-sonnet-5'].input, 1100);
  assert.equal(byModel['claude-sonnet-5'].output, 550);
  assert.equal(byModel['claude-sonnet-5'].cacheRead, 90000);
  assert.equal(byModel['claude-sonnet-5'].messages, 2, 'sidechain excluded');
  assert.ok(firstTs < lastTs);
});

test('priceUsage: dollars per model, sorted, sane', () => {
  const { total, perModel } = priceUsage({
    'claude-sonnet-5': { input: 1e6, output: 1e6, cacheWrite: 0, cacheRead: 0, messages: 1 },
    'claude-haiku-4-5': { input: 1e6, output: 0, cacheWrite: 0, cacheRead: 0, messages: 1 },
  });
  assert.equal(perModel[0].model, 'claude-sonnet-5', 'expensive model first');
  assert.ok(Math.abs(total - (3 + 15 + 0.8)) < 1e-9);
  assert.equal(usd(18.8), '$18.80');
});

test('rateFor: matches by substring, falls back to default', () => {
  assert.deepEqual(rateFor('claude-opus-4-8'), DEFAULT_PRICING.opus);
  assert.deepEqual(rateFor('something-unknown'), DEFAULT_PRICING.default);
  assert.deepEqual(rateFor('claude-opus-4-8', { opus: [1, 2, 3, 4], default: [0, 0, 0, 0] }), [1, 2, 3, 4]);
});

test('slopScore: risk climbs with churn, missing tests, full context', () => {
  const clean = slopScore({ filesChanged: 2, insertions: 40, deletions: 5, testsTouched: true, srcTouched: true, contextPct: 30, hasTrace: true });
  assert.equal(clean.level, 'low');

  const risky = slopScore({ filesChanged: 14, insertions: 900, deletions: 200, testsTouched: false, srcTouched: true, contextPct: 96, hasTrace: false, autonomousWindow: true });
  assert.equal(risky.level, 'high');
  assert.ok(risky.score > clean.score + 40);
  assert.ok(risky.reasons.some((r) => /no tests/.test(r)));
  assert.ok(risky.reasons.some((r) => /degradation zone/.test(r)));
  assert.ok(risky.score <= 100);
});
