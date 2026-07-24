import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createServer, runStdio } from '../src/lib/mcp/server.js';

const tools = [
  { name: 'echo', description: 'echoes', inputSchema: { type: 'object', properties: { x: { type: 'string' } } }, handler: async (a) => 'got ' + JSON.stringify(a) },
  { name: 'boom', description: 'throws', handler: async () => { throw new Error('kaboom'); } },
];
const server = createServer({ tools, serverInfo: { name: 'praxis', version: '1.2.3' } });

test('initialize echoes the requested protocol version and serverInfo', async () => {
  const r = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.deepEqual(r.result.serverInfo, { name: 'praxis', version: '1.2.3' });
  assert.ok(r.result.capabilities.tools);
});

test('tools/list returns name, description, inputSchema', async () => {
  const r = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(r.result.tools.length, 2);
  assert.equal(r.result.tools[0].name, 'echo');
  assert.ok(r.result.tools[0].inputSchema);
});

test('tools/call runs the handler and wraps text content', async () => {
  const r = await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { x: 'hi' } } });
  assert.equal(r.result.content[0].type, 'text');
  assert.match(r.result.content[0].text, /got .*"x":"hi"/);
});

test('tools/call on a throwing tool returns isError, not a protocol error', async () => {
  const r = await server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'boom' } });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /kaboom/);
  assert.equal(r.error, undefined);
});

test('tools/call on an unknown tool is a protocol error -32602', async () => {
  const r = await server.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } });
  assert.equal(r.error.code, -32602);
});

test('ping returns empty result', async () => {
  const r = await server.handle({ jsonrpc: '2.0', id: 6, method: 'ping' });
  assert.deepEqual(r.result, {});
});

test('a notification (no id) gets no response', async () => {
  const r = await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(r, null);
});

test('unknown method with an id is method-not-found -32601', async () => {
  const r = await server.handle({ jsonrpc: '2.0', id: 7, method: 'resources/list' });
  assert.equal(r.error.code, -32601);
});

test('runStdio round-trips a request and answers a parse error with id null', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = [];
  output.on('data', (d) => lines.push(...String(d).trim().split('\n').filter(Boolean)));

  const closed = new Promise((res) => runStdio(server, { input, output, onClose: res }));
  input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  input.write('not json at all\n');
  input.write('\n'); // blank line ignored
  input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n'); // notification, no reply
  input.end();
  await closed;

  const parsed = lines.map((l) => JSON.parse(l));
  assert.equal(parsed.length, 2); // ping reply + parse error; notification produced nothing
  // JSON-RPC correlates by id, not order — match by content, not position
  const ping = parsed.find((m) => m.id === 1);
  const parseErr = parsed.find((m) => m.error && m.error.code === -32700);
  assert.deepEqual(ping, { jsonrpc: '2.0', id: 1, result: {} });
  assert.equal(parseErr.id, null);
});
