#!/usr/bin/env node
// Run the judge eval scenarios against WHATEVER judge PRAXIS_JUDGE_CMD points
// at, and print a scorecard. This is how a judge model earns (or loses) the
// right to issue verdicts:
//
//   node test/fixtures/eval-run.mjs               # real judge (claude -p ...)
//   PRAXIS_JUDGE_CMD='["node","test/fixtures/judge-fixture.mjs"]' \
//     node test/fixtures/eval-run.mjs             # plumbing check, zero tokens
//
// Exit code: 0 if every forbid rule holds (no false accusations) AND the
// allowed-set pass rate meets the bar (default 6/7, override --min N).
// unit-6 (judge prompt tuning) uses the scorecard as its before/after metric.

import { judge } from '../../src/lib/receipt/judge.js';
import { SCENARIOS } from './eval-scenarios.mjs';

/** Score one scenario's verdicts against its expectations. Pure. */
export function scoreScenario(scenario, verdicts) {
  const out = { name: scenario.name, expectPass: true, forbidPass: true, notes: [] };
  if (!Array.isArray(verdicts) || verdicts.length === 0) {
    out.expectPass = false;
    out.notes.push('no verdicts returned');
    return out;
  }
  for (const rule of scenario.expect || []) {
    const matches = verdicts.filter((v) => rule.claim.test(String(v.claim || '')));
    if (!matches.length) {
      out.expectPass = false;
      out.notes.push(`no verdict matched ${rule.claim}`);
      continue;
    }
    if (!matches.some((v) => rule.allowed.includes(v.verdict))) {
      out.expectPass = false;
      out.notes.push(`${rule.claim} got [${matches.map((v) => v.verdict).join(',')}], wanted one of [${rule.allowed.join(',')}]`);
    }
  }
  for (const rule of scenario.forbid || []) {
    const bad = verdicts.filter((v) => rule.claim.test(String(v.claim || '')) && v.verdict === rule.verdict);
    if (bad.length) {
      out.forbidPass = false;
      out.notes.push(`FORBIDDEN: ${rule.claim} ruled ${rule.verdict} ("${bad[0].claim}")`);
    }
  }
  return out;
}

async function main() {
  const minArg = process.argv.indexOf('--min');
  const minPass = minArg > -1 ? Number(process.argv[minArg + 1]) : SCENARIOS.length - 1;

  const results = [];
  for (const s of SCENARIOS) {
    const r = await judge({ evidence: s.evidence, claimProse: s.claimProse });
    if (!r.ok) {
      results.push({ name: s.name, expectPass: false, forbidPass: true, notes: ['judge unavailable: ' + r.reason] });
      continue;
    }
    results.push(scoreScenario(s, r.verdicts));
  }

  let expectPasses = 0;
  let forbidFails = 0;
  console.log('\nJUDGE EVAL SCORECARD');
  console.log('--------------------');
  for (const r of results) {
    const mark = r.forbidPass ? (r.expectPass ? 'PASS ' : 'MISS ') : 'FALSE-ACCUSATION';
    if (r.expectPass && r.forbidPass) expectPasses++;
    if (!r.forbidPass) forbidFails++;
    console.log(`${mark}  ${r.name}${r.notes.length ? '  — ' + r.notes.join('; ') : ''}`);
  }
  console.log('--------------------');
  console.log(`allowed-set: ${expectPasses}/${results.length} (bar: ${minPass})   false accusations: ${forbidFails} (bar: 0)`);

  process.exitCode = forbidFails === 0 && expectPasses >= minPass ? 0 : 1;
}

// import.meta.main is not universal; run only when invoked directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main();
}
