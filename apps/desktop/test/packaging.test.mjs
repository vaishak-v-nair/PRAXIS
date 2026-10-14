import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dependencyNotices, resetBundledRuntime, resetGenerated, runtimeManifest, validateRuntime } from '../scripts/packaging.mjs';
const setup = t => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-packaging-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; };
test('reset refuses source, user data, and arbitrary paths', t => {
  const root = setup(t), source = path.join(root, 'project'); fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'keep.txt'), 'user source');
  assert.throws(() => resetGenerated(source, root), /Refusing/); assert.equal(fs.readFileSync(path.join(source, 'keep.txt'), 'utf8'), 'user source');
  resetGenerated(path.join(root, '.build/staging'), root); assert.equal(fs.existsSync(path.join(root, '.build/staging')), true);
});
test('private state cannot be recorded in a desktop runtime manifest', t => {
  const root = setup(t); fs.writeFileSync(path.join(root, 'provider.env'), 'not-a-real-credential'); assert.throws(() => runtimeManifest(root, {}), /Private/);
});
test('runtime hashes catch changed binaries and wrong-target bundles', t => {
  const root = setup(t), files = ['node', 'supervisor.mjs', 'review-service.mjs', 'review-service-runtime.mjs', 'ui/server.js', 'api/backend', 'ui/.next/BUILD_ID', 'ui/.next/static/test.js', 'api/praxis-review-api/tools/mcp-evidence.mjs', ...['mcp-sources.js', 'mcp-client.js', 'schema.js', 'package.json'].map(file => `api/praxis-review-api/tools/verify/${file}`)];
  for (const name of files) { const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `content ${name}`); }
  runtimeManifest(root, { mode: 'standalone', platform: 'linux', arch: 'x64', backend: 'api/backend', frontend: 'ui/server.js' });
  assert.equal(validateRuntime(root, { platform: 'linux', arch: 'x64' }).files.length, files.length);
  assert.throws(() => validateRuntime(root, { platform: 'darwin', arch: 'arm64' }), /target/);
  fs.writeFileSync(path.join(root, 'api/backend'), 'changed'); assert.throws(() => validateRuntime(root, { platform: 'linux', arch: 'x64' }), /integrity/);
});
test('post-manifest files and private state cannot slip into an installer', t => {
  const root = setup(t);
  runtimeManifest(root, { mode: 'standalone', platform: 'linux', arch: 'x64' });
  fs.writeFileSync(path.join(root, 'unrecorded.js'), 'untrusted source');
  assert.throws(() => validateRuntime(root, { platform: 'linux', arch: 'x64' }), /unrecorded/);
  fs.writeFileSync(path.join(root, '.env'), 'not-a-real-key');
  assert.throws(() => validateRuntime(root, { platform: 'linux', arch: 'x64' }), /Private/);
});
test('an intermediate generated-directory link cannot reset other files', t => {
  const root = setup(t), source = path.join(root, 'user-project');
  fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'keep.txt'), 'user source');
  try { fs.symlinkSync(source, path.join(root, '.build'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Directory links are unavailable on this machine'); return; } throw error; }
  assert.throws(() => resetGenerated(path.join(root, '.build/staging'), root), /linked/);
  assert.equal(fs.readFileSync(path.join(source, 'keep.txt'), 'utf8'), 'user source');
});
test('dependency notices retain vendor texts without copying private development data', t => {
  const root = setup(t), source = path.join(root, 'packages'), destination = path.join(root, 'notices');
  fs.mkdirSync(path.join(source, 'vendor/licenses'), { recursive: true });
  fs.writeFileSync(path.join(source, 'vendor/licenses/LICENSE.txt'), 'Vendor copyright and license');
  fs.writeFileSync(path.join(source, 'vendor/.env'), 'not-a-real-secret');
  fs.writeFileSync(path.join(source, 'vendor/index.js'), 'source code');
  assert.deepEqual(dependencyNotices(source, destination), ['vendor/licenses/LICENSE.txt']);
  assert.equal(fs.readFileSync(path.join(destination, 'vendor/licenses/LICENSE.txt'), 'utf8'), 'Vendor copyright and license');
  assert.equal(fs.existsSync(path.join(destination, 'vendor/.env')), false);
  assert.equal(fs.existsSync(path.join(destination, 'vendor/index.js')), false);
});
test('a new native build prunes stale copied resources without deleting its shell', t => {
  const root = setup(t), runtime = path.join(root, 'src-tauri/target/debug/runtime');
  fs.mkdirSync(runtime, { recursive: true });
  const shell = path.join(root, 'src-tauri/target/debug/praxis-desktop.exe');
  fs.writeFileSync(shell, 'preserve compiled shell');
  fs.writeFileSync(path.join(runtime, 'old-vulnerable-dependency.node'), 'previous runtime');
  resetBundledRuntime(runtime, root);
  assert.deepEqual(fs.readdirSync(runtime), []);
  assert.equal(fs.readFileSync(shell, 'utf8'), 'preserve compiled shell');
  resetBundledRuntime(path.join(root, 'src-tauri/target/x86_64-pc-windows-msvc/release/runtime'), root);
  for (const rejected of ['src-tauri/target', 'src-tauri/target/debug', 'src-tauri/runtime', 'project/runtime', 'src-tauri/target/../../project/debug/runtime']) {
    assert.throws(() => resetBundledRuntime(path.join(root, rejected), root), /Refusing/);
  }
});
test('copied runtime cleanup refuses linked target directories and preserves source', t => {
  const root = setup(t), source = path.join(root, 'user-project');
  fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'keep.txt'), 'user source');
  fs.mkdirSync(path.join(root, 'src-tauri'));
  try { fs.symlinkSync(source, path.join(root, 'src-tauri/target'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Directory links are unavailable on this machine'); return; } throw error; }
  assert.throws(() => resetBundledRuntime(path.join(root, 'src-tauri/target/debug/runtime'), root), /linked/);
  assert.equal(fs.readFileSync(path.join(source, 'keep.txt'), 'utf8'), 'user source');
});
