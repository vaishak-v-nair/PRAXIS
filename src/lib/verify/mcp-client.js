import { VerifyInputError } from './schema.js';

function parseSse(text) {
  const data = String(text).split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter(Boolean);
  if (!data.length) throw new VerifyInputError('mcp-malformed-response', 'MCP server returned an empty event stream.');
  return JSON.parse(data.at(-1));
}

async function responsePayload(response) {
  if (response.status === 202 || response.status === 204) return null;
  const text = await response.text();
  if (!response.ok) throw new VerifyInputError('mcp-request-failed', 'MCP server returned HTTP ' + response.status + '.');
  try { return response.headers.get('content-type')?.includes('text/event-stream') ? parseSse(text) : JSON.parse(text); }
  catch (error) { if (error instanceof VerifyInputError) throw error; throw new VerifyInputError('mcp-malformed-response', 'MCP server returned malformed JSON: ' + error.message); }
}

export class McpHttpClient {
  constructor({ endpoint, headers = {}, fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
    if (typeof fetchImpl !== 'function') throw new VerifyInputError('mcp-unavailable', 'This Node runtime does not provide fetch.');
    this.endpoint = endpoint;
    this.headers = headers;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.sessionId = null;
    this.nextId = 1;
  }

  async send(method, params, notification = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const body = { jsonrpc: '2.0', method };
      if (!notification) body.id = this.nextId++;
      if (params !== undefined) body.params = params;
      const response = await this.fetch(this.endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          ...this.headers,
          ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const session = response.headers.get('mcp-session-id');
      if (session) this.sessionId = session;
      const payload = await responsePayload(response);
      if (payload?.error) throw new VerifyInputError('mcp-tool-failed', 'MCP error ' + payload.error.code + ': ' + payload.error.message);
      return payload?.result ?? payload;
    } catch (error) {
      if (error instanceof VerifyInputError) throw error;
      if (error?.name === 'AbortError') throw new VerifyInputError('mcp-timeout', 'MCP evidence request timed out.');
      throw new VerifyInputError('mcp-request-failed', error.message);
    } finally {
      clearTimeout(timer);
    }
  }

  async initialize() {
    const result = await this.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'praxis-verify', version: '1' } });
    await this.send('notifications/initialized', undefined, true);
    return result;
  }

  callTool(name, args = {}) {
    return this.send('tools/call', { name, arguments: args });
  }
}