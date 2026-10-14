import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { acquireReviewService, readServiceDescriptor, authenticateService, protectServiceDirectory, isReviewSurface } from '../src/lib/review-service.js';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-service-'));
const serve = handler => new Promise(resolve => { const server = http.createServer(handler); server.listen(0, '127.0.0.1', () => resolve(server)); });
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
const setup = (t) => { const directory = temp(); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory; };
async function fixtureStart({ backendPort, uiPort, token, instanceId }) {
  const api = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); return res.end(); }
    res.setHeader('content-type', 'application/json');
    const result = req.url === '/api/health' ? { status: 'ok', service_instance: instanceId } : req.url === '/api/projects' ? [{ schema_version: 1, id: 'prj_a', name: 'Real project', revision: 1, source: 'private source path' }] : req.url.startsWith('/api/projects/prj_a/status') ? { schema_version: 1, instance_id: instanceId, project_id: 'prj_a', revision: 2, source: 'private source path', source_freshness: 'stale', readiness: 'not_established' } : [];
    res.end(JSON.stringify(result));
  });
  const ui = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<head><title>PRAXIS · AI Project Engineer</title><meta name="praxis-review-surface" content="workbench-v1"/></head><p>Shared interface</p>'); });
  await Promise.all([new Promise((r, e) => { api.once('error', e); api.listen(backendPort, '127.0.0.1', r); }), new Promise((r, e) => { ui.once('error', e); ui.listen(uiPort, '127.0.0.1', r); })]);
  return { stop: () => Promise.all([close(api), close(ui)]) };
}

test('managed readiness accepts the stable UI marker and historical title, not unrelated pages', () => {
  assert.equal(isReviewSurface('<head><title>PRAXIS · AI Project Engineer</title><meta name="praxis-review-surface" content="workbench-v1"/></head>'), true);
  assert.equal(isReviewSurface('<head><title>PRAXIS Project Review</title></head>'), true);
  assert.equal(isReviewSurface('<head><title>PRAXIS · AI Project Engineer</title></head>'), false);
  assert.equal(isReviewSurface('<head><title>Other app</title><meta name="praxis-review-surface" content="wrong"/></head>'), false);
  assert.equal(isReviewSurface('<head><title>Other app</title></head><meta name="praxis-review-surface" content="workbench-v1"/>'), false);
});

test('malformed, remote and symlink descriptors cannot become an attached service', t => {
  const directory = setup(t);
  const file = path.join(directory, 'endpoint.json');
  for (const value of [{}, { schema: 'praxis.review-service.v1', origin: 'https://evil.example' }, { schema: 'praxis.review-service.v1', origin: 'http://127.0.0.1:3000', pid: 0 }]) {
    fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
    assert.throws(() => readServiceDescriptor(file), /Invalid|Unrecognized/);
  }
  fs.writeFileSync(file, 'x'.repeat(17000));
  assert.throws(() => readServiceDescriptor(file), /large/);
  const link = path.join(directory, 'link.json');
  try { fs.symlinkSync(file, link); } catch (error) { if (error.code === 'EPERM') return; throw error; }
  assert.throws(() => readServiceDescriptor(link), /symbolic/);
});

test('authenticated challenge rejects a healthy-looking unrelated listener', async t => {
  const server = await serve((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'ok', service_instance: 'f'.repeat(32), proof: '0'.repeat(64) })); });
  t.after(() => close(server));
  const descriptor = { schema: 'praxis.review-service.v1', instanceId: 'f'.repeat(32), nonce: 'd'.repeat(64), token: randomBytes(32).toString('hex'), origin: `http://127.0.0.1:${server.address().port}`, pid: process.pid, version: '0.14.2', runtimeId: 'fixture', startedAt: new Date().toISOString() };
  await assert.rejects(authenticateService(descriptor), /authentication/);
});

