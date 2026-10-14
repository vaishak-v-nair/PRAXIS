// Windows development-shell acceptance. This drives the real native process
// and packaged service protocol, without giving the project webview native IPC.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { readServiceDescriptor, authenticateService } from '../../../src/lib/review-service.js';
import { validateRuntime, hash } from './packaging.mjs';

if (process.platform !== 'win32') throw new Error('This native shell smoke is for Windows. Other OS native acceptance remains a separate release gate.');
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arguments_ = process.argv.slice(2), bundled = arguments_.includes('--bundled');
const executable = arguments_.find(argument => !argument.startsWith('--')) || path.join(desktop, 'src-tauri/target/debug/praxis-desktop.exe');
if (!path.isAbsolute(executable) || !fs.existsSync(executable)) throw new Error('Build the Windows development shell before running native acceptance.');
const nativeTarget = path.join(desktop, 'src-tauri/target');
if (!executable.startsWith(nativeTarget + path.sep) || !path.relative(nativeTarget, executable).split(path.sep).includes('debug') || path.basename(executable) !== 'praxis-desktop.exe') throw new Error('Native smoke only runs this checkout\'s development executable; release data must never be used as test state.');
const runtime = bundled ? path.join(path.dirname(executable), 'runtime') : path.join(desktop, 'src-tauri/runtime');
const manifest = validateRuntime(runtime);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-native-smoke-'));
const data = path.join(root, 'data'), descriptorPath = path.join(data, '.praxis-service/endpoint.json');
const fixture = path.join(root, 'project'); fs.mkdirSync(fixture);
fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'native-source-fixture', version: '1.0.0', type: 'module' }));
fs.writeFileSync(path.join(fixture, 'index.js'), 'export const greeting = "Hello Ada";\n');
const environment = { ...process.env, PATH: `${process.env.SystemRoot}\\System32`, PRAXIS_DESKTOP_DATA_ROOT: data };
if (bundled) { delete environment.PRAXIS_DESKTOP_RUNTIME; delete environment.PRAXIS_DESKTOP_NODE; }
else { environment.PRAXIS_DESKTOP_RUNTIME = runtime; environment.PRAXIS_DESKTOP_NODE = path.join(runtime, 'node.exe'); }
const children = [];
const ended = child => child.exitCode !== null || child.signalCode !== null;
function launch() {
  const child = spawn(executable, [], { env: environment, windowsHide: true, shell: false, stdio: 'ignore' });
  child.once('error', () => {}); children.push(child); return child;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, message, timeout = 90000) {
  const deadline = Date.now() + timeout;
  do { const result = await test(); if (result) return result; await sleep(100); } while (Date.now() < deadline);
  throw new Error(message);
}
async function ready(child) {
  return until(async () => {
    if (ended(child)) throw new Error('The native shell stopped before its packaged API became ready.');
    if (!fs.existsSync(descriptorPath)) return false;
    try { const descriptor = readServiceDescriptor(descriptorPath); await authenticateService(descriptor); return descriptor; }
    catch { return false; }
  }, 'The real native shell did not create an authenticated local service.');
}
async function session(descriptor) {
  const open = await fetch(`${descriptor.origin}/__praxis/client/browser`, { method: 'POST',
    headers: { authorization: `Bearer ${descriptor.token}`, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(open.status, 200);
  const ticket = new URL((await open.json()).url).hash.slice(1);
  const redeemed = await fetch(`${descriptor.origin}/__praxis/bootstrap`, { method: 'POST',
    headers: { origin: descriptor.origin, 'content-type': 'application/json' }, body: JSON.stringify({ ticket }) });
  assert.equal(redeemed.status, 200); return redeemed.headers.get('set-cookie').split(';')[0];
}
async function api(descriptor, cookie, endpoint, body) {
  const response = await fetch(`${descriptor.origin}/api${endpoint}`, { method: body ? 'POST' : 'GET',
    headers: { cookie, ...(body ? { origin: descriptor.origin, 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `Native API ${endpoint} failed`); return response.json();
}
async function crash(child) {
  child.kill();
  await until(() => ended(child) && !fs.existsSync(descriptorPath),
    'The native control-pipe loss did not stop and release its owned local services.', 20000);
}
try {
  const first = launch(), descriptor = await ready(first), cookie = await session(descriptor);
  assert.equal(descriptor.runtimeId, manifest.runtimeId);
  assert.equal((await fetch(`${descriptor.origin}/api/jobs`)).status, 401);
  const duplicate = launch();
  await until(() => ended(duplicate), 'A duplicate native shell remained running instead of focusing its first instance.', 15000);
  assert.equal(readServiceDescriptor(descriptorPath).instanceId, descriptor.instanceId);
  const started = await api(descriptor, cookie, '/scans', { source: fixture, budget: 1, ai_review: false, run_checks: false });
  const job = await until(async () => { const job = await api(descriptor, cookie, `/jobs/${started.id}`);
    if (job.status === 'error' || job.status === 'cancelled') throw new Error('The native source review did not complete.');
    return job.status === 'complete' ? job : false; }, 'The native source review did not finish.', 30000);
  assert.ok(job.files_scanned >= 2); assert.equal(job.assessment.readiness.status, 'not_established');
  assert.ok(job.project_id);
  fs.writeFileSync(path.join(fixture, 'index.js'), 'export const greeting = "Changed after review";\n');
  const status = await api(descriptor, cookie, `/projects/${job.project_id}/status`);
  assert.equal(status.source_freshness, 'stale'); assert.equal(status.readiness, 'not_established');
  await crash(first);
  const restarted = launch(), secondDescriptor = await ready(restarted), secondCookie = await session(secondDescriptor);
  assert.notEqual(secondDescriptor.instanceId, descriptor.instanceId);
  assert.equal((await api(secondDescriptor, secondCookie, `/jobs/${job.id}`)).status, 'complete', 'Saved review evidence must survive native process loss');
  await crash(restarted);
  const report = { schema: 'praxis.desktop-native-smoke.v1', status: 'passed', platform: process.platform, arch: process.arch,
    artifactSha256: hash(executable), runtimeId: manifest.runtimeId, runtimeSource: bundled ? 'bundled-native-resources' : 'explicit-staged-runtime', timestamp: new Date().toISOString(),
    observed: ['real Windows Tauri shell starts bundled engine with no global Node/Python PATH',
      'duplicate native launch reuses the first instance', 'private session and authenticated real source review',
      'original source drift remains stale', 'native control-pipe loss stops owned services', 'saved review survives restart'],
    stillRequired: ['clean-machine signed-installer acceptance', 'manual native picker/tray/close/explicit-quit acceptance', 'macOS and Linux native acceptance'] };
  fs.mkdirSync(path.join(desktop, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(desktop, `artifacts/native-smoke${bundled ? '-bundled' : ''}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const child of children) if (!ended(child)) child.kill();
  if (fs.existsSync(descriptorPath)) await until(() => !fs.existsSync(descriptorPath), 'An owned native-smoke service did not stop. Its temporary evidence was preserved.', 20000);
  fs.rmSync(root, { recursive: true, force: true });
}
