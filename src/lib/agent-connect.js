import fs from 'node:fs';
import path from 'node:path';
import { isInstalled, TOOLS } from './tools.js';
import { BUILTIN_AGENTS, customAdapter } from './jobs/adapters.js';

export function executableAvailable(command, env = process.env, platform = process.platform) {
  const dirs = path.isAbsolute(command) || /[/\\]/.test(command) ? [''] : (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const extensions = platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  return dirs.some(dir => extensions.some(ext => {
    try {
      const file = path.join(dir, command + ext);
      if (!fs.statSync(file).isFile()) return false;
      fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      return true;
    } catch { return false; }
  }));
}

export function discoverAgents(probe = command => executableAvailable(command, env), env = process.env) {
  const names = new Set(BUILTIN_AGENTS);
  if (env.PRAXIS_AGENT_ADAPTERS) for (const name of Object.keys(JSON.parse(env.PRAXIS_AGENT_ADAPTERS))) names.add(name);
  return [...names].map(name => {
    const adapter = customAdapter(name, 'plan', env);
    return { name, installed: probe(adapter?.[0] || name), custom: Boolean(adapter) };
  });
}

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
    const relative = { claude: '.mcp.json', codex: '.codex/config.toml', gemini: '.gemini/settings.json', opencode: 'opencode.json', cursor: '.cursor/mcp.json' }[agent.name];
    if (!relative) continue;
    try {
      const file = writableFile(root, relative);
      let raw = '';
      try { raw = fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      let next;
      if (agent.name === 'codex') {
        // Preserve user-owned TOML. Refuse unfamiliar syntax rather than rewrite it.
        if (/praxis/.test(raw)) { results.push({ name: agent.name, state: 'existing', file: relative }); continue; }
        if (raw && /mcp_servers\s*=|\[\[|'''|"""/.test(raw)) throw new Error('Complex TOML');
        next = raw.trimEnd() + '\n\n[mcp_servers.praxis]\ncommand = "npx"\nargs = ["-y", "praxis-memory", "mcp"]\n';
      } else {
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
