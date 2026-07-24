// A hand-rolled MCP server — the platform surface where PRAXIS commands vanish.
//
// The Model Context Protocol lets the host model (Claude Code) call a server's
// tools directly. PRAXIS registers its capabilities as tools, so instead of a
// human typing `praxis receipt`, the model itself invokes praxis_receipt when it
// matters ("let me check I actually finished"). The intelligence works behind
// the platform; nothing is typed.
//
// Transport: newline-delimited JSON-RPC 2.0 over stdio. Each line in = one
// message; each line out = one response. Requests (with an `id`) get a response;
// notifications (no `id`) get none. Zero dependencies — Node builtins only.
//
// Hard rule: stdout carries ONLY protocol JSON. Anything else (logs, banners)
// goes to stderr, or it corrupts the channel and the host disconnects.

import readline from 'node:readline';

const PROTOCOL_VERSION = '2025-06-18';

function ok(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function err(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** Shape a tool for tools/list — the model only needs name, description, schema. */
function publicShape(t) {
  return { name: t.name, description: t.description, inputSchema: t.inputSchema || { type: 'object', properties: {} } };
}

/** Wrap a handler's return value into an MCP tool result. A string becomes text;
 *  an object with {content} passes through; anything else is JSON-stringified. */
function toolResult(value) {
  if (value && typeof value === 'object' && Array.isArray(value.content)) return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

/**
 * Build the message handler. Pure: given a parsed JSON-RPC message, returns the
 * response object, or null for a notification (which must not be answered).
 *
 * @param {{tools:Array, serverInfo:object}} cfg
 */
export function createServer({ tools = [], serverInfo = { name: 'praxis', version: '0.0.0' } } = {}) {
  async function handle(msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      // malformed; only answer if it carried an id
      return msg && msg.id !== undefined ? err(msg.id ?? null, -32600, 'invalid request') : null;
    }
    const isNotification = msg.id === undefined || msg.id === null;

    switch (msg.method) {
      case 'initialize': {
        const requested = msg.params && msg.params.protocolVersion;
        return ok(msg.id, {
          protocolVersion: typeof requested === 'string' ? requested : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo,
        });
      }
      case 'tools/list':
        return ok(msg.id, { tools: tools.map(publicShape) });
      case 'tools/call': {
        const name = msg.params && msg.params.name;
        const tool = tools.find((t) => t.name === name);
        if (!tool) return err(msg.id, -32602, `unknown tool: ${name}`);
        try {
          const value = await tool.handler((msg.params && msg.params.arguments) || {});
          return ok(msg.id, toolResult(value));
        } catch (e) {
          // a tool error is a RESULT with isError, not a protocol error — the
          // model should see it and react, not have the call rejected.
          return ok(msg.id, { content: [{ type: 'text', text: 'praxis tool error: ' + (e && e.message ? e.message : String(e)) }], isError: true });
        }
      }
      case 'ping':
        return ok(msg.id, {});
      default:
        if (isNotification) return null; // notifications/initialized, cancelled, etc.
        return err(msg.id, -32601, `method not found: ${msg.method}`);
    }
  }
  return { handle };
}

/**
 * Drive a server over stdio (or injected streams for tests). Reads one JSON-RPC
 * message per line, writes one response line per request. Never lets a bad line
 * crash the loop — a parse error answers with a protocol error (id null).
 */
export function runStdio(server, { input = process.stdin, output = process.stdout, onClose } = {}) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const pending = new Set(); // in-flight handlers, so close drains before shutdown
  const write = (obj) => {
    if (obj) output.write(JSON.stringify(obj) + '\n');
  };
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      write(err(null, -32700, 'parse error'));
      return;
    }
    const task = (async () => {
      try {
        write(await server.handle(msg));
      } catch (e) {
        // never throw out of the loop; if the message had an id, report it
        if (msg && msg.id !== undefined && msg.id !== null) write(err(msg.id, -32603, 'internal error: ' + (e && e.message)));
      }
    })();
    pending.add(task);
    task.finally(() => pending.delete(task));
  });
  rl.on('close', async () => {
    await Promise.allSettled([...pending]); // finish answering in-flight requests
    if (onClose) onClose();
  });
  return rl;
}
