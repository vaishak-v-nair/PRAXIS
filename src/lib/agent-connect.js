import fs from 'node:fs';
import path from 'node:path';
import { isInstalled, TOOLS } from './tools.js';
import { discoverAgents } from './jobs/discovery.js';
export { executableAvailable, discoverAgents } from './jobs/discovery.js';


function writableFile(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Symlink config path');
  }
  return current;
}

export function connectAgents(root = process.cwd(), agents = discoverAgents()) {
  root = fs.realpathSync(root);
  const server = { command: 'npx', args: ['-y', 'praxis-memory', 'mcp'] };
  const results = [];
  for (const agent of agents.filter(a => a.installed)) {
    if (agent.custom) {
      results.push({ name: agent.name, state: 'adapter-ready' }); continue;
    }
    if (agent.name === 'codex' || agent.name === 'cursor') {
      results.push({ name: agent.name, state: 'instructions-linked', detail: 'AGENTS.md shares PRAXIS memory; MCP config is left to the client to avoid untrusted project startup.' });
      continue;
    }
    const relative = { claude: '.mcp.json', gemini: '.gemini/settings.json', opencode: 'opencode.json' }[agent.name];
    if (!relative) continue;
    try {
      const file = writableFile(root, relative);
      let raw = '';
      try { raw = fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      let next;
      {
        const config = raw ? JSON.parse(raw) : {};
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid config');
        const key = agent.name === 'opencode' ? 'mcp' : 'mcpServers';
        if (config[key] && (typeof config[key] !== 'object' || Array.isArray(config[key]))) throw new Error('Invalid server map');
        config[key] ||= {};
        if (Object.hasOwn(config[key], 'praxis')) { results.push({ name: agent.name, state: 'existing', file: relative }); continue; }
        config[key].praxis = agent.name === 'opencode' ? { type: 'local', command: [server.command, ...server.args], enabled: true } : server;
        next = JSON.stringify(config, null, 2) + '\n';
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, next);
      results.push({ name: agent.name, state: 'configured', file: relative });
    } catch {
      results.push({ name: agent.name, state: 'needs-attention', file: relative, detail: 'Configuration preserved; could not safely update.' });
    }
  }
  return results;
}

export function autoConnect(root = process.cwd()) {
  const agents = discoverAgents();
  if (isInstalled(TOOLS.cursor)) agents.push({ name: 'cursor', installed: true });
  return { agents, links: connectAgents(root, agents), note: 'Restart clients to load PRAXIS. Trust prompts and auth still apply.' };
}
