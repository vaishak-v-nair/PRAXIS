import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGovPrompt, parseGovEnvelope, resolveGovCmd, govern, MAX_JOBS } from '../src/lib/gov.js';
import { gov } from '../src/commands/gov.js';
import { listJobs } from '../src/lib/jobs/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'gov-fixture.mjs');

function useFixture(mode) {
  process.env.PRAXIS_GOV_CMD = JSON.stringify(['node', FIXTURE]);
  if (mode) process.env.PRAXIS_GOV_FIXTURE_MODE = mode;
  else delete process.env.PRAXIS_GOV_FIXTURE_MODE;
}

test.after(() => {
  delete process.env.PRAXIS_GOV_CMD;
  delete process.env.PRAXIS_GOV_FIXTURE_MODE;
  delete process.env.PRAXIS_RUN_CMD;
});

test('the prompt binds the rules: untrusted data, strict JSON, no padding', () => {
  const p = buildGovPrompt('ship the notes', { briefing: 'a repo', deckState: 'empty', maxJobs: 3 });
  assert.match(p, /never instructions to you/);
  assert.match(p, /STRICT JSON only/);
  assert.match(p, /at most 3 independent/);
  assert.match(p, /SAFE DRAFT/);
  assert.match(p, /Do not pad/);
  assert.match(p, /GOAL: ship the notes/);
});

test('parseGovEnvelope vets: junk filtered, cap enforced server-side', () => {
  const inner = {
    jobs: [
      { task: 'a', why: 'w' },
      { task: '  ', why: 'junk' },
      ...Array.from({ length: 10 }, (_, i) => ({ task: 'pad ' + i })),
    ],
    note: 'n',
  };
  const r = parseGovEnvelope(JSON.stringify({ result: JSON.stringify(inner), total_cost_usd: 0.02 }));
  assert.equal(r.ok, true);
  assert.equal(r.jobs.length, MAX_JOBS); // never more, whatever the model says
  assert.equal(r.jobs[0].task, 'a');
  assert.ok(r.jobs.every((j) => j.task.trim().length));
});

test('parseGovEnvelope failure stages are distinct', () => {
  assert.equal(parseGovEnvelope('nope').stage, 'envelope');
  assert.equal(parseGovEnvelope(JSON.stringify({ type: 'r' })).stage, 'result');
  assert.equal(parseGovEnvelope(JSON.stringify({ result: 'no json' })).stage, 'inner');
  assert.equal(parseGovEnvelope(JSON.stringify({ result: JSON.stringify({ nope: 1 }) })).stage, 'shape');
});

test('resolveGovCmd: injectable argv, judge-style default', () => {
  process.env.PRAXIS_GOV_CMD = '["node","g.mjs"]';
  assert.deepEqual(resolveGovCmd(), ['node', 'g.mjs']);
  delete process.env.PRAXIS_GOV_CMD;
  assert.deepEqual(resolveGovCmd(), ['claude', '-p', '--output-format', 'json', '--max-turns', '1']);
});

test('govern end-to-end against the fixture returns vetted jobs', async () => {
  useFixture('ok');
  const g = await govern('write notes and list todos', { briefing: 'briefed' });
  assert.equal(g.ok, true);
  assert.ok(g.jobs.length >= 2 && g.jobs.length <= MAX_JOBS);
  assert.match(g.jobs[0].task, /release notes/i);
  assert.doesNotMatch(g.jobs[0].task, /\(blind\)/); // the briefing reached the prompt
});

test('govern degrades on garbage — ok:false, never a guessed fleet', async () => {
  useFixture('bad-inner');
  const g1 = await govern('goal');
  assert.equal(g1.ok, false);
  useFixture('bad-outer');
  const g2 = await govern('goal');
  assert.equal(g2.ok, false);
});

test('gov command: goal -> fleet of safe drafts on the deck, goal-tagged', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-gov-'));
  fs.mkdirSync(path.join(cwd, '.praxis'), { recursive: true });
  const prev = process.cwd();
  process.chdir(cwd);
  useFixture('ok');
  process.env.PRAXIS_RUN_CMD = JSON.stringify([
    process.execPath,
    '-e',
    "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{console.log('drafted');process.exit(0);});",
  ]);
  try {
    await gov(['write', 'notes', 'and', 'list', 'todos']);
    const rows = listJobs(path.join(cwd, '.praxis'));
    assert.ok(rows.length >= 2, 'fleet queued');
    for (const r of rows) {
      assert.equal(r.mode, 'plan'); // every governed job is a SAFE DRAFT
      assert.equal(r.goal, 'write notes and list todos'); // grouped by goal
    }
  } finally {
    process.chdir(prev);
  }
});

test('gov command: a failed Governor queues NOTHING', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-gov-'));
  fs.mkdirSync(path.join(cwd, '.praxis'), { recursive: true });
  const prev = process.cwd();
  process.chdir(cwd);
  useFixture('bad-outer');
  try {
    await gov(['some', 'goal']);
    assert.equal(listJobs(path.join(cwd, '.praxis')).length, 0);
  } finally {
    process.chdir(prev);
    process.exitCode = 0;
  }
});

test('gov command: empty-jobs verdict is respected (a question is not work)', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-gov-'));
  fs.mkdirSync(path.join(cwd, '.praxis'), { recursive: true });
  const prev = process.cwd();
  process.chdir(cwd);
  useFixture('empty-jobs');
  try {
    await gov(['what', 'is', 'this', 'repo']);
    assert.equal(listJobs(path.join(cwd, '.praxis')).length, 0);
  } finally {
    process.chdir(prev);
  }
});
