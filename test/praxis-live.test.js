import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { runLiveScenario } from '../src/lib/verify/live-demo.js';
import { runLiveScenarioOrchestrated } from '../src/lib/live/orchestrator.js';
import { createLiveServer, listenLiveLocal } from '../src/lib/live/server.js';
import { verifyVerifyReceipt } from '../src/lib/verify/verify-receipt.js';
import { verifyPublicReceipt } from '../web/receipt/verify.js';
import { createGraphModel } from '../web/live/graph.js';

const ORDER = ['extractor', 'retriever', 'verifier', 'judge'];

for (const [scenario, expected] of [['truthful', 'VERIFIED'], ['false-claim', 'CONTRADICTED']]) {
  test(`PRAXIS Live ${scenario} scenario uses the core engine and returns ${expected}`, async () => {
    const events = [];
    const result = await runLiveScenario(scenario, { onEvent: (event) => events.push(event) });
    assert.equal(result.verdict, expected);
    assert.equal(verifyVerifyReceipt(result.receipt), true);
    assert.deepEqual(await verifyPublicReceipt(result.receipt, webcrypto), { ok: true, reason: null });
    assert.deepEqual(events.filter((event) => event.type === 'stage' && event.state === 'running').map((event) => event.stage), ORDER);
    assert.deepEqual(events.filter((event) => event.type === 'stage' && event.state === 'complete').map((event) => event.stage), ORDER);
    const retrieved = events.find((event) => event.stage === 'retriever' && event.state === 'complete').evidence;
    if (scenario === 'truthful') {
      assert.equal(retrieved.matchedClaimPaths, 2);
      assert.equal(retrieved.missingClaimPaths, 0);
      assert.deepEqual(retrieved.snippets.map((item) => item.path), ['src/login.js', 'test/login-rate-limit.test.js']);
      assert.match(retrieved.snippets[0].snippet, /status: 429/);
      assert.match(retrieved.snippets[1].snippet, /assert\.equal/);
    } else {
      assert.equal(retrieved.matchedClaimPaths, 0);
      assert.equal(retrieved.missingClaimPaths, 2);
      assert.equal(retrieved.snippets.find((item) => item.path === 'README.md').status, 'context');
      assert.match(retrieved.snippets.find((item) => item.path === 'README.md').snippet, /planned for a later release/);
    }
    const graph = createGraphModel();
    for (const event of events) graph.consume(event);
    const graphState = graph.snapshot();
    assert.equal(graphState.nodes.filter((node) => node.lane === 'claim').length >= 2, true);
    assert.equal(graphState.nodes.filter((node) => node.lane === 'verdict').length, 2);
    assert.equal(graphState.edges.filter((edge) => edge.to.startsWith('verdict:')).length >= 2, true);
    assert.equal(graphState.nodes.some((node) => node.kind === `verdict-${expected.toLowerCase()}`), true);
    assert.equal(events.at(-1).type, 'result');
  });
}

test('PRAXIS Live Tier 3 executes the four stages through LangGraph', async () => {
  const events = [];
  const result = await runLiveScenarioOrchestrated('truthful', { onEvent: (event) => events.push(event) });
  assert.equal(result.verdict, 'VERIFIED');
  const orchestration = events.find((event) => event.type === 'orchestration');
  assert.equal(orchestration.engine, 'LangGraph.js');
  assert.equal(orchestration.mode, 'framework');
  assert.deepEqual(orchestration.nodes, ORDER);
  assert.deepEqual(events.filter((event) => event.type === 'stage' && event.state === 'running').map((event) => event.stage), ORDER);
  assert.equal(events.at(-1).type, 'result');
});

test('PRAXIS Live Tier 3 preserves contradicted verdicts through LangGraph', async () => {
  const events = [];
  const result = await runLiveScenarioOrchestrated('false-claim', { onEvent: (event) => events.push(event) });
  assert.equal(result.verdict, 'CONTRADICTED');
  assert.equal(verifyVerifyReceipt(result.receipt), true);
  const orchestration = events.find((event) => event.type === 'orchestration');
  assert.equal(orchestration.engine, 'LangGraph.js');
  assert.equal(orchestration.mode, 'framework');
  assert.deepEqual(orchestration.nodes, ORDER);
  assert.deepEqual(events.filter((event) => event.type === 'stage' && event.state === 'running').map((event) => event.stage), ORDER);
  assert.equal(events.at(-1).type, 'result');
});

test('PRAXIS Live serves one page and streams a token-protected run', async (t) => {
  const { server, token } = createLiveServer({ stageDelayMs: 0 });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  }));
  const port = await listenLiveLocal(server, 0);
  const origin = `http://127.0.0.1:${port}`;
  const page = await fetch(`${origin}/?t=${token}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /EXTRACTOR/); assert.match(html, /RETRIEVER/); assert.match(html, /VERIFIER/); assert.match(html, /JUDGE/);
  assert.match(html, new RegExp(token));
  const visual = await fetch(`${origin}/engine-visual.js`);
  assert.equal(visual.status, 200);
  const three = await fetch(`${origin}/three.module.js`);
  assert.equal(three.status, 200);
  const threeCore = await fetch(`${origin}/three.core.js`);
  assert.equal(threeCore.status, 200);
  const denied = await fetch(`${origin}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"scenario":"truthful"}' });
  assert.equal(denied.status, 403);
  const response = await fetch(`${origin}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-praxis-token': token }, body: '{"scenario":"truthful"}' });
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events[0].engine, 'LangGraph.js');
  assert.equal(events[0].mode, 'framework');
  assert.equal(events.at(-1).verdict, 'VERIFIED');
  assert.equal(verifyVerifyReceipt(events.at(-1).receipt), true);
});

test('PRAXIS Live keeps receipt verification local and wires the visual engine as decoration', () => {
  const html = fs.readFileSync(path.resolve('web/live/index.html'), 'utf8');
  const app = fs.readFileSync(path.resolve('web/live/app.js'), 'utf8');
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(html, /connect-src 'self'/);
  assert.match(app, /receipt-verify\.js/);
  assert.match(app, /verifyPublicReceipt/);
  assert.match(app, /renderEvidence/);
  assert.match(html, /RETRIEVED EVIDENCE/);
  assert.match(html, /LIVE CLAIM GRAPH/);
  assert.match(app, /createLiveGraph/);
  assert.match(app, /engine-visual\.js/);
  assert.match(html, /LANGGRAPH · READY/);
  assert.match(html, /00 · ENGINE/);
  assert.match(html, /engine-canvas/);
  assert.match(app, /event\.type === 'orchestration'/);
});
