// The full review-and-repair app is optional; core capture never loads its deps.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function workbenchStatus({ cwd = process.cwd(), appPath } = {}) {
  const local = path.join(cwd, 'apps', 'workbench');
  const root = appPath ? path.resolve(cwd, appPath)
    : fs.existsSync(path.join(local, 'package.json')) ? local
      : path.join(CHECKOUT, 'apps', 'workbench');
  const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const required = [
    ['application', 'package.json'],
    ['frontend source', 'app/page.tsx'],
    ['backend source', 'backend/regen/app.py'],
    ['Next.js', 'node_modules/next/package.json'],
    ['service coordinator', 'node_modules/concurrently/package.json'],
    ['Python environment', path.relative(root, python)],
  ];
  const missing = required.filter(([, file]) => !fs.existsSync(path.join(root, file))).map(([name]) => name);
  return { ok: missing.length === 0, root, python, missing,
    frontendUrl: 'http://127.0.0.1:3000', backendUrl: 'http://127.0.0.1:9123' };
}

/** Use npm's JS entry point when possible, avoiding Windows shim quoting. */
export function npmInvocation(script, env = process.env) {
  const candidates = [env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const entry = candidates.find((file) => file && path.basename(file) === 'npm-cli.js' && fs.existsSync(file));
  if (entry) return { command: process.execPath, args: [entry, 'run', script], shell: false };
  return { command: 'npm', args: ['run', script], shell: process.platform === 'win32' };
}

export function launchWorkbench(status, { production = false, spawnImpl = spawn } = {}) {
  const invocation = npmInvocation(production ? 'start' : 'dev');
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(invocation.command, invocation.args, {
        cwd: status.root, stdio: 'inherit', windowsHide: true,
        shell: invocation.shell, env: { ...process.env },
      });
    } catch {
      console.error('Could not start the workbench. Check npm and the workbench dependencies.');
      resolve(1);
      return;
    }
    let stopping = false;
    const stop = () => {
      if (stopping || child.exitCode != null) return;
      stopping = true;
      // npm owns the coordinator, which owns both services. On Windows a
      // single-process kill would strand them; terminate only our child tree.
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true, stdio: 'ignore',
        });
        killer.once('error', () => child.kill('SIGTERM'));
      } else child.kill('SIGTERM');
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    const finish = (code) => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      resolve(code ?? 1);
    };
    child.once('error', () => {
      console.error('Could not start the workbench. Check npm and the workbench dependencies.');
      finish(1);
    });
    child.once('close', finish);
  });
}
