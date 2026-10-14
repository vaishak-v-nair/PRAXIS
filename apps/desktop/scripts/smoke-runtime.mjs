import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { validateRuntime } from './packaging.mjs';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), runtime = path.join(desktop, 'src-tauri/runtime');
const manifest = validateRuntime(runtime), root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-desktop-smoke-')), fixture = path.join(root, 'real-project');
fs.mkdirSync(fixture); fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'real-source-fixture', version: '1.0.0', type: 'module', scripts: { test: 'node --test' } }));
fs.writeFileSync(path.join(fixture, 'index.js'), 'export function greet(name) { return `Hello ${name}`; }\n');
fs.writeFileSync(path.join(fixture, 'index.test.js'), "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {greet} from './index.js'; test('greets a real name',()=>assert.equal(greet('Ada'),'Hello Ada'));\n");
const executable = path.join(runtime, process.platform === 'win32' ? 'node.exe' : 'node');
const agentFixture = path.join(root, 'agent.cjs'); fs.writeFileSync(agentFixture, "process.stdin.resume();process.stdin.on('end',()=>console.log('Plan: inspect index.js and independently test the greeting. No changes or checks performed.'));");
const child = spawn(executable, [path.join(runtime, 'supervisor.mjs')], { cwd: runtime, env: { ...process.env, PATH: process.platform === 'win32' ? `${process.env.SystemRoot}\\System32` : '/usr/bin:/bin', PRAXIS_DESKTOP_DATA_ROOT: path.join(root, 'data'), PRAXIS_WORKBENCH_ENV_FILE: path.join(root, 'absent.env'),
  PRAXIS_AGENT_ADAPTERS: JSON.stringify({ 'packaged-fixture': { plan: [executable, agentFixture] } }) }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
let pending = new Map(), readyResolve, readyReject, sequence = 1, log = '';
const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
child.stderr.on('data', buffer => { log = (log + buffer.toString()).slice(-6000); });
const lines = readline.createInterface({ input: child.stdout });
lines.on('line', line => { let value; try { value = JSON.parse(line); } catch { return; } if (value.event === 'ready') readyResolve(value); if (value.event === 'error') readyReject(new Error(value.error + '\n' + log)); if (value.id && pending.has(value.id)) { const operation = pending.get(value.id); pending.delete(value.id); value.error ? operation.reject(new Error(value.error)) : operation.resolve(value.result); } });
child.once('error', readyReject); child.once('exit', code => { if (code) readyReject(new Error(`Runtime stopped with exit ${code}\n${log}`)); });
function request(method, params = {}) { const id = sequence++; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, method, ...params }) + '\n'); const timer = setTimeout(() => { pending.delete(id); reject(new Error('Runtime control timed out.')); }, 15000); timer.unref(); }); }
let stopped = false;
try {
  const opened = await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Packaged runtime startup timed out.\n' + log)), 90000).unref())]);
  const ticket = new URL(opened.url).hash.slice(1);
  const bootstrap = await fetch(`${opened.origin}/__praxis/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json', origin: opened.origin }, body: JSON.stringify({ ticket }) }); assert.equal(bootstrap.status, 200);
  const cookie = bootstrap.headers.get('set-cookie').split(';')[0];
  const html = await fetch(opened.origin, { headers: { cookie } }); assert.equal(html.status, 200); assert.match(await html.text(), /PRAXIS/);
  assert.equal((await fetch(`${opened.origin}/api/health`)).status, 401);
  const health = await (await fetch(`${opened.origin}/api/health`, { headers: { cookie } })).json(); assert.equal(health.service_instance, JSON.parse(fs.readFileSync(path.join(root, 'data/.praxis-service/endpoint.json'))).instanceId);
  const scan = await fetch(`${opened.origin}/api/scans`, { method: 'POST', headers: { cookie, origin: opened.origin, 'content-type': 'application/json' }, body: JSON.stringify({ source: fixture, budget: 1, ai_review: false, run_checks: false, review_goal: 'Check the real greeting source.' }) }); assert.equal(scan.status, 200); const started = await scan.json();
  const deadline = Date.now() + 30000; let job;
  do { job = await (await fetch(`${opened.origin}/api/jobs/${started.id}`, { headers: { cookie } })).json(); if (['complete', 'error', 'cancelled'].includes(job.status)) break; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < deadline);
  assert.equal(job.status, 'complete', JSON.stringify(job)); assert.ok(job.files_scanned >= 3, 'All three real fixture source files must be inspected');
  assert.equal(job.assessment?.readiness?.status, 'not_established', 'Source-only review must not become a production-ready claim');
  assert.ok(job.project_id, 'The packaged engine must attach the real review to a project identity');
  const projectStatus = await (await fetch(`${opened.origin}/api/projects/${job.project_id}/status`, { headers: { cookie } })).json();
  assert.equal(projectStatus.project_id, job.project_id); assert.equal(projectStatus.instance_id, health.service_instance);
  const evidenceSources = await (await fetch(`${opened.origin}/api/evidence/sources`, { headers: { cookie } })).json();
  assert.deepEqual(evidenceSources.map(source => source.id), ['github', 'playwright', 'sentry', 'supabase'], 'The frozen API must find the shared official MCP bridge using bundled Node');
  const api = async (endpoint, body) => {
    const response = await fetch(`${opened.origin}/api${endpoint}`, { method: body ? 'POST' : 'GET', headers: { cookie, ...(body ? { origin: opened.origin, 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, `Packaged API ${endpoint} failed`); return response.json();
  };
  const agents = await api('/agents'); assert.ok(agents.agents.some(agent => agent.name === 'packaged-fixture' && agent.installed));
  job = await api(`/jobs/${job.id}/work/tasks`, { expected_revision: job.coordination.revision, title: 'Plan the greeting check', assigned_to: { kind: 'agent', id: 'cli-packaged-fixture' }, share_with_agents: true });
  await api(`/jobs/${job.id}/work/tasks/${job.coordination.tasks[0].id}/run-agent`, { expected_revision: job.coordination.revision, tool: 'packaged-fixture', trust_confirmed: true, external_spend_confirmed: true });
  const agentDeadline = Date.now() + 20000;
  do { job = await api(`/jobs/${job.id}`); if (['complete', 'error', 'cancelled'].includes(job.status)) break; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < agentDeadline);
  assert.equal(job.agent_run?.status, 'completed', JSON.stringify(job)); assert.equal(job.agent_run.exit_code, 0);
  assert.equal(job.agent_run.verification, 'not_evaluated'); assert.equal(job.coordination.tasks[0].verification, 'not_evaluated');
  assert.equal(job.coordination.tasks[0].state, 'completed'); assert.equal(job.cost, 0);
  const activity = await request('status'); assert.equal(activity.activeJobs, 0);
  await request('quit'); stopped = true;
  if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
  const report = { schema: 'praxis.desktop-runtime-smoke.v1', status: 'passed', platform: process.platform, arch: process.arch, runtimeId: manifest.runtimeId, nodeVersion: manifest.nodeVersion, runtimeBytes: manifest.totalBytes, observed: ['bundled Node/Python startup with no global runtime PATH', 'private bootstrap and authenticated API', 'real project source review', 'snapshot-bound project identity and status', 'official MCP bridge availability using bundled Node', 'installed-agent assignment, authorized execution and unverified report through the frozen API', 'honest unsupported production readiness', 'owned idle shutdown'], timestamp: new Date().toISOString() };
  fs.mkdirSync(path.join(desktop, 'artifacts'), { recursive: true }); fs.writeFileSync(path.join(desktop, 'artifacts/runtime-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (!stopped) { try { await request('quit', { force: true }); } catch { child.stdin.end(); } }
  lines.close(); fs.rmSync(root, { recursive: true, force: true });
}
