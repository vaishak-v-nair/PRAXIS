import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startReviewRuntime } from '../src/lib/review-service-runtime.js';

test('runtime rejects submitted or malformed executable paths before spawning', () => {
  assert.throws(() => startReviewRuntime({ root: 'relative' }), /Invalid trusted/);
  assert.throws(() => startReviewRuntime({ root: os.tmpdir(), token: 'a'.repeat(64), instanceId: 'b'.repeat(32), backendPort: 9123, uiPort: 3000, backendEntry: '/missing-api', frontendEntry: '/missing-ui' }), /incomplete/);
});

test('an early sidecar failure stops its owned peer and preserves another process', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const web = path.join(root, 'server.js'); fs.writeFileSync(web, 'setInterval(() => {}, 1000);');
  const unrelated = spawn(process.execPath, [web], { stdio: 'ignore', windowsHide: true });
  t.after(() => unrelated.kill());
  // Node without an input program exits. It plays the role of a failed API
  // executable while the real owned frontend process stays running.
  const runtime = startReviewRuntime({ root, backendEntry: process.execPath, frontendEntry: web, token: 'a'.repeat(64), instanceId: 'b'.repeat(32), backendPort: 9123, uiPort: 3000, log: () => {} });
  const result = await runtime.closed;
  assert.equal(result.length, 2); assert.equal(result[0].code, 0);
  assert.equal(unrelated.exitCode, null);
  await runtime.stop();
});

test('an executable spawn failure still shuts down only its real owned peer', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-runtime-spawn-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const web = path.join(root, 'server.js'); fs.writeFileSync(web, 'setInterval(() => {}, 1000);');
  const impossible = path.join(root, 'not-an-executable'); fs.mkdirSync(impossible);
  const runtime = startReviewRuntime({ root, backendEntry: impossible, frontendEntry: web, token: 'a'.repeat(64), instanceId: 'b'.repeat(32), backendPort: 9123, uiPort: 3000, log: () => {} });
  const result = await runtime.closed;
  assert.equal(result[0].code, 1);
  await runtime.stop();
});
