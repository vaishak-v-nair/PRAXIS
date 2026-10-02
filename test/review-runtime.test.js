import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { uvAsset, downloadVerified, ensureUv, runCommand, sha256, managedDirectory } from '../src/lib/review-runtime.js';

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('every supported uv runtime uses a vendor URL and an exact SHA256 pin', () => {
  for (const platform of ['win32', 'darwin', 'linux']) for (const arch of ['x64', 'arm64']) {
    const asset = uvAsset(platform, arch);
    assert.match(asset.url, /^https:\/\/github.com\/astral-sh\/uv\/releases\/download\/0\.12\.22\//);
    assert.match(asset.sha256, /^[0-9a-f]{64}$/);
  }
  assert.throws(() => uvAsset('freebsd', 'x64'), /does not support/);
});

test('a corrupt, oversized or failed download is never saved as a usable runtime', async t => {
  const root = temporary(t), target = path.join(root, 'runtime.zip');
  const asset = { url: uvAsset().url, sha256: sha256('expected') };
  await assert.rejects(downloadVerified(asset, target, { fetchImpl: async () => new Response('corrupt') }), /checksum mismatch/);
  await assert.rejects(downloadVerified(asset, target, { maxBytes: 3, fetchImpl: async () => new Response('large') }), /size limit/);
  await assert.rejects(downloadVerified(asset, target, { fetchImpl: async () => new Response('', { status: 403 }) }), /HTTP 403/);
  assert.equal(fs.existsSync(target), false);
  await downloadVerified(asset, target, { fetchImpl: async () => new Response('expected') });
  assert.equal(fs.readFileSync(target, 'utf8'), 'expected');
});

test('runtime checksum failure prevents archive extraction and tool execution', async t => {
  const root = temporary(t); let ran = false;
  await assert.rejects(ensureUv(root, { fetchImpl: async () => new Response('corrupt'), run: async () => { ran = true; } }), /checksum mismatch/);
  assert.equal(ran, false);
});

test('runtime directories cannot escape managed home through a traversal or symbolic link', t => {
  const root = temporary(t), home = path.join(root, 'home'), outside = path.join(root, 'outside');
  fs.mkdirSync(home); fs.mkdirSync(outside);
  assert.throws(() => managedDirectory(outside, home), /escaped/);
  fs.symlinkSync(outside, path.join(home, 'tools'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => managedDirectory(path.join(home, 'tools/uv'), home), /symbolic links/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('setup command errors and timeouts propagate instead of becoming successful setup', async () => {
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(7)']), /code 7/);
  await assert.rejects(runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 150 }), /time limit/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(0)'], { signal: controller.signal }));
});
