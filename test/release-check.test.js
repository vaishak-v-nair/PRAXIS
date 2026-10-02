import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkMetadata, checkPackage, REGISTRY, REQUIRED_FILES } from '../scripts/ci/release-check.mjs';

function metadata() {
  return { name: 'praxis-memory', version: '0.14.1', bin: { praxis: 'src/cli.js', 'praxis-memory': 'src/cli.js' }, publishConfig: { registry: REGISTRY, access: 'public' } };
}
const lock = { name: 'praxis-memory', version: '0.14.1', packages: { '': { version: '0.14.1' } } };
const changelog = '## [0.14.1] — 2026-10-01\n\nFixed unsafe installation.\n';
const entry = { unpackedSize: 1000, files: REQUIRED_FILES.map(path => ({ path })) };

test('release metadata refuses version drift, runtime dependencies, missing notes and wrong registry', () => {
  assert.equal(checkMetadata(metadata(), lock, changelog).ok, true);
  for (const pkg of [{ ...metadata(), version: '0.14.0' }, { ...metadata(), dependencies: { example: '1' } },
    { ...metadata(), optionalDependencies: { example: '1' } }, { ...metadata(), publishConfig: { registry: 'https://example.test', access: 'public' } }]) {
    assert.equal(checkMetadata(pkg, lock, changelog).ok, false);
  }
  assert.equal(checkMetadata(metadata(), lock, '## [Unreleased]\nChanges\n').ok, false);
});

test('the actual packed paths reject nested secrets, private state, sample projects and excess weight', () => {
  assert.equal(checkPackage(entry).ok, true);
  for (const path of ['assets/master.png', 'Personal Intelligence/notes.md', '.praxis/memory.md',
    'apps/workbench/.env', 'apps/workbench/.env.local', 'apps/workbench/.regen/jobs.db',
    'apps/workbench/.venv/Scripts/python.exe', 'apps/workbench/node_modules/next/index.js',
    'apps/workbench/.next/BUILD_ID', 'apps/workbench/backend/__pycache__/secret.pyc',
    'apps/workbench/repos/Zentara/project.py', 'apps/workbench/keys/ed25519-private.pem']) {
    assert.equal(checkPackage({ ...entry, files: [...entry.files, { path }] }).ok, false, path);
  }
  assert.equal(checkPackage({ ...entry, files: entry.files.slice(1) }).ok, false);
  assert.equal(checkPackage({ ...entry, unpackedSize: 4 * 1024 * 1024 }).ok, false);
  assert.equal(checkPackage({ ...entry, files: [...entry.files, { path: 'apps/workbench/.env.example' }] }).ok, true);
});

test('publishing is user-triggered and the local prepublish lifecycle retains all release gates', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts.prepublishOnly, 'node scripts/ci/release-check.mjs');
  assert.equal(pkg.scripts['release:check'], pkg.scripts.prepublishOnly);
  const workflow = fs.readFileSync('.github/workflows/release.yml', 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+push:/, 'a tag push must not publish automatically');
  assert.match(workflow, /verify-golden/);
  assert.match(workflow, /workbench/);
});
