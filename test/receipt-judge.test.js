import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildJudgePrompt,
  parseJudgeEnvelope,
  resolveJudgeCmd,
  judge,
} from '../src/lib/receipt/judge.js';
import { collectEvidence, collectClaimProse } from '../src/lib/receipt/collectors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'judge-fixture.mjs');

// Point the judge at the node fixture — argv array, zero tokens, cross-platform.
function useFixture(mode) {
  process.env.PRAXIS_JUDGE_CMD = JSON.stringify(['node', FIXTURE]);
  if (mode) process.env.PRAXIS_JUDGE_FIXTURE_MODE = mode;
  else delete process.env.PRAXIS_JUDGE_FIXTURE_MODE;
}

const SAMPLE_TRANSCRIPT = [
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'All tests pass. Updated the docs.' }] } }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } }),
].join('\n');

test('resolveJudgeCmd parses an injected JSON-array command', () => {
  process.env.PRAXIS_JUDGE_CMD = '["node","x.mjs","--flag"]';
  assert.deepEqual(resolveJudgeCmd(), ['node', 'x.mjs', '--flag']);
  delete process.env.PRAXIS_JUDGE_CMD;
});

test('resolveJudgeCmd defaults to claude -p json max-turns-1', () => {
  delete process.env.PRAXIS_JUDGE_CMD;
  assert.deepEqual(resolveJudgeCmd(), ['claude', '-p', '--output-format', 'json', '--max-turns', '1']);
});

test('buildJudgePrompt marks data untrusted and forbids FALSE-on-absence', () => {
  const p = buildJudgePrompt({ channels_harvested: ['Bash'] }, [{ turn: 1, text: 'done' }]);
  assert.match(p, /untrusted session data/);
  assert.match(p, /Never FALSE on absence alone|UNVERIFIABLE, never FALSE/);
  assert.match(p, /STRICT JSON only/);
  assert.match(p, /EVIDENCE RECORD/);
  assert.match(p, /CLAIM SOURCE/);
});

test('parseJudgeEnvelope handles the real double-parse (result is a JSON string)', () => {
  const env = JSON.stringify({ result: JSON.stringify({ verdicts: [{ claim: 'x', verdict: 'TRUE' }] }), total_cost_usd: 0.03 });
  const r = parseJudgeEnvelope(env);
  assert.equal(r.ok, true);
  assert.equal(r.verdicts.length, 1);
  assert.equal(r.cost, 0.03);
});

test('parseJudgeEnvelope reports malformed OUTER envelope distinctly', () => {
  const r = parseJudgeEnvelope('not json');
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'envelope');
});

test('parseJudgeEnvelope reports malformed INNER json distinctly', () => {
  const r = parseJudgeEnvelope(JSON.stringify({ result: 'no json here' }));
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'inner');
});

test('parseJudgeEnvelope reports missing result field', () => {
  const r = parseJudgeEnvelope(JSON.stringify({ type: 'result' }));
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'result');
});

test('judge() end-to-end against the fixture returns verdicts', async () => {
  useFixture('ok');
  const evidence = collectEvidence(SAMPLE_TRANSCRIPT);
  const claimProse = collectClaimProse(SAMPLE_TRANSCRIPT);
  const r = await judge({ evidence, claimProse });
  assert.equal(r.ok, true);
  assert.equal(r.verdicts.length, 3);
  // the fixture rules the docs claim FALSE and the metaphor NOT_A_CLAIM
  assert.ok(r.verdicts.find((v) => v.verdict === 'FALSE'));
  assert.ok(r.verdicts.find((v) => v.verdict === 'NOT_A_CLAIM'));
  assert.equal(r.cost, 0.03);
});

test('judge() degrades to ok:false (never throws) on a dead binary', async () => {
  process.env.PRAXIS_JUDGE_CMD = JSON.stringify(['node', path.join(__dirname, 'fixtures', 'does-not-exist.mjs')]);
  const r = await judge({ evidence: {}, claimProse: [] });
  assert.equal(r.ok, false);
  assert.ok(r.reason);
});

test('judge() degrades on malformed inner JSON after one repair retry', async () => {
  useFixture('bad-inner');
  const r = await judge({ evidence: {}, claimProse: [] });
  assert.equal(r.ok, false); // both attempts return garbage
  assert.match(r.reason, /inner|JSON/i);
});

test('judge() recovers via the F2 repair retry', async () => {
  useFixture('bad-inner-then-ok');
  const r = await judge({ evidence: {}, claimProse: [] });
  assert.equal(r.ok, true); // first attempt garbage, repair attempt valid
  assert.equal(r.verdicts[0].claim, 'recovered');
});

test('judge() handles a malformed outer envelope (no retry, degrades)', async () => {
  useFixture('bad-outer');
  const r = await judge({ evidence: {}, claimProse: [] });
  assert.equal(r.ok, false);
});

test.after(() => {
  delete process.env.PRAXIS_JUDGE_CMD;
  delete process.env.PRAXIS_JUDGE_FIXTURE_MODE;
});
