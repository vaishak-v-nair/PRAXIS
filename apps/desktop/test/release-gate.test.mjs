import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkReleaseEvidenceFile, requiredTargets, validateReleaseEvidence, verifyNativeSignature } from '../scripts/release-gate.mjs';

const setup = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-release-gate-'));
  t.after(() => {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('praxis-release-gate-')) throw new Error('Refusing unexpected test cleanup path');
    fs.rmSync(root, { recursive: true, force: true });
  });
  const artifact = path.join(root, 'unsigned-release.exe');
  fs.writeFileSync(artifact, 'This is neither a signed release nor a valid executable.\n');
  const sha256 = createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
  const evidence = { schema: 'praxis.desktop-release-evidence.v1', targets: requiredTargets.map(target => ({ target, artifact, sha256, nativeAcceptance: 'passed', cleanInstall: 'passed', signature: { verified: true }, notarization: 'passed' })) };
  return { root, artifact, evidence };
};

test('self-asserted signatures cannot open the public release gate', t => {
  const { evidence } = setup(t);
  assert.throws(() => validateReleaseEvidence(evidence), /signature.*not valid|verification.*unavailable|verification failed/i);
});

test('release CLI exits unsuccessfully for the former unsigned-file bypass', t => {
  const { root, evidence } = setup(t), filename = path.join(root, 'metadata.json');
  fs.writeFileSync(filename, JSON.stringify(evidence));
  const script = fileURLToPath(new URL('../scripts/release-gate.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, filename], { encoding: 'utf8', timeout: 40_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /All advertised native targets/);
  assert.match(result.stderr, /signature.*not valid|verification.*unavailable|verification failed/i);
});

test('foreign signatures and Linux attestations fail closed instead of trusting metadata', t => {
  const { artifact } = setup(t);
  for (const target of ['darwin-arm64', 'darwin-x64', 'linux-x64']) {
    assert.throws(() => verifyNativeSignature(artifact, target), /verification is unavailable.*public release remains closed/i);
  }
});

test('a changed artifact fails before any signature assertion is considered', t => {
  const { artifact, evidence } = setup(t);
  fs.appendFileSync(artifact, 'Changed after the acceptance record');
  assert.throws(() => validateReleaseEvidence(evidence), /hash does not match/);
});

test('duplicate acceptance records and incomplete evidence are rejected', t => {
  const { evidence } = setup(t);
  evidence.targets.push({ ...evidence.targets[0] });
  assert.throws(() => validateReleaseEvidence(evidence), /exactly one/);
  assert.throws(() => validateReleaseEvidence({ schema: evidence.schema }), /Unrecognized/);
});

test('missing release evidence stays an explicit public-release gate', t => {
  const { root } = setup(t);
  assert.throws(() => checkReleaseEvidenceFile(path.join(root, 'missing.json')), /Public desktop release is unavailable/);
});
