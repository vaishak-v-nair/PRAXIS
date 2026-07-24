import fs from 'node:fs';

// Claude Code reads project-scoped MCP servers from `.mcp.json` at the repo root.
// Registering PRAXIS there is what makes the commands disappear ON INSTALL: the
// host model is handed the praxis_* tools with no `claude mcp add`, nothing
// typed. Same runner as the hooks — `npx -y praxis-memory` — so it works whether
// or not `praxis` is on PATH (the npx-only-install lesson, applied here too).
const SERVER = { command: 'npx', args: ['-y', 'praxis-memory', 'mcp'] };

/**
 * Add the PRAXIS MCP server to `.mcp.json` without disturbing any server the
 * user (or another tool) already registered. Idempotent.
 * @returns {{already:boolean}}
 */
export function patchMcpConfig(mcpFile) {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(mcpFile, 'utf8') || '{}');
  } catch {
    cfg = {};
  }
  if (typeof cfg !== 'object' || cfg === null) cfg = {};
  cfg.mcpServers = cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : {};

  const cur = cfg.mcpServers.praxis;
  const already =
    cur && cur.command === SERVER.command && Array.isArray(cur.args) && cur.args.join(' ') === SERVER.args.join(' ');
  if (already) return { already: true };

  cfg.mcpServers.praxis = { command: SERVER.command, args: [...SERVER.args] };
  fs.writeFileSync(mcpFile, JSON.stringify(cfg, null, 2) + '\n');
  return { already: false };
}
