import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateEvalSuite,
  scoreEvalCase,
  aggregateEvalMetrics,
} from '../src/lib/eval/harness.js';

test('validateEvalSuite validates valid and invalid suites', () => {
  const valid = {
    name: 'suite-1',
    description: 'test suite',
    cases: [{ id: 'c1', task: 'Do a task' }],
  };
  assert.equal(validateEvalSuite(valid).ok, true);

  assert.equal(validateEvalSuite(null).ok, false);
  assert.equal(validateEvalSuite({}).ok, false);
  assert.equal(validateEvalSuite({ name: 'x', cases: [] }).ok, false);
  assert.equal(validateEvalSuite({ name: 'x', cases: [{ id: 'c1' }] }).ok, false);
});

test('scoreEvalCase calculates pass, fidelity, and precision', () => {
  const testCase = {
    id: 'c1',
    task: 'Fix a bug',
    expectedFiles: ['src/a.js'],
    forbiddenFiles: ['package.json'],
  };

  const goodReceipt = {
    verdict: 'VERIFIED',
    claims: [
      { text: 'Edited file', ruling: 'verified' },
      { text: 'Ran tests', ruling: 'verified' },
    ],
  };

  const goodScore = scoreEvalCase({
    testCase,
    exitCode: 0,
    touchedFiles: ['src/a.js'],
    receipt: goodReceipt,
    durationMs: 500,
  });

  assert.equal(goodScore.pass, true);
  assert.equal(goodScore.assertionPass, true);
  assert.equal(goodScore.claimFidelity, 1.0);
  assert.equal(goodScore.filePrecision, 1.0);
  assert.equal(goodScore.forbiddenViolations, 0);

  // Failure scenario: touched forbidden file
  const badScore = scoreEvalCase({
    testCase,
    exitCode: 0,
    touchedFiles: ['src/a.js', 'package.json'],
    receipt: goodReceipt,
    durationMs: 500,
  });
  assert.equal(badScore.pass, false);
  assert.equal(badScore.forbiddenViolations, 1);
});

test('aggregateEvalMetrics aggregates multiple cases accurately', () => {
  const results = [
    { pass: true, claimFidelity: 1.0, filePrecision: 1.0, durationMs: 100 },
    { pass: false, claimFidelity: 0.5, filePrecision: 0.5, durationMs: 200 },
  ];

  const agg = aggregateEvalMetrics(results);
  assert.equal(agg.total, 2);
  assert.equal(agg.passed, 1);
  assert.equal(agg.passRate, 50);
  assert.equal(agg.avgClaimFidelity, 0.75);
  assert.equal(agg.avgFilePrecision, 0.75);
  assert.equal(agg.avgDurationMs, 150);
});
