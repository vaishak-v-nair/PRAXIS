import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availability, evidenceRequest, collect, boundedFetch } from '../apps/workbench/tools/mcp-evidence.mjs';

test('Workbench official sources stay explicit, scoped and read-only', () => {
  assert.deepEqual(availability({}).map(source => source.id), ['github', 'playwright', 'sentry', 'supabase']);
  assert.ok(availability({}).every(source => source.status === 'not_queried' && !source.configured));
  const github = evidenceRequest({ source: 'github', operation: 'pull-request', repository: 'owner/repo', pull_number: 4 }, { GITHUB_TOKEN: 'fixture-only' });
  assert.match(github.endpoint, /\/readonly$/); assert.equal(github.headers['X-MCP-Readonly'], 'true');
  assert.ok(github.calls.every(call => !/create|write|update|delete/.test(call.tool)));
  const supabase = evidenceRequest({ source: 'supabase', operation: 'schema', project_ref: 'abcdefghi' }, { SUPABASE_ACCESS_TOKEN: 'fixture-only' });
  assert.match(supabase.endpoint, /read_only=true/); assert.match(supabase.endpoint, /project_ref=abcdefghi/);
  assert.ok(supabase.calls.every(call => call.tool.startsWith('list_')));
  for (const input of [{ source: 'community', operation: 'schema' }, { source: 'github', operation: 'execute_sql' }, { source: 'supabase', operation: 'schema', project_ref: '../leak' }]) {
    assert.throws(() => evidenceRequest(input, {}));
  }
});

test('official tool error and partial GitHub security access never become success', async () => {
  const result = await collect({ source: 'github', operation: 'pull-request', repository: 'owner/repo', pull_number: 3 }, {
    env: { GITHUB_TOKEN: 'fixture-only' }, clientFactory: () => ({ initialize: async () => {},
      callTool: async tool => tool === 'pull_request_read' ? { content: [{ type: 'text', text: 'real observed diff' }] } : { isError: true, content: [{ type: 'text', text: 'secret error' }] } }) });
  assert.equal(result.status, 'partial'); assert.equal(result.records[2].status, 'unavailable');
  assert.ok(!JSON.stringify(result).includes('secret error'));
  assert.equal(result.source_binding, 'user_selected'); assert.match(result.limitation, /does not replace/);
  assert.match(result.records[0].query_digest, /^[a-f0-9]{64}$/);
});

test('MCP transport refuses redirects and bounds response streams', async () => {
  let options;
  const fetcher = boundedFetch(async (url, init) => { options = init; return new Response('observed'); });
  assert.equal(await (await fetcher('https://vendor.invalid', {})).text(), 'observed');
  assert.equal(options.redirect, 'error');
  await assert.rejects(boundedFetch(async () => new Response('x'.repeat(262145)))('https://vendor.invalid', {}), /limit/);
});
