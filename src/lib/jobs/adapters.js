// User-configured CLI adapters. argv arrays never become shell command strings.
export const BUILTIN_AGENTS = ['claude', 'codex', 'gemini', 'opencode'];

export function customAdapter(tool, mode, env = process.env) {
  const raw = env.PRAXIS_AGENT_ADAPTERS;
  if (!raw) return null;
  if (raw.length > 65536) throw new Error('PRAXIS_AGENT_ADAPTERS exceeds 64 KiB.');
  let adapters;
  try { adapters = JSON.parse(raw); } catch { throw new Error('PRAXIS_AGENT_ADAPTERS must be a JSON object.'); }
  if (!adapters || typeof adapters !== 'object' || Array.isArray(adapters)) throw new Error('PRAXIS_AGENT_ADAPTERS must be a JSON object.');
  if (!Object.hasOwn(adapters, tool)) return null;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool)) throw new Error('Invalid agent name.');
  const modes = adapters[tool];
  const command = modes && Object.hasOwn(modes, mode) ? modes[mode] : null;
  if (!Array.isArray(command) || !command.length || command.length > 100 || command.some(arg => typeof arg !== 'string' || !arg || arg.length > 8192 || /[\x00\r\n]/.test(arg))) {
    throw new Error(`Agent ${tool} needs an explicit argv array for mode ${mode}. No permission mode was substituted.`);
  }
  return [...command];
}

export function agentEnvironment(tool, mode) {
  if (tool !== 'opencode') return {};
  const permission = mode === 'bypassPermissions' ? { '*': 'allow' } : {
    '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow', list: 'allow',
    ...(mode === 'acceptEdits' ? { edit: 'allow' } : {}),
  };
  return { OPENCODE_PERMISSION: JSON.stringify(permission) };
}

export function selectedTool(argv) {
  const index = argv.indexOf('--tool');
  if (index >= 0) {
    const tool = argv[index + 1];
    if (!tool || !/^[a-zA-Z0-9_-]{1,64}$/.test(tool)) throw new Error('--tool requires an agent name.');
    return tool;
  }
  return BUILTIN_AGENTS.find(tool => argv.includes(`--${tool}`)) || 'claude';
}
