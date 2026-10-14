import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { readReviewStatus } from '../src/lib/review-status.js';
import { acquireReviewService } from '../src/lib/review-service.js';
import { buildTools } from '../src/lib/mcp/tools.js';

async function statusFixture(t) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-status-contract-'));
  const state = { fault: undefined, jobs: [{ status: 'scanning' }, { status: 'complete' }], queries: [] };
  let owner;
  t.after(async () => {
    await owner?.stop({ force: true });
    if (path.dirname(path.resolve(dataRoot)) !== path.resolve(os.tmpdir()) || !path.basename(dataRoot).startsWith('praxis-status-contract-')) throw new Error('Refusing unexpected status-test cleanup path.');
    fs.rmSync(dataRoot, { force: true, recursive: true });
  });
  const start = async ({ backendPort, uiPort, token, instanceId }) => {
    const api = http.createServer((req, res) => {
      if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); return res.end(); }
      res.setHeader('content-type', 'application/json');
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/api/health') return res.end(JSON.stringify({ status: 'ok', service_instance: instanceId }));
      if (url.pathname === '/api/jobs') return res.end(JSON.stringify(state.jobs));
      if (url.pathname === '/api/projects') return res.end(JSON.stringify(['prj_first', 'prj_second'].map(id => ({ id, name: id, private_source: 'PRIVATE_SOURCE_MARKER' }))));
      const id = url.pathname.split('/')[3];
      state.queries.push({ id, previousRevision: url.searchParams.get('previous_revision') });
      const result = { schema_version: 1, instance_id: instanceId, project_id: id, revision: 8, phase: 'complete', freshness: 'current', source_freshness: 'stale', readiness: 'not_established', private_source: 'PRIVATE_SOURCE_MARKER', provider_key: 'PRIVATE_PROVIDER_MARKER' };
      if (id === 'prj_second') {
        if (state.fault === 'instance') result.instance_id = 'f'.repeat(32);
        if (state.fault === 'identity') result.project_id = 'prj_other';
        if (state.fault === 'revision') result.revision = 1.5;
        if (state.fault === 'oversized') result.private_source = 'x'.repeat(300_000);
      }
      res.end(JSON.stringify(result));
    });
    const ui = http.createServer((req, res) => res.end('<title>PRAXIS Project Review</title>'));
    const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    const listen = (server, port) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    try { await Promise.all([listen(api, backendPort), listen(ui, uiPort)]); }
    catch (error) { await Promise.all([close(api), close(ui)]); throw error; }
    return { stop: () => Promise.all([close(api), close(ui)]) };
  };
  owner = await acquireReviewService({ dataRoot, version: 'test', runtimeId: 'status-contract', start });
  return { dataRoot, owner, state };
}

test('status cannot invent availability, start an owner or write project state', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-status-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const result = await readReviewStatus({ dataRoot: root });
  assert.equal(result.status, 'unavailable'); assert.equal(result.authorizes_execution, false);
  assert.deepEqual(fs.readdirSync(root), []);
  await assert.rejects(readReviewStatus({ projectId: '../outside', dataRoot: root }), /Invalid/);
});

test('MCP exposes status alone and never turns it into evidence or execution authority', async () => {
  const calls = [];
  const tool = buildTools({ readReviewStatus: async options => { calls.push(options); return { status: 'available', authorizes_execution: false }; } }).find(tool => tool.name === 'praxis_project_review_status');
  assert.equal((await tool.handler({ project_id: 'prj_fixture', previous_revision: 2 })).authorizes_execution, false);
  assert.deepEqual(calls, [{ projectId: 'prj_fixture', previousRevision: 2 }]);
  assert.throws(() => tool.handler({ execute: true }), /Only project/);
});

test('CLI and MCP read the real authenticated status without exporting private fields or restarting work', async t => {
  const { dataRoot, owner, state } = await statusFixture(t);
  const client = await acquireReviewService({ dataRoot, version: 'test', runtimeId: 'status-contract', start: () => assert.fail('Status started a second engine.') });
  assert.equal(client.owned, false);
  assert.equal((await client.status()).activeJobs, 1);
  const all = await readReviewStatus({ dataRoot });
  assert.equal(all.status, 'available');
  assert.deepEqual(all.projects.map(project => project.project_id), ['prj_first', 'prj_second']);
  assert.equal(all.authorizes_execution, false);
  assert.equal(all.projects[1].source_freshness, 'stale');
  assert.doesNotMatch(JSON.stringify(all), /PRIVATE_SOURCE_MARKER|PRIVATE_PROVIDER_MARKER/);
  const selected = await readReviewStatus({ dataRoot, projectId: 'prj_second', previousRevision: 7 });
  assert.equal(selected.projects.length, 1);
  assert.deepEqual(state.queries.at(-1), { id: 'prj_second', previousRevision: '7' });
  const tool = buildTools({ readReviewStatus: options => readReviewStatus({ ...options, dataRoot }) }).find(tool => tool.name === 'praxis_project_review_status');
  assert.deepEqual(await tool.handler({ project_id: 'prj_second', previous_revision: 7 }), selected);
  assert.equal((await owner.status()).activeJobs, 1);
});

test('a mismatched, malformed or oversized second project cannot leave a partially available status', async t => {
  const { dataRoot, state } = await statusFixture(t);
  for (const fault of ['instance', 'identity', 'revision', 'oversized']) {
    state.fault = fault;
    const observed = await readReviewStatus({ dataRoot });
    assert.equal(observed.status, 'unavailable', fault);
    assert.deepEqual(observed.projects, [], fault);
    assert.equal(observed.authorizes_execution, false);
  }
  state.fault = undefined;
  assert.equal((await readReviewStatus({ dataRoot })).projects.length, 2);
});

test('unknown job activity refuses idle shutdown and preserves the owner descriptor', async t => {
  const { dataRoot, owner, state } = await statusFixture(t);
  state.jobs = { unavailable: true };
  await assert.rejects(owner.status(), /activity.*unavailable/i);
  await assert.rejects(owner.stop(), /activity.*unavailable/i);
  assert.equal(fs.existsSync(path.join(dataRoot, '.praxis-service/endpoint.json')), true);
  assert.equal((await readReviewStatus({ dataRoot })).status, 'available');
});
