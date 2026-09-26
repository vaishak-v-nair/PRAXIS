import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

export const CLAIM_SCHEMA = 'praxis.verify.claims/v1';
export const TASK_SCHEMA = 'praxis.verify.task/v1';
export const RESULT_SCHEMA = 'praxis.verify.result/v1';
export const POLICY_SCHEMA = 'praxis.verify.policy/v1';
export const VERDICTS = Object.freeze(['VERIFIED', 'CONTRADICTED', 'UNSUPPORTED', 'NEEDS_HUMAN_REVIEW']);

export const LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, claims: 200, text: 8000 });

export class VerifyInputError extends Error {
  constructor(code, message, nextCommand = null) {
    super(message);
    this.name = 'VerifyInputError';
    this.code = code;
    this.nextCommand = nextCommand;
  }
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function readBoundedRegularFile(file, label = 'input', maxBytes = LIMITS.bytes) {
  let handle;
  try {
    const before = fs.lstatSync(file);
    if (before.isSymbolicLink() || !before.isFile()) throw new VerifyInputError('invalid-input-file', `${label} must be a regular file, not a link or special file.`);
    if (before.size > maxBytes) throw new VerifyInputError('input-too-large', `${label} exceeds ${maxBytes} bytes.`);
    handle = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(Math.min(maxBytes + 1, Math.max(1, before.size + 1)));
    let total = 0;
    while (total < buffer.length) {
      const count = fs.readSync(handle, buffer, total, buffer.length - total, null);
      if (!count) break;
      total += count;
    }
    if (total > maxBytes) throw new VerifyInputError('input-too-large', `${label} exceeds ${maxBytes} bytes.`);
    const after = fs.fstatSync(handle);
    if (after.size !== before.size || total !== after.size) throw new VerifyInputError('input-changed', `${label} changed while PRAXIS was reading it.`);
    return buffer.subarray(0, total).toString('utf8');
  } catch (error) {
    if (error instanceof VerifyInputError) throw error;
    throw new VerifyInputError('input-unreadable', `Cannot read ${label}: ${error.message}`);
  } finally {
    if (handle !== undefined) try { fs.closeSync(handle); } catch { /* already closed */ }
  }
}

export function stableId(value, prefix = 'c') {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}`;
}

export function stripControls(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u009b]|\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

export function repoRelative(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new VerifyInputError('invalid-path', `Claim path is outside the repository: ${value}`);
  }
  return normalized;
}

function normalizeEvidence(values) {
  const allowed = new Set(['git-diff', 'file-change', 'test-result', 'build-result', 'dynamic-coverage', 'false-success', 'ci-result', 'static-analysis', 'github-context', 'ui-runtime', 'production-observation', 'database-state', 'human-review']);
  const result = [...new Set((Array.isArray(values) ? values : []).map(String))];
  for (const value of result) {
    if (!allowed.has(value)) throw new VerifyInputError('invalid-evidence-class', `Unknown evidence class: ${value}`);
  }
  return result;
}

export function validateClaim(raw, index = 0) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new VerifyInputError('invalid-claim', `Claim ${index + 1} must be an object.`);
  }
  const sourceText = stripControls(raw.sourceText ?? raw.claim ?? raw.text).trim();
  if (!sourceText) throw new VerifyInputError('invalid-claim', `Claim ${index + 1} has no source text.`);
  if (Buffer.byteLength(sourceText) > LIMITS.text) throw new VerifyInputError('claim-too-large', `Claim ${index + 1} exceeds ${LIMITS.text} bytes.`);
  const predicate = stripControls(raw.predicate ?? sourceText).replace(/\s+/g, ' ').trim();
  const scope = raw.scope && typeof raw.scope === 'object' ? { ...raw.scope } : {};
  if (scope.path) scope.path = repoRelative(scope.path);
  if (scope.paths !== undefined) {
    if (!Array.isArray(scope.paths)) throw new VerifyInputError('invalid-paths', `Claim ${index + 1} paths must be an array.`);
    scope.paths = Object.freeze([...new Set(scope.paths.map(repoRelative))]);
  }
  const kinds = new Set(['file-change', 'behavior-change', 'ui-behavior', 'production-bug', 'database-change', 'tests-pass', 'build-pass', 'ci-pass', 'generic']);
  scope.kind = scope.kind || 'generic';
  if (!kinds.has(scope.kind)) throw new VerifyInputError('invalid-claim-kind', `Unknown claim kind: ${scope.kind}`);
  if (scope.symbols !== undefined) {
    if (!Array.isArray(scope.symbols) || scope.symbols.some((v) => typeof v !== 'string' || !v.trim())) throw new VerifyInputError('invalid-symbols', `Claim ${index + 1} symbols must be nonempty strings.`);
    scope.symbols = Object.freeze([...new Set(scope.symbols.map((v) => stripControls(v).trim()))]);
  }
  if (scope.endpoint !== undefined) scope.endpoint = stripControls(scope.endpoint).trim();
  const scoped = scope.path || scope.paths?.length || scope.symbols?.length || scope.endpoint || ['tests-pass', 'build-pass', 'ci-pass'].includes(scope.kind);
  if (!scoped) throw new VerifyInputError('uncheckable-claim', `Claim ${index + 1} is too vague to verify independently.`);
  const id = stripControls(raw.id || stableId(`${index}\0${sourceText}\0${predicate}`)).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) throw new VerifyInputError('invalid-claim-id', `Invalid claim id: ${id}`);
  return deepFreeze({
    id,
    parentId: raw.parentId ? stripControls(raw.parentId) : null,
    sourceText,
    predicate,
    scope,
    source: raw.source && typeof raw.source === 'object' ? { ...raw.source } : { kind: 'manual' },
    requiredEvidence: normalizeEvidence(raw.requiredEvidence),
    required: raw.required !== false,
  });
}

export function validateManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new VerifyInputError('invalid-manifest', 'Claim manifest must be a JSON object.');
  if (raw.schema !== CLAIM_SCHEMA) throw new VerifyInputError('unsupported-manifest', `Expected schema ${CLAIM_SCHEMA}.`);
  if (!Array.isArray(raw.claims)) throw new VerifyInputError('invalid-manifest', 'Claim manifest must contain a claims array.');
  if (raw.claims.length > LIMITS.claims) throw new VerifyInputError('too-many-claims', `Claim manifest exceeds ${LIMITS.claims} claims.`);
  const claims = raw.claims.map(validateClaim);
  const ids = new Set();
  for (const claim of claims) {
    if (ids.has(claim.id)) throw new VerifyInputError('duplicate-claim-id', `Duplicate claim id: ${claim.id}`);
    ids.add(claim.id);
  }
  for (const claim of claims) {
    if (claim.parentId && !ids.has(claim.parentId)) throw new VerifyInputError('unknown-parent-claim', `Unknown parent claim: ${claim.parentId}`);
  }
  return deepFreeze({ schema: CLAIM_SCHEMA, claims });
}

export function parseManifestText(text) {
  const input = String(text ?? '');
  if (Buffer.byteLength(input) > LIMITS.bytes) throw new VerifyInputError('manifest-too-large', `Manifest exceeds ${LIMITS.bytes} bytes.`);
  try {
    return validateManifest(JSON.parse(input));
  } catch (error) {
    if (error instanceof VerifyInputError) throw error;
    throw new VerifyInputError('malformed-manifest', `Manifest is not valid JSON: ${error.message}`);
  }
}
