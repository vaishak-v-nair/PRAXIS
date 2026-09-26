import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createLedger } from '../src/lib/verify/ledger.js';
import { verifyWithMcp } from '../src/lib/verify/index.js';
import { CLAIM_SCHEMA } from '../src/lib/verify/schema.js';
import { evaluatePolicy } from '../src/lib/verify/policy.js';
import { McpHttpClient } from '../src/lib/verify/mcp-client.js';
import { expectationMatches, runMcpEvidenceObservers } from '../src/lib/verify/mcp-evidence.js';
import { validateMcpEvidencePolicy, MCP_EVIDENCE_POLICY_SCHEMA } from '../src/lib/verify/mcp-policy.js';
import { endpointForSource, officialMcpSource } from '../src/lib/verify/mcp-sources.js';

const claim = Object.freeze({ id: 'claim-1', sourceText: 'The UI saves the record.' });
const target = Object.freeze({ head: 'a'.repeat(40), base: 'b'.repeat(40) });

function policy(source, tool, expectation = { type: 'text-includes', value: 'ok' }) {
  return validateMcpEvidencePolicy({
    schema: MCP_EVIDENCE_POLICY_SCHEMA,
    checks: [{ id: source + '-check', source, claimIds: [claim.id], calls: [{ tool, arguments: { owner: 'acme' } }], expectation }],
  });
}

test('the MCP registry accepts only reviewed vendor sources and pins official endpoints', () => {
  assert.equal(officialMcpSource('github').endpoint, 'https://api.githubcopilot.com/mcp/');
  assert.equal(officialMcpSource('playwright').vendor, 'Microsoft');
  assert.equal(officialMcpSource('sentry').endpoint, 'https://mcp.sentry.dev/mcp');
  assert.throws(() => officialMcpSource('community-browser'), (error) => error.code === 'unreviewed-mcp-source');
  assert.throws(() => validateMcpEvidencePolicy({
    schema: MCP_EVIDENCE_POLICY_SCHEMA,
    checks: [{ id: 'bad', source: 'github', claimIds: ['claim-1'], calls: [{ tool: 'delete_repository' }], expectation: { type: 'count-zero' } }],
  }), (error) => error.code === 'unreviewed-mcp-tool');
});

test('Supabase evidence is forcibly project-scoped, read-only and feature-limited', () => {
  const url = new URL(endpointForSource(officialMcpSource('supabase'), { projectRef: 'abcdefghijkl' }));
  assert.equal(url.origin + url.pathname, 'https://mcp.supabase.com/mcp');
  assert.equal(url.searchParams.get('project_ref'), 'abcdefghijkl');
  assert.equal(url.searchParams.get('read_only'), 'true');
  assert.equal(url.searchParams.get('features'), 'database,debugging');
});

test('the zero-dependency MCP client negotiates a session before a tool call', async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ body, headers: options.headers });
    if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }), { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' } });
    if (body.method === 'notifications/initialized') return new Response('', { status: 202 });
    return new Response('data: ' + JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { status: 'ok' } } }) + '\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const client = new McpHttpClient({ endpoint: 'https://api.githubcopilot.com/mcp/', fetchImpl });
  await client.initialize();
  const result = await client.callTool('pull_request_read', { owner: 'acme' });
  assert.equal(result.structuredContent.status, 'ok');
  assert.equal(requests[2].headers['mcp-session-id'], 'session-1');
});

