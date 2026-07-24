// `praxis mcp` — start PRAXIS as an MCP server on stdio.
//
// This is the platform entry point. A host (Claude Code) launches it and speaks
// JSON-RPC over stdin/stdout; PRAXIS answers with its tools. From then on the
// model calls praxis_receipt / praxis_verify / praxis_recall on its own — the
// user types no commands.
//
// stdout is the protocol channel: this command must never print anything else
// there. Diagnostics go to stderr only.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, runStdio } from '../lib/mcp/server.js';
import { buildTools } from '../lib/mcp/tools.js';

function version() {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

export async function mcp() {
  const tools = buildTools({ cwd: process.cwd() });
  const server = createServer({ tools, serverInfo: { name: 'praxis', version: version() } });
  process.stderr.write(`praxis mcp: ready — ${tools.length} tools on stdio\n`);
  await new Promise((resolve) => {
    runStdio(server, { input: process.stdin, output: process.stdout, onClose: resolve });
  });
}
