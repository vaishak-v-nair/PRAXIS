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
  if (!suite || typeof suite !== 'object' || Array.isArray(suite)) {
    return { ok: false, error: 'Eval suite must be an object' };
  }
  if (typeof suite.name !== 'string' || !suite.name.trim()) {
    return { ok: false, error: 'Eval suite requires a non-empty "name"' };
  }
  if (!Array.isArray(suite.cases) || suite.cases.length === 0) {
    return { ok: false, error: 'Eval suite requires a non-empty "cases" array' };
  }

  const ids = new Set();
  for (const c of suite.cases) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, error: 'Each case must be an object' };
    if (typeof c.id !== 'string' || !c.id.trim()) {
      return { ok: false, error: 'Each case requires an "id"' };
    }
    if (ids.has(c.id)) return { ok: false, error: `Duplicate case id "${c.id}"` };
    ids.add(c.id);
    if (typeof c.task !== 'string' || !c.task.trim()) {
      return { ok: false, error: `Case "${c.id}" requires a "task"` };
    }
    for (const key of ['expectedFiles', 'forbiddenFiles']) {
      if (c[key] !== undefined && (!Array.isArray(c[key]) || c[key].some(f => typeof f !== 'string' || !f.trim()))) {
        return { ok: false, error: `Case "${c.id}" ${key} must be an array of non-empty paths` };
      }
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

  touchedFiles = [...new Set(touchedFiles)];
  let filePrecision = expectedFiles.size > 0 ? 0 : 1.0;
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
      // Historical receipts store verdicts, not lowercase `ruling` fields.
      // Keep compatibility with older benchmark inputs without changing a
      // single receipt or treating non-claims as failed claims.
      const ruling = cl?.verdict ?? cl?.ruling;
      if (ruling === 'NOT_A_CLAIM') continue;
      if (['TRUE', 'VERIFIED', 'verified'].includes(ruling)) verifiedClaims++;
      else if (['FALSE', 'CONTRADICTED', 'fabricated'].includes(ruling)) fabricatedClaims++;
      else unverifiedClaims++;
    }
  }

  const totalClaims = verifiedClaims + unverifiedClaims + fabricatedClaims;
  const claimFidelity = totalClaims > 0 ? Math.round((verifiedClaims / totalClaims) * 100) / 100 : 0;

  const assertionPass = exitCode === 0 && forbiddenViolations === 0;
  const receiptUsable = Boolean(receipt) && receipt.sealed !== false && (!receipt.chain || receipt.chain.ok === true);
  const isPass = assertionPass && receiptUsable && fabricatedClaims === 0 && claimFidelity >= 0.7 && filePrecision >= 0.5;

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
