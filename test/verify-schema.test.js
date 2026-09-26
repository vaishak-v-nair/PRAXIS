import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLAIM_SCHEMA, VerifyInputError, parseManifestText, validateManifest } from '../src/lib/verify/schema.js';
import { extractClaimsFromText } from '../src/lib/verify/claims.js';

test('claim manifest freezes stable atomic claims and rejects duplicate ids', () => {
  const manifest = validateManifest({ schema: CLAIM_SCHEMA, claims: [{ id: 'docs', sourceText: 'Updated README.md', scope: { kind: 'file-change', paths: ['README.md'] }, requiredEvidence: ['file-change'] }] });
  assert.equal(manifest.claims[0].id, 'docs');
  assert.ok(Object.isFrozen(manifest.claims[0]));
  assert.ok(Object.isFrozen(manifest.claims[0].scope));
  assert.ok(Object.isFrozen(manifest.claims[0].scope.paths));
  assert.ok(Object.isFrozen(manifest.claims[0].source));
  assert.throws(() => validateManifest({ schema: CLAIM_SCHEMA, claims: [{ id: 'x', sourceText: 'Updated one.md', scope: { kind: 'file-change', paths: ['one.md'] } }, { id: 'x', sourceText: 'Updated two.md', scope: { kind: 'file-change', paths: ['two.md'] } }] }), /Duplicate/);
});

test('manifest parser refuses traversal, malformed JSON and oversized input', () => {
  assert.throws(() => parseManifestText('{'), (error) => error instanceof VerifyInputError && error.code === 'malformed-manifest');
  assert.throws(() => validateManifest({ schema: CLAIM_SCHEMA, claims: [{ sourceText: 'changed it', scope: { path: '../secret' } }] }), /outside the repository/);
  assert.throws(() => parseManifestText(' '.repeat(2 * 1024 * 1024 + 1)), (error) => error.code === 'manifest-too-large');
});

test('plain report extraction identifies file and test claims without executing text', () => {
  const manifest = extractClaimsFromText('- Updated `README.md`.\n- All tests passed.\n- Maybe coffee later.');
  assert.equal(manifest.claims.length, 2);
  assert.equal(manifest.claims[0].scope.kind, 'file-change');
  assert.deepEqual(manifest.claims[0].scope.paths, ['README.md']);
  assert.equal(manifest.claims[1].scope.kind, 'tests-pass');
});

test('a semantic implementation claim does not become a path-change predicate', () => {
  const manifest = extractClaimsFromText('Implemented authentication in `src/auth.js`.');
  assert.equal(manifest.claims[0].scope.kind, 'generic');
  assert.deepEqual(manifest.claims[0].requiredEvidence, []);
});
