// Read-only Workbench bridge. The official registry and transport stay shared
// with Verify; submitted projects never select an endpoint or executable.
import { existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const shared = existsSync(path.join(here, 'verify/mcp-sources.js'))
  ? path.join(here, 'verify') : path.resolve(here, '../../../src/lib/verify');
const { OFFICIAL_MCP_SOURCES, officialMcpSource, endpointForSource, authForSource } =
  await import(pathToFileURL(path.join(shared, 'mcp-sources.js')));
const { McpHttpClient } = await import(pathToFileURL(path.join(shared, 'mcp-client.js')));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const MAX_BYTES = 256 * 1024;

export function availability(env = process.env) {
  return Object.values(OFFICIAL_MCP_SOURCES).map(source => ({
    id: source.id, vendor: source.vendor, endpoint: source.endpoint,
    evidence_class: source.evidenceClass, configured: source.id === 'playwright'
      ? false : !!authForSource(source, env).authorization,
    status: 'not_queried',
    detail: source.id === 'playwright'
      ? 'An explicitly started official Microsoft Playwright MCP session is required on port 8931.'
      : 'A server-side access token is required. Configuration does not prove access.',
  }));
}

export function evidenceRequest(input, env = process.env) {
  const source = officialMcpSource(input.source);
  let calls = [], scope;
  const word = (value, pattern, label) => {
    if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`Invalid ${label}.`);
    return value;
  };
  if (source.id === 'github' && input.operation === 'pull-request') {
    const repository = word(input.repository, /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/, 'repository');
    if (!Number.isSafeInteger(input.pull_number) || input.pull_number < 1) throw new Error('Invalid pull request number.');
    const [owner, repo] = repository.split('/');
    const args = { owner, repo, pullNumber: input.pull_number };
    calls = [{ tool: 'pull_request_read', args: { ...args, method: 'get' } },
      { tool: 'pull_request_read', args: { ...args, method: 'get_files', perPage: 30 } },
      { tool: 'list_code_scanning_alerts', args: { owner, repo, state: 'open', perPage: 30 } },
      { tool: 'list_dependabot_alerts', args: { owner, repo, state: 'open', perPage: 30 } }];
    scope = { repository, pull_number: input.pull_number };
  } else if (source.id === 'playwright' && input.operation === 'snapshot') {
    calls = [{ tool: 'browser_snapshot', args: {} }]; scope = { session: 'existing-local-browser' };
  } else if (source.id === 'sentry' && input.operation === 'issue') {
    const organizationSlug = word(input.organization, /^[A-Za-z0-9_-]{1,100}$/, 'Sentry organization');
    const issueId = word(input.issue_id, /^[A-Za-z0-9_-]{1,100}$/, 'Sentry issue');
    calls = [{ tool: 'get_issue_details', args: { organizationSlug, issueId } }];
    scope = { organization: organizationSlug, issue_id: issueId };
  } else if (source.id === 'supabase' && input.operation === 'schema') {
    const projectRef = word(input.project_ref, /^[a-z0-9]{6,64}$/, 'Supabase project reference');
    calls = [{ tool: 'list_tables', args: { schemas: ['public'] } },
      { tool: 'list_migrations', args: {} }]; scope = { project_ref: projectRef, schemas: ['public'] };
  } else throw new Error('This read-only evidence operation is not reviewed.');
  let endpoint = endpointForSource(source, { projectRef: input.project_ref }, env);
  const headers = authForSource(source, env);
  if (source.id !== 'playwright' && !headers.authorization) throw new Error('No server-side access token is configured for this source.');
  if (source.id === 'github') {
    endpoint = source.endpoint + 'readonly';
    headers['X-MCP-Readonly'] = 'true';
    headers['X-MCP-Tools'] = [...new Set(calls.map(call => call.tool))].join(',');
  }
  return { source, calls, scope, endpoint, headers };
}

export function boundedFetch(fetchImpl = fetch, deadline = Date.now() + 25000) {
  return async (url, options) => {
    const response = await fetchImpl(url, { ...options, redirect: 'error',
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))].filter(Boolean)) });
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('MCP response exceeds the evidence limit.');
    if (!response.body) return response;
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > MAX_BYTES) throw new Error('MCP response exceeds the evidence limit.');
        chunks.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
  };
}

export async function collect(input, { env = process.env, clientFactory, fetchImpl } = {}) {
  const started = new Date().toISOString();
  const request = evidenceRequest(input, env);
  const client = clientFactory ? clientFactory(request) : new McpHttpClient({
    endpoint: request.endpoint, headers: request.headers,
    fetchImpl: boundedFetch(fetchImpl), timeoutMs: 8000 });
  await client.initialize();
  const records = [];
  for (const call of request.calls) {
    const provenance = { tool: call.tool, query_digest: digest(call.args), observed_at: new Date().toISOString() };
    try {
      const result = await client.callTool(call.tool, call.args);
      if (result?.isError) throw new Error('The official MCP server reported a tool error.');
      if (!result || typeof result !== 'object') throw new Error('The official MCP server returned no evidence.');
      const structured = result.structuredContent;
      const usableStructured = structured !== null && structured !== undefined &&
        ((typeof structured === 'object') || typeof structured === 'boolean' ||
         (typeof structured === 'number' && Number.isFinite(structured)) ||
         (typeof structured === 'string' && structured.trim().length > 0));
      const content = usableStructured ? structured : (Array.isArray(result.content)
        ? result.content.filter(c => c?.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n') : '');
      if (typeof content === 'string' && !content.trim()) throw new Error('The official MCP server returned no usable text.');
      records.push({ ...provenance, status: 'observed', result_digest: digest(content),
        excerpt: (typeof content === 'string' ? content : JSON.stringify(content)).slice(0, 3000) });
    } catch (error) {
      // Avoid echoing remote errors: they may include tokens or untrusted content.
      records.push({ ...provenance, status: 'unavailable', detail: 'The tool failed, timed out, or returned unusable evidence. No successful result was inferred.' });
    }
  }
  return { schema: 'praxis.workbench.external-evidence/v1', source: request.source.id,
    vendor: request.source.vendor, endpoint: request.endpoint, scope: request.scope,
    started_at: started, observed_at: new Date().toISOString(), source_binding: 'user_selected',
    status: records.every(record => record.status === 'observed') ? 'observed' : 'partial', records,
    limitation: 'Supplementary vendor observation. It does not replace local checks, bind remote deployment state to this snapshot, or establish production readiness.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let input = ''; for await (const chunk of process.stdin) {
      input += chunk; if (Buffer.byteLength(input) > 8192) throw new Error('Request too large.');
    }
    const request = JSON.parse(input);
    const result = request.mode === 'status' ? availability() : await collect(request);
    process.stdout.write(JSON.stringify(result));
  } catch {
    process.stdout.write(JSON.stringify({ status: 'unavailable', detail: 'Official evidence source unavailable. Check the server-side token, scope, permission and MCP session. No result was inferred.' }));
    process.exitCode = 1;
  }
}