test('one owner, authenticated attach, one-use bootstrap and protected API', async t => {
  const dataRoot = setup(t);
  const owner = await acquireReviewService({ dataRoot, version: '0.14.2', runtimeId: 'fixture', start: fixtureStart });
  t.after(() => owner.stop({ force: true }));
  const client = await acquireReviewService({ dataRoot, version: '0.14.2', runtimeId: 'fixture', start: () => assert.fail('second backend started') });
  assert.equal(owner.owned, true); assert.equal(client.owned, false); assert.equal(client.instanceId, owner.instanceId);
  const anonymous = await fetch(`${owner.origin}/api/jobs`); assert.equal(anonymous.status, 401);
  const ticket = await client.browserUrl();
  assert.equal(new URL(ticket).search, '');
  const fragment = new URL(ticket).hash.slice(1);
  const redeem = () => fetch(`${owner.origin}/__praxis/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json', origin: owner.origin }, body: JSON.stringify({ ticket: fragment }) });
  const first = await redeem(); assert.equal(first.status, 200);
  const cookie = first.headers.get('set-cookie').split(';')[0]; assert.match(first.headers.get('set-cookie'), /HttpOnly/); assert.match(first.headers.get('set-cookie'), /SameSite=Strict/);
  assert.equal((await redeem()).status, 401);
  const api = await fetch(`${owner.origin}/api/jobs`, { headers: { cookie } }); assert.equal(api.status, 200); assert.deepEqual(await api.json(), []);
  const html = await fetch(owner.origin, { headers: { cookie } }); assert.match(await html.text(), /Shared interface/);
  const crossSite = await fetch(`${owner.origin}/api/jobs`, { method: 'POST', headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' }); assert.equal(crossSite.status, 403);
  const form = await fetch(`${owner.origin}/api/jobs`, { method: 'POST', headers: { cookie, origin: owner.origin, 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=b' }); assert.equal(form.status, 415);
  await assert.rejects(client.stop(), /owner/);
});

test('simultaneous launch resolves one owner and incompatible runtimes never attach', async t => {
  const dataRoot = setup(t); let starts = 0;
  const start = async options => { starts++; await new Promise(r => setTimeout(r, 60)); return fixtureStart(options); };
  const instances = await Promise.all(Array.from({ length: 5 }, () => acquireReviewService({ dataRoot, version: '0.14.2', runtimeId: 'fixture', start })));
  const owner = instances.find(value => value.owned); t.after(() => owner.stop({ force: true }));
  assert.equal(starts, 1); assert.equal(new Set(instances.map(value => value.instanceId)).size, 1);
  await assert.rejects(acquireReviewService({ dataRoot, version: '0.14.2', runtimeId: 'other', start }), /different runtime/);
});

test('independent managed owners choose separate runtime ports', async t => {
  const roots = [setup(t), setup(t), setup(t)];
  const owners = await Promise.all(roots.map(dataRoot => acquireReviewService({
    dataRoot, version: '0.14.2', runtimeId: 'fixture', start: fixtureStart,
  })));
  t.after(() => Promise.all(owners.map(owner => owner.stop({ force: true }))));
  assert.equal(new Set(owners.map(owner => owner.origin)).size, owners.length);
  assert.ok(owners.every(owner => owner.owned));
});

test('occupied ports are left untouched and active jobs require explicit quit', async t => {
  const dataRoot = setup(t);
  const occupied = await serve((req, res) => res.end('unrelated'));
  t.after(() => close(occupied));
  let active = 1;
  const owner = await acquireReviewService({ dataRoot, version: '0.14.2', runtimeId: 'fixture', ports: { gateway: occupied.address().port, ui: occupied.address().port, backend: occupied.address().port }, start: fixtureStart, activeJobs: async () => active });
  t.after(() => owner.stop({ force: true }));
  assert.notEqual(new URL(owner.origin).port, String(occupied.address().port));
  await assert.rejects(owner.stop(), /active review/);
  assert.equal(await (await fetch(`http://127.0.0.1:${occupied.address().port}`)).text(), 'unrelated');
  active = 0; await owner.stop();
  assert.equal(fs.existsSync(path.join(dataRoot, '.praxis-service', 'endpoint.json')), false);
});

test('malformed ownership is preserved and a dead owner can be recovered', async t => {
  const dataRoot = setup(t), serviceRoot = path.join(dataRoot, '.praxis-service');
  await protectServiceDirectory(serviceRoot);
  const lock = path.join(serviceRoot, 'owner'); fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'identity.json'), JSON.stringify({ schema: 'unknown' }), { mode: 0o600 });
  await assert.rejects(acquireReviewService({ dataRoot, version: '0.14.2', runtimeId: 'fixture', start: fixtureStart }), /ownership/);
  assert.equal(fs.existsSync(lock), true);
  fs.writeFileSync(path.join(lock, 'identity.json'), JSON.stringify({ schema: 'praxis.review-owner.v1', pid: 2147483647, nonce: '1'.repeat(64), createdAt: new Date().toISOString() }));
  const owner = await acquireReviewService({ dataRoot, version: '0.14.2', runtimeId: 'fixture', start: fixtureStart });
  t.after(() => owner.stop({ force: true })); assert.equal(owner.owned, true);
});

test('failed readiness releases only owned state and never advertises ready', async t => {
  const dataRoot = setup(t); let stopped = 0;
  await assert.rejects(acquireReviewService({ dataRoot, version: '0.14.2', runtimeId: 'fixture', start: async () => ({ stop: async () => stopped++ }), startupTimeout: 100 }), /ready/);
  assert.equal(stopped, 1);
  assert.equal(fs.existsSync(path.join(dataRoot, '.praxis-service', 'endpoint.json')), false);
  assert.equal(fs.existsSync(path.join(dataRoot, '.praxis-service', 'owner')), false);
});

test('project status controls are authenticated, bounded and omit private source', async t => {
  const dataRoot = setup(t);
  const owner = await acquireReviewService({ dataRoot, version: '0.14.2', runtimeId: 'fixture', start: fixtureStart });
  t.after(() => owner.stop({ force: true }));
  const descriptor = readServiceDescriptor(path.join(dataRoot, '.praxis-service', 'endpoint.json'));
  const request = (action, payload = {}) => fetch(`${owner.origin}/__praxis/client/${action}`, { method: 'POST', headers: { authorization: `Bearer ${descriptor.token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const projects = await (await request('projects')).json(); assert.equal(projects[0].id, 'prj_a'); assert.equal(projects[0].source, undefined);
  const status = await (await request('project-status', { project_id: 'prj_a', previous_revision: 0 })).json(); assert.equal(status.revision, 2); assert.equal(status.source, undefined); assert.equal(status.source_freshness, 'stale');
  for (const invalid of [{ project_id: '../escape' }, { project_id: 'prj_a', previous_revision: -1 }, { project_id: 'prj_a', previous_revision: 1.5 }]) assert.equal((await request('project-status', invalid)).status, 400);
  assert.equal((await fetch(`${owner.origin}/__praxis/client/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
});
