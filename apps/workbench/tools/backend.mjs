import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { join } from 'node:path';
const executable = join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(executable)) {
  console.error('Missing workbench Python environment. See docs/WORKBENCH-INTEGRATION.md in the PRAXIS checkout.');
  process.exit(1);
}
const python = executable;
const args = process.argv[2] === 'test'
  ? ['-m', 'unittest', 'discover', '-s', 'backend/tests', '-v']
  : ['-m', 'uvicorn', 'regen.app:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', process.env.REGEN_BACKEND_PORT || '9123'];
const development = process.argv[2] === 'dev';
const windowsReload = development && process.platform === 'win32';
const source = join(process.cwd(), 'backend', 'regen');
if (development && !windowsReload) args.push('--reload', '--reload-dir', source);
// Uvicorn's Windows reloader broadcasts CTRL_C_EVENT to the shared console,
// stopping Next/npm too. Node watches source and restarts only our Python tree.
let child, watcher, timer, restarting = false, stopping = false;
function killTree() {
  if (!child || child.exitCode != null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.once('error', error => { console.error(`Could not stop API tree: ${error.message}`); process.exit(1); });
  } else child.kill('SIGTERM');
}
function launch() {
  child = spawn(python, args, { stdio: 'inherit', windowsHide: true, env: { ...process.env, PYTHONPATH: join(process.cwd(), 'backend') } });
  child.once('error', error => { console.error(error.message); process.exit(1); });
  child.once('close', code => {
    if (restarting && !stopping) { restarting = false; launch(); }
    else process.exit(stopping ? 0 : code ?? 1);
  });
}
launch();
if (windowsReload) {
  watcher = watch(source, { recursive: true }, (event, filename) => {
    if (!filename?.endsWith('.py') || stopping) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (restarting || stopping) return;
      restarting = true;
      console.log('API source changed; restarting the API only.');
      killTree();
    }, 300);
  });
  watcher.on('error', error => { console.error(`API watcher failed: ${error.message}`); process.exit(1); });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return;
  stopping = true; clearTimeout(timer); watcher?.close(); killTree();
});
