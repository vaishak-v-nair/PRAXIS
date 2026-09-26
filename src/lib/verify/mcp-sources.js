import { VerifyInputError } from './schema.js';

export const MCP_SOURCE_SCHEMA = 'praxis.verify.mcp-sources/v1';

const definitions = {
  github: {
    id: 'github',
    vendor: 'GitHub',
    transport: 'streamable-http',
    endpoint: 'https://api.githubcopilot.com/mcp/',
    evidenceClass: 'github-context',
    strength: 'supporting',
    toolPrefixes: ['pull_request_', 'get_pull_request', 'list_code_scanning_', 'get_code_scanning_', 'list_dependabot_', 'get_dependabot_'],
  },
  playwright: {
    id: 'playwright',
    vendor: 'Microsoft',
    transport: 'streamable-http',
    endpoint: 'http://127.0.0.1:8931/mcp',
    launchPackage: '@playwright/mcp',
    evidenceClass: 'ui-runtime',
    strength: 'runtime-direct',
    toolPrefixes: ['browser_'],
  },
  sentry: {
    id: 'sentry',
    vendor: 'Sentry',
    transport: 'streamable-http',
    endpoint: 'https://mcp.sentry.dev/mcp',
    evidenceClass: 'production-observation',
    strength: 'production-direct',
    toolPrefixes: ['search_', 'get_', 'list_', 'find_', 'analyze_', 'whoami'],
  },
  supabase: {
    id: 'supabase',
    vendor: 'Supabase',
    transport: 'streamable-http',
    endpoint: 'https://mcp.supabase.com/mcp',
    evidenceClass: 'database-state',
    strength: 'database-direct',
    toolPrefixes: ['list_tables', 'list_migrations', 'execute_sql', 'get_logs', 'get_advisors'],
  },
};

export const OFFICIAL_MCP_SOURCES = Object.freeze(Object.fromEntries(
  Object.entries(definitions).map(([key, value]) => [key, Object.freeze({ ...value, toolPrefixes: Object.freeze(value.toolPrefixes) })]),
));

export function officialMcpSource(id) {
  const source = OFFICIAL_MCP_SOURCES[String(id || '').toLowerCase()];
  if (!source) throw new VerifyInputError('unreviewed-mcp-source', `MCP evidence source "${id}" is not in the official vendor registry.`);
  return source;
}

export function assertAllowedMcpTool(source, tool) {
  const name = String(tool || '');
  if (!name || !source.toolPrefixes.some((prefix) => name === prefix || name.startsWith(prefix))) {
    throw new VerifyInputError('unreviewed-mcp-tool', `${source.vendor} MCP tool "${name}" is not in the reviewed evidence allowlist.`);
  }
  return name;
}

export function endpointForSource(source, options = {}, env = process.env) {
  if (source.id === 'supabase') {
    const projectRef = String(options.projectRef || env.SUPABASE_PROJECT_REF || '');
    if (!/^[a-z0-9]{6,64}$/.test(projectRef)) throw new VerifyInputError('mcp-project-required', 'Supabase evidence requires a valid projectRef or SUPABASE_PROJECT_REF.');
    const url = new URL(source.endpoint);
    url.searchParams.set('project_ref', projectRef);
    url.searchParams.set('read_only', 'true');
    url.searchParams.set('features', 'database,debugging');
    return url.toString();
  }
  return source.endpoint;
}

export function authForSource(source, env = process.env) {
  const token = source.id === 'github'
    ? env.PRAXIS_GITHUB_MCP_TOKEN || env.GITHUB_TOKEN
    : source.id === 'sentry'
      ? env.SENTRY_ACCESS_TOKEN
      : source.id === 'supabase'
        ? env.SUPABASE_ACCESS_TOKEN
        : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}