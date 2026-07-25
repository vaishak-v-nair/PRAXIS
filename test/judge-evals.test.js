// Unit-1: the judge eval suite.
//
// CI (always, zero tokens): the scenario data is sane, the scorer is correct,
// and the eval runner's plumbing works end-to-end against the fixture judge.
// LIVE (opt-in, real model calls): PRAXIS_EVAL_LIVE=1 runs every scenario
// against the real judge and asserts the trust floor — run it before trusting
// a new judge model or shipping a judge-prompt change (see unit-6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './fixtures/eval-scenarios.mjs';
import { scoreScenario } from './fixtures/eval-run.mjs';
import { judge } from '../src/lib/receipt/judge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'judge-fixture.mjs');
const LIVE = process.env.PRAXIS_EVAL_LIVE === '1';

test('every scenario is well-formed: evidence, claims, and a trust rule', () => {
  assert.ok(SCENARIOS.length >= 7, 'the seven iron-rule scenarios exist');
  for (const s of SCENARIOS) {
    assert.ok(s.name && s.rule, s.name + ' names its rule');
    assert.ok(Array.isArray(s.claimProse) && s.claimProse.length, s.name + ' has claims');
    assert.ok(s.evidence.completeness_note.includes('UNVERIFIABLE'), s.name + ' evidence carries the absence rule');
    assert.ok((s.expect || []).length + (s.forbid || []).length > 0, s.name + ' asserts something');
    for (const r of s.expect || []) assert.ok(r.claim instanceof RegExp && r.allowed.length, s.name + ' expect rules valid');
  }
});

test('the false-accusation floor is encoded: every absence/blocked scenario forbids FALSE', () => {
  const floor = SCENARIOS.filter((s) => ['absence-yields-unverifiable', 'blocked-command-not-false-from-presence'].includes(s.name));
  assert.equal(floor.length, 2);
  for (const s of floor) {
    assert.ok(s.forbid.some((f) => f.verdict === 'FALSE'), s.name + ' forbids FALSE');
  }
});

test('scorer: allowed-set pass, forbid pass', () => {
  const s = SCENARIOS.find((x) => x.name === 'absence-yields-unverifiable');
  const r = scoreScenario(s, [{ claim: 'deployed the service', verdict: 'UNVERIFIABLE' }]);
  assert.equal(r.expectPass, true);
  assert.equal(r.forbidPass, true);
});

test('scorer: a false accusation is caught and named', () => {
  const s = SCENARIOS.find((x) => x.name === 'blocked-command-not-false-from-presence');
  const r = scoreScenario(s, [{ claim: 'npm publish was blocked', verdict: 'FALSE' }]);
  assert.equal(r.forbidPass, false);
  assert.match(r.notes.join(' '), /FORBIDDEN/);
});

test('scorer: wrong verdict misses the allowed set', () => {
  const s = SCENARIOS.find((x) => x.name === 'denial-contradicted-by-presence');
  const r = scoreScenario(s, [{ claim: 'never ran the tests', verdict: 'UNVERIFIABLE' }]);
  assert.equal(r.expectPass, false);
});

test('scorer: zero verdicts never passes (an empty sheet is not a clean sheet)', () => {
  const r = scoreScenario(SCENARIOS[0], []);
  assert.equal(r.expectPass, false);
});

test('plumbing: a scenario flows through judge() against the fixture end-to-end', async () => {
  process.env.PRAXIS_JUDGE_CMD = JSON.stringify(['node', FIXTURE]);
  delete process.env.PRAXIS_JUDGE_FIXTURE_MODE;
  const s = SCENARIOS[0];
  const r = await judge({ evidence: s.evidence, claimProse: s.claimProse });
  assert.equal(r.ok, true);
  const scored = scoreScenario(s, r.verdicts);
  assert.ok(Array.isArray(scored.notes)); // scoring ran; fixture verdicts are canned, not graded
  delete process.env.PRAXIS_JUDGE_CMD;
});

// ── live grading (opt-in; one real model call per scenario) ────────────────
for (const s of SCENARIOS) {
  test(`LIVE judge: ${s.name}`, { skip: !LIVE && 'set PRAXIS_EVAL_LIVE=1 to grade the real judge' }, async () => {
    const r = await judge({ evidence: s.evidence, claimProse: s.claimProse }, { timeoutMs: 180000 });
    assert.equal(r.ok, true, 'judge responded');
    const scored = scoreScenario(s, r.verdicts);
    assert.equal(scored.forbidPass, true, 'FALSE-ACCUSATION: ' + scored.notes.join('; '));
    assert.equal(scored.expectPass, true, scored.notes.join('; '));
  });
}
