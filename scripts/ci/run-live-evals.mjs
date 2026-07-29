#!/usr/bin/env node
// Judge certification, run for real (B4/D20). This is the gate that stands
// between a degraded judge and a published release: it runs EVERY scenario in
// the suite against a live model and blocks the publish if the judge either
// misses a rule or — far worse — accuses falsely.
//
//   node scripts/ci/run-live-evals.mjs                # real judge, costs cents
//   node scripts/ci/run-live-evals.mjs --concurrency 4
//
// The scenario list is READ FROM THE SUITE, never hardcoded (D48): when B11
// adds prompt-injection scenarios, this script certifies against them the day
// they land, and any public "N of N" number stays true by construction.

import { judge } from '../../src/lib/receipt/judge.js';
import { SCENARIOS } from '../../test/fixtures/eval-scenarios.mjs';
import { scoreScenario } from '../../test/fixtures/eval-run.mjs';

export const DEFAULT_CONCURRENCY = 4;

/**
 * Run tasks with a bounded worker pool, preserving input order in the results.
 * Independent API calls, so concurrency keeps tag-to-approval under ~5 minutes
 * as the suite grows (D52) — without stampeding the provider.
 */
export async function runWithConcurrency(items, worker, limit = DEFAULT_CONCURRENCY) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * The verdict on the verdicts. The bar is asymmetric on purpose: a single false
 * accusation fails the run outright, because a verifier that falsely accuses
 * once is worse than no verifier at all.
 */
export function summarize(results) {
  const falseAccusations = results.filter((r) => !r.forbidPass);
  const passed = results.filter((r) => r.expectPass && r.forbidPass);
  return {
    total: results.length,
    passed: passed.length,
    falseAccusations,
    ok: falseAccusations.length === 0 && passed.length === results.length,
    line: `${passed.length}/${results.length} scenarios pass · ${falseAccusations.length} false accusations`,
  };
}

async function main() {
  // Fail fast with the ACTUAL problem. Without this, a missing secret runs
  // all seven scenarios against nothing and reports seven "judge unavailable"
  // misses — which reads as a broken judge and cost a release cycle to
  // diagnose. A judge with no key is not a judge that failed; it is a judge
  // that was never hired. CI-only: a local `claude` login needs no env key,
  // and this guard must never block a run that would have worked.
  if (process.env.CI && !process.env.PRAXIS_JUDGE_CMD && !process.env.ANTHROPIC_API_KEY) {
    console.error(
      '::error title=certification cannot run::ANTHROPIC_API_KEY is empty — add the repository secret ' +
        '(Settings → Secrets and variables → Actions) or set PRAXIS_JUDGE_CMD. No scenario was attempted.',
    );
    process.exit(1);
  }
  const ci = process.argv.indexOf('--concurrency');
  const limit = ci > -1 ? Number(process.argv[ci + 1]) || DEFAULT_CONCURRENCY : DEFAULT_CONCURRENCY;

  console.log(`JUDGE CERTIFICATION — ${SCENARIOS.length} scenarios, ${limit}-way concurrent\n`);
  const started = Date.now();

  const results = await runWithConcurrency(
    SCENARIOS,
    async (s) => {
      const r = await judge({ evidence: s.evidence, claimProse: s.claimProse });
      if (!r.ok) {
        return { name: s.name, expectPass: false, forbidPass: true, notes: ['judge unavailable: ' + r.reason] };
      }
      return scoreScenario(s, r.verdicts);
    },
    limit,
  );

  for (const r of results) {
    const mark = !r.forbidPass ? 'FALSE-ACCUSATION' : r.expectPass ? 'PASS' : 'MISS';
    console.log(`${mark.padEnd(17)} ${r.name}`);
    for (const n of r.notes || []) console.log(`                  ${n}`);
  }

  const s = summarize(results);
  console.log(`\n${s.line} · ${Math.round((Date.now() - started) / 1000)}s`);
  if (!s.ok) {
    console.error(
      s.falseAccusations.length
        ? '\nBLOCKED: the judge accused falsely. This release does not ship.'
        : '\nBLOCKED: not every certification scenario passed.',
    );
  }
  process.exit(s.ok ? 0 : 1);
}

if (process.argv[1]?.endsWith('run-live-evals.mjs')) main();
