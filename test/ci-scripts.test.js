import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkBudget, parsePackJson, BUDGET_MB } from '../scripts/ci/tarball-budget.mjs';
import { runWithConcurrency, summarize, DEFAULT_CONCURRENCY } from '../scripts/ci/run-live-evals.mjs';

const MB = 1024 * 1024;

test('tarball budget: passes under, fails over, and always names the size', () => {
  const under = checkBudget(2.8 * MB);
  assert.equal(under.ok, true);
  assert.match(under.message, /2\.80MB/);
  assert.match(under.message, /3\.50MB/);

  const over = checkBudget(4 * MB);
  assert.equal(over.ok, false);
  assert.match(over.message, /EXCEEDS/);
  assert.match(over.message, /4\.00MB/, 'the failure names the actual size, not just "too big"');

  const exact = checkBudget(BUDGET_MB * MB);
  assert.equal(exact.ok, true, 'exactly at budget is within budget');
});

test('tarball budget: reads npm pack --json, refuses to guess when the field is missing', () => {
  const good = parsePackJson(
    JSON.stringify([{ name: 'praxis-memory', version: '0.10.0', entryCount: 71, unpackedSize: 2937000 }]),
  );
  assert.equal(good.unpackedSize, 2937000);
  assert.equal(good.files, 71);
  assert.equal(good.version, '0.10.0');

  assert.throws(() => parsePackJson('[{"name":"x"}]'), /unpackedSize/);
  assert.throws(() => parsePackJson('not json'), SyntaxError);
});

test('live-eval runner: bounded concurrency, order preserved', async () => {
  const items = Array.from({ length: 9 }, (_, i) => i);
  let inFlight = 0;
  let peak = 0;

  const out = await runWithConcurrency(
    items,
    async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    },
    3,
  );

  assert.deepEqual(out, items.map((n) => n * 2), 'results come back in input order');
  assert.ok(peak <= 3, `never exceeded the limit (peak ${peak})`);
  assert.ok(peak > 1, 'actually ran concurrently');
});

test('live-eval runner: a single false accusation fails the whole run', () => {
  const clean = summarize([
    { name: 'a', expectPass: true, forbidPass: true },
    { name: 'b', expectPass: true, forbidPass: true },
  ]);
  assert.equal(clean.ok, true);
  assert.match(clean.line, /2\/2/);

  const missed = summarize([
    { name: 'a', expectPass: true, forbidPass: true },
    { name: 'b', expectPass: false, forbidPass: true },
  ]);
  assert.equal(missed.ok, false, 'a missed rule blocks the release');
  assert.equal(missed.falseAccusations.length, 0);

  const accused = summarize([
    { name: 'a', expectPass: true, forbidPass: true },
    { name: 'b', expectPass: true, forbidPass: false },
  ]);
  assert.equal(accused.ok, false);
  assert.equal(accused.falseAccusations.length, 1, 'the false-accusation floor is zero, non-negotiable');
});

test('live-eval runner: default concurrency is sane', () => {
  assert.ok(DEFAULT_CONCURRENCY >= 1 && DEFAULT_CONCURRENCY <= 8);
});
