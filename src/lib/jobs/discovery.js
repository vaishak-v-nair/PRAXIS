import fs from 'node:fs';
import path from 'node:path';
import { BUILTIN_AGENTS, customAdapter } from './adapters.js';

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