test('GitHub context remains supplementary and cannot verify by itself', async () => {
  const ledger = createLedger(target);
  await runMcpEvidenceObservers(target, [claim], ledger, policy('github', 'pull_request_read'), {
    env: { PRAXIS_GITHUB_MCP_TOKEN: 'secret-token' },
    clientFactory: (options) => {
      assert.equal(options.endpoint, 'https://api.githubcopilot.com/mcp/');
      assert.equal(options.headers.authorization, 'Bearer secret-token');
      return { initialize: async () => {}, callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
    },
  });
  const observations = ledger.entries();
  assert.equal(observations[0].strength, 'supporting');
  assert.equal(evaluatePolicy([claim], observations).decisions[0].verdict, 'UNSUPPORTED');
  assert.doesNotMatch(JSON.stringify(observations), /secret-token/);
});

test('Playwright UI observation is decisive direct evidence', async () => {
  const ledger = createLedger(target);
  await runMcpEvidenceObservers(target, [claim], ledger, policy('playwright', 'browser_snapshot'), {
    clientFactory: () => ({ initialize: async () => {}, callTool: async () => ({ structuredContent: { tree: 'button Save ok' } }) }),
  });
  const observation = ledger.entries()[0];
  assert.equal(observation.strength, 'runtime-direct');
  assert.equal(evaluatePolicy([claim], [observation]).decisions[0].verdict, 'VERIFIED');
});

test('Sentry and Supabase can directly contradict production and database claims', async () => {
  for (const [source, tool, env] of [
    ['sentry', 'search_issues', {}],
    ['supabase', 'list_tables', { SUPABASE_PROJECT_REF: 'abcdefghijkl' }],
  ]) {
    const ledger = createLedger(target);
    await runMcpEvidenceObservers(target, [claim], ledger, policy(source, tool, { type: 'count-zero' }), {
      env,
      clientFactory: () => ({ initialize: async () => {}, callTool: async () => ({ structuredContent: [{ id: 1 }] }) }),
    });
    assert.equal(ledger.entries()[0].status, 'contradicts');
    assert.equal(evaluatePolicy([claim], ledger.entries()).decisions[0].verdict, 'CONTRADICTED');
  }
});

test('deterministic MCP expectations cover nested values without an LLM verdict', () => {
  assert.equal(expectationMatches({ type: 'json-path-equals', path: 'rows.0.status', value: 'fixed' }, { rows: [{ status: 'fixed' }] }), true);
  assert.equal(expectationMatches({ type: 'count-positive', path: 'rows' }, { rows: [1] }), true);
  assert.equal(expectationMatches({ type: 'text-not-includes', value: 'mock' }, 'real backend response'), true);
});
test('the integrated MCP path binds evidence to the commit and signs a receipt', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-mcp-integrated-'));
  const root = path.join(parent, 'repo');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  try {
    fs.mkdirSync(root);
    git('init', '-q');
    git('config', 'user.email', 'verify@example.test');
    git('config', 'user.name', 'AI Agent');
    fs.writeFileSync(path.join(root, 'app.js'), 'export const label = "old";\n');
    git('add', '.');
    git('commit', '-qm', 'initial');
    const base = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(root, 'app.js'), 'export const label = "Sign in";\n');
    git('add', '.');
    git('commit', '-qm', 'Add the sign in UI');
    const manifestObject = {
      schema: CLAIM_SCHEMA,
      claims: [{
        id: 'login-ui',
        sourceText: 'Added a Sign in UI in app.js',
        predicate: 'the accessibility tree contains Sign in',
        scope: { kind: 'ui-behavior', paths: ['app.js'], symbols: ['label'] },
        source: { kind: 'fixture' },
        requiredEvidence: ['ui-runtime'],
        required: true,
      }],
    };
    const policyFile = path.join(parent, 'mcp-policy.json');
    fs.writeFileSync(policyFile, JSON.stringify({
      schema: MCP_EVIDENCE_POLICY_SCHEMA,
      checks: [{
        id: 'login-visible',
        source: 'playwright',
        claimIds: ['login-ui'],
        calls: [{ tool: 'browser_snapshot', arguments: {} }],
        expectation: { type: 'text-includes', value: 'Sign in' },
      }],
    }));
    const result = await verifyWithMcp({
      cwd: root,
      base,
      head: 'HEAD',
      mode: 'static',
      taskText: 'Add sign in UI',
      manifestObject,
      mcpPolicy: policyFile,
      keyDir: path.join(parent, 'keys'),
      receiptDir: path.join(parent, 'receipts'),
      mcpRuntime: {
        clientFactory: () => ({ initialize: async () => {}, callTool: async () => ({ content: [{ type: 'text', text: 'button Sign in' }] }) }),
      },
    });
    assert.equal(result.decision.decisions[0].verdict, 'VERIFIED');
    assert.equal(result.mode, 'static+mcp');
    assert.equal(result.artifact.signatureVerified, true);
    assert.equal(fs.existsSync(result.artifact.file), true);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});