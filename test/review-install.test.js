import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { reviewHome, reviewSources, reviewLayout, stageReview, setupReview, managedStatus } from '../src/lib/review-install.js';
import { workbenchStatus } from '../src/lib/workbench.js';
import { reviewOptions } from '../src/commands/review.js';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis review tests '));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source'), home = path.join(directory, 'managed');
  const write = (file, text) => { const target = path.join(source, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  for (const [file, text] of [['package.json', '{"name":"fixture","version":"1.0.0"}'], ['package-lock.json', '{}'],
    ['app/page.tsx', '// fixture'], ['components/example.tsx', '// fixture'], ['backend/regen/app.py', '# fixture'],
    ['backend/requirements.txt', '# fixture'], ['tools/backend.mjs', '// fixture'],
    ['.env', 'private-fixture'], ['.regen/saved.json', 'private-evidence'], ['backend/tests/test_secret.py', '# not runtime'],
    ['node_modules/fake/index.js', '// not runtime'], ['public/.env', 'private-fixture']]) write(file, text);
  return { directory, source, home, write, layout: reviewLayout({ source, home, version: '1.0.0' }) };
}

test('consumer help and check are inert even from a project without configuration', t => {
  const { directory, home } = fixture(t);
  const cli = path.resolve('src/cli.js');
  for (const args of [['--help'], ['--check', '--json', '--home', home]]) {
    const result = spawnSync(process.execPath, [cli, 'review', ...args], { cwd: directory, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, args[0] === '--help' ? 0 : 1, result.stderr);
    if (args[0] === '--check') { const status = JSON.parse(result.stdout); assert.equal(status.ok, false); assert.equal(status.home, home); }
    else assert.match(result.stdout, /Project execution and applying changes require confirmation/);
    assert.equal(fs.existsSync(home), false, 'readiness does not install, start or write state');
    assert.equal(fs.existsSync(path.join(directory, '.praxis')), false);
  }
  assert.throws(() => reviewOptions(['--home']), /requires/);
  assert.throws(() => reviewOptions(['--json']), /--check/);
  assert.throws(() => reviewOptions(['--check', '--setup-only']), /separately/);
});

test('managed runtime copies only canonical app source, never project evidence or credentials', t => {
  const { layout, source } = fixture(t);
  const files = reviewSources(source).files.map(file => file.relative);
  assert.ok(files.includes('backend/regen/app.py'));
  assert.ok(files.includes('tools/backend.mjs'));
  assert.ok(files.every(file => !/(\.env|\.regen|node_modules|backend\/tests)/.test(file)));
  stageReview(layout);
  assert.equal(fs.existsSync(path.join(layout.root, '.env')), false);
  assert.deepEqual(fs.readdirSync(layout.data), []);
  assert.equal(fs.readFileSync(path.join(source, '.regen/saved.json'), 'utf8'), 'private-evidence');
  assert.equal(fs.existsSync(layout.envFile), false, 'private environment is never imported');
});

test('upgrades retain one data folder, keep previous releases, and refuse modified managed source', t => {
  const { layout, source, home, write } = fixture(t);
  stageReview(layout);
  fs.writeFileSync(path.join(layout.data, 'existing-review.json'), 'existing-evidence');
  write('app/page.tsx', '// new release');
  const next = reviewLayout({ home, source, version: '1.0.1' });
  stageReview(next);
  assert.notEqual(next.root, layout.root);
  assert.equal(next.data, layout.data);
  assert.equal(fs.readFileSync(path.join(next.data, 'existing-review.json'), 'utf8'), 'existing-evidence');
  assert.equal(fs.readFileSync(path.join(layout.root, 'app/page.tsx'), 'utf8'), '// fixture');
  fs.writeFileSync(path.join(next.root, 'app/page.tsx'), '// personal edits');
  assert.throws(() => stageReview(next), /Managed source changed/);
  assert.equal(fs.readFileSync(path.join(next.root, 'app/page.tsx'), 'utf8'), '// personal edits');
});

test('unrelated directories and symbolic-link destinations cannot be overwritten', t => {
  const { directory, layout, source } = fixture(t);
  fs.mkdirSync(layout.home); fs.writeFileSync(path.join(layout.home, 'personal.txt'), 'keep');
  assert.throws(() => stageReview(layout), /unrelated files/);
  assert.equal(fs.readFileSync(path.join(layout.home, 'personal.txt'), 'utf8'), 'keep');
  const other = reviewLayout({ home: path.join(directory, 'other'), source, version: '1.0.0' });
  stageReview(other);
  const outside = path.join(directory, 'outside'); fs.mkdirSync(outside);
  // Only test-owned paths are removed; all targets were created by this fixture.
  fs.rmSync(path.join(other.root, 'components'), { recursive: true });
  fs.symlinkSync(outside, path.join(other.root, 'components'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => stageReview(other), /symbolic links/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('source symlinks are refused before any installation files are written', t => {
  const { source, home, directory } = fixture(t);
  const outside = path.join(directory, 'outside'); fs.mkdirSync(outside);
  fs.rmSync(path.join(source, 'components'), { recursive: true });
  fs.symlinkSync(outside, path.join(source, 'components'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => reviewLayout({ source, home }), /symbolic link/);
  assert.equal(fs.existsSync(home), false);
});

test('setup failures stop the pipeline, release its lock, and never record successful setup', async t => {
  const { layout } = fixture(t);
  let uvCalled = false;
  await assert.rejects(setupReview(layout, { log() {}, run: async () => { throw new Error('dependency download failed'); },
    uv: async () => { uvCalled = true; } }), /download failed/);
  assert.equal(uvCalled, false);
  assert.equal(fs.existsSync(path.join(layout.home, 'setup.lock')), false);
  assert.equal(managedStatus(layout).ok, false);
  assert.equal(fs.existsSync(path.join(layout.root, 'setup.json')), false);
});

test('a successful production setup is cached, while missing outputs cannot become ready', async t => {
  const { layout } = fixture(t);
  const calls = [];
  const materialize = file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture'); };
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    if (args.includes('ci')) for (const name of ['next', 'concurrently']) materialize(path.join(layout.root, `node_modules/${name}/package.json`));
    if (args[0] === 'venv') materialize(workbenchStatus({ appPath: layout.root }).python);
    if (args.at(-1) === 'build') materialize(path.join(layout.root, '.next/BUILD_ID'));
  };
  const status = await setupReview(layout, { run, uv: async () => 'uv-fixture', log() {} });
  assert.equal(status.ok, true);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].args.at(-3), 'ci');
  assert.equal(calls[1].options.env.UV_PYTHON_INSTALL_DIR, path.join(layout.home, 'tools/python'));
  const firstCount = calls.length;
  assert.equal((await setupReview(layout, { run, uv: async () => { throw new Error('must not download again'); }, log() {} })).ok, true);
  assert.equal(calls.length, firstCount);
  fs.unlinkSync(path.join(layout.root, '.next/BUILD_ID'));
  assert.equal(managedStatus(layout).ok, false);
  await assert.rejects(setupReview(layout, { run: async () => {}, uv: async () => 'uv-fixture', log() {} }), /incomplete/);
  assert.equal(managedStatus(layout).ok, false);
});

test('a concurrent setup is refused, rather than modifying another installer tree', async t => {
  const { layout } = fixture(t);
  stageReview(layout);
  const lock = path.join(layout.home, 'setup.lock');
  const value = JSON.stringify({ schema: 'praxis.local-review.v1', pid: process.pid, nonce: 'another-installer' });
  fs.writeFileSync(lock, value);
  await assert.rejects(setupReview(layout, { log() {}, run: async () => { throw new Error('must not run'); } }), /Another.*running/);
  assert.equal(fs.readFileSync(lock, 'utf8'), value);
});

test('platform application-data defaults keep consumer state outside package caches', () => {
  assert.equal(reviewHome({ platform: 'win32', user: '/user', env: { LOCALAPPDATA: '/local' } }), path.resolve('/local/PRAXIS/ProjectReview'));
  assert.equal(reviewHome({ platform: 'linux', user: '/user', env: { XDG_DATA_HOME: '/data' } }), path.resolve('/data/PRAXIS/ProjectReview'));
  assert.equal(reviewHome({ platform: 'darwin', user: '/user', env: {} }), path.resolve('/user/Library/Application Support/PRAXIS/ProjectReview'));
});
