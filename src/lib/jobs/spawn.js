import fs from 'node:fs';
import path from 'node:path';

/** Resolve Windows launchers without interpolating task text into a shell. */
export function agentSpawn(argv, { platform = process.platform, env = process.env } = {}) {
  const [command, ...args] = argv;
  if (!command) throw new Error('Missing agent executable.');
  if (platform !== 'win32') return { file: command, args };
  let executable = command;
  let resolved = false;
  const dirs = path.isAbsolute(command) || command.includes('/') || command.includes('\\')
    ? [''] : (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, command);
    const found = ['', '.exe', '.cmd', '.bat'].map(ext => candidate + ext).find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    if (found) { executable = path.resolve(found); resolved = true; break; }
  }
  if (!resolved) throw new Error(`Agent executable unavailable: ${command}. Install it and check the runner PATH.`);
  if (!/\.(cmd|bat)$/i.test(executable)) return { file: executable, args };
  // npm's standard cmd shim exposes its JS entry point. Launch that directly.
  const shim = fs.readFileSync(executable, 'utf8');
  const entry = [...shim.matchAll(/"%dp0%\\([^"\r\n]+\.(?:[cm]?js))"/gi)]
    .map(match => path.resolve(path.dirname(executable), match[1])).find(file => fs.existsSync(file));
  if (entry) return { file: process.execPath, args: [entry, ...args] };
  // Unknown shell launchers must not receive characters cmd could evaluate.
  if ([executable, ...args].some(arg => /[&|<>^%"\r\n]/.test(arg))) {
    throw new Error('Unsafe Windows shell launcher arguments. Configure a native executable or Node entry point.');
  }
  const quoted = [executable, ...args].map(arg => `"${arg}"`).join(' ');
  return { file: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${quoted}"`] };
}
