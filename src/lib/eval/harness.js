// The Offline Evaluation Harness — benchmark agent accuracy, claims, and regressions.
//
// Zero cloud dependencies. No LangSmith or remote telemetry required.
// Measures agent performance against deterministic criteria:
// 1. Assertion pass (test commands exit 0)
// 2. Claim fidelity (receipt verified claims vs unsubstantiated/fabricated)
// 3. File scope precision (touched files vs expected scope)
// 4. Latency and token cost

import fs from 'node:fs';
import path from 'node:path';

export function evalsDir(praxisDir) {
  return path.join(praxisDir, 'evals');
}

/**
 * Validate an evaluation suite specification.
 */
export function validateEvalSuite(suite) {
  if (!suite || typeof suite !== 'object') {
    return { ok: false, error: 'Eval suite must be an object' };
  }
  if (!suite.name || typeof suite.name !== 'string') {
    return { ok: false, error: 'Eval suite requires a non-empty "name"' };
  }
  if (!Array.isArray(suite.cases) || suite.cases.length === 0) {
    return { ok: false, error: 'Eval suite requires a non-empty "cases" array' };
  }

  for (const c of suite.cases) {
    if (!c.id || typeof c.id !== 'string') {
      return { ok: false, error: 'Each case requires an "id"' };
    }
    if (!c.task || typeof c.task !== 'string') {
      return { ok: false, error: `Case "${c.id}" requires a "task"` };
    }
  }

  return { ok: true };
}

/**
 * Score an agent execution against benchmark criteria.
 * Pure function — fully testable with mock receipts and stats.
 */
export function scoreEvalCase({
  testCase,
  exitCode,
  touchedFiles = [],
  receipt = null,
  durationMs = 0,
}) {
  const expectedFiles = new Set(testCase.expectedFiles || []);
  const forbiddenFiles = new Set(testCase.forbiddenFiles || []);

  let filePrecision = 1.0;
  if (expectedFiles.size > 0 && touchedFiles.length > 0) {
    const hits = touchedFiles.filter((f) => expectedFiles.has(f)).length;
    filePrecision = Math.round((hits / touchedFiles.length) * 100) / 100;
  }

  let forbiddenViolations = 0;
  for (const f of touchedFiles) {
    if (forbiddenFiles.has(f)) forbiddenViolations++;
  }

  let verifiedClaims = 0;
  let unverifiedClaims = 0;
  let fabricatedClaims = 0;

  if (receipt && Array.isArray(receipt.claims)) {
    for (const cl of receipt.claims) {
      if (cl.ruling === 'verified') verifiedClaims++;
      else if (cl.ruling === 'fabricated') fabricatedClaims++;
      else unverifiedClaims++;
    }
  }

  const totalClaims = verifiedClaims + unverifiedClaims + fabricatedClaims;
  const claimFidelity = totalClaims > 0 ? Math.round((verifiedClaims / totalClaims) * 100) / 100 : 1.0;

  const assertionPass = exitCode === 0 && forbiddenViolations === 0;
  const isPass = assertionPass && claimFidelity >= 0.7 && filePrecision >= 0.5;

  return {
    id: testCase.id,
    pass: isPass,
    assertionPass,
    claimFidelity,
    filePrecision,
    forbiddenViolations,
    verifiedClaims,
    unverifiedClaims,
    fabricatedClaims,
    durationMs,
    receiptVerdict: receipt ? receipt.verdict : 'NO_RECEIPT',
  };
}

/**
 * Compute aggregate benchmark suite metrics across all test cases.
 */
export function aggregateEvalMetrics(results) {
  if (!results.length) {
    return {
      total: 0,
      passed: 0,
      passRate: 0,
      avgClaimFidelity: 0,
      avgFilePrecision: 0,
      avgDurationMs: 0,
    };
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const avgClaimFidelity = Math.round((results.reduce((acc, r) => acc + r.claimFidelity, 0) / total) * 100) / 100;
  const avgFilePrecision = Math.round((results.reduce((acc, r) => acc + r.filePrecision, 0) / total) * 100) / 100;
  const avgDurationMs = Math.round(results.reduce((acc, r) => acc + r.durationMs, 0) / total);

  return {
    total,
    passed,
    passRate: Math.round((passed / total) * 100),
    avgClaimFidelity,
    avgFilePrecision,
    avgDurationMs,
  };
}

/**
 * List available benchmark suites in .praxis/evals/
 */
export function listEvalSuites(praxisDir) {
  const dir = evalsDir(praxisDir);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          return { file: f, name: s.name || f, description: s.description || '', casesCount: (s.cases || []).length };
        } catch {
          return { file: f, name: f, description: '(invalid json)', casesCount: 0 };
        }
      });
  } catch {
    return [];
  }
}
