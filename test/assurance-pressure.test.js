import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect, evidenceRequest } from '../apps/workbench/tools/mcp-evidence.mjs';

test('an empty or display-only MCP result cannot be labeled an observed evidence record', async () => {
  for (const content of [[], [{ type: 'text', text: '' }], [{ type: 'text', text: '   \n' }],
    [{ type: 'image', data: 'fixture', mimeType: 'image/png' }]]) {
    const result = await collect({ source: 'playwright', operation: 'snapshot' }, {
      env: {}, clientFactory: () => ({ initialize: async () => ({}),
        callTool: async () => ({ content }) }),
    });
    assert.equal(result.records[0].status, 'unavailable', `No usable textual observation: ${JSON.stringify(content)}`);
    assert.notEqual(result.status, 'observed');
  }
});

test('a vendor tool error or malformed result cannot contribute raw secret error text', async () => {
  const secret = 'fixture token deliberately embedded in a remote exception';
  for (const raw of [{ isError: true, content: [{ type: 'text', text: secret }] },
    { content: {} }, null]) {
    const result = await collect({ source: 'playwright', operation: 'snapshot' }, {
      env: {}, clientFactory: () => ({ initialize: async () => ({}), callTool: async () => raw }),
    });
    assert.equal(result.records[0].status, 'unavailable');
    assert.ok(!JSON.stringify(result).includes(secret));
  }
});

test('user-supplied endpoint or write-tool fields cannot override the reviewed evidence operation', () => {
  const result = evidenceRequest({ source: 'supabase', operation: 'schema', project_ref: 'testproject',
    endpoint: 'http://127.0.0.1:9999/unreviewed', sql: 'DROP TABLE users', tool: 'execute_sql' },
  { SUPABASE_ACCESS_TOKEN: 'fixture' });
  assert.ok(result.endpoint.startsWith('https://mcp.supabase.com/mcp'));
  assert.deepEqual(result.calls.map(call => call.tool), ['list_tables', 'list_migrations']);
  assert.ok(!JSON.stringify(result.calls).includes('DROP TABLE'));
});
