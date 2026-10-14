// Shared process adapter for CLI and optional desktop. The engine stays in
// Workbench; submitted source never supplies these executable/argument paths.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function startReviewRuntime({ root, python, backendEntry, frontendEntry, node = process.execPath, backendPort, uiPort, token, instanceId, env = process.env, signal, log = text => process.stderr.write(text) } = {}) {
  if (!path.isAbsolute(root || '') || !path.isAbsolute(node) || !/^[a-f0-9]{64}$/.test(token || '') || !/^[a-f0-9]{32}$/.test(instanceId || '') || ![backendPort, uiPort].every(port => Number.isInteger(port) && port > 0 && port < 65536)) throw new Error('Invalid trusted Review runtime configuration.');
  const api = backendEntry || python || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const web = frontendEntry || path.join(root, 'node_modules/next/dist/bin/next');
  if (![api, web].every(file => path.isAbsolute(file) && fs.existsSync(file))) throw new Error('The existing Review runtime is incomplete. No submitted project was run.');
  const runtimeEnv = { ...env, PYTHONPATH: path.join(root, 'backend'), PRAXIS_NODE_EXECUTABLE: node, PRAXIS_REVIEW_SERVICE_TOKEN: token, PRAXIS_REVIEW_SERVICE_INSTANCE: instanceId, REGEN_BACKEND_PORT: String(backendPort), REGEN_BACKEND_URL: `http://127.0.0.1:${backendPort}`, HOSTNAME: '127.0.0.1', PORT: String(uiPort), NODE_ENV: 'production' };
  const children = [], terminations = new WeakMap(); let stopping = false;
  const kill = child => {
    if (terminations.has(child)) return terminations.get(child);
    const result = (async () => {
      if (child.exitCode !== null || child.signalCode !== null || !Number.isSafeInteger(child.pid) || child.pid < 1) return;
      const exited = new Promise(resolve => child.once('close', resolve));
      if (process.platform === 'win32') {
        await new Promise((resolve, reject) => {
          const command = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
          command.once('error', reject); command.once('close', code => code === 0 || child.exitCode !== null ? resolve() : reject(new Error('An owned Review process could not be stopped.')));
        });
      } else {
        // Each child starts its own group. Only that owned group is signalled.
        try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      const timeout = setTimeout(() => {
        if (child.exitCode === null && process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* close/error decides lifecycle */ } }
      }, 5000); timeout.unref();
      await exited; clearTimeout(timeout);
    })();
    terminations.set(child, result); return result;
  };
  const stop = async () => { stopping = true; await Promise.all(children.map(kill)); signal?.removeEventListener('abort', abort); };
  const abort = () => { stop().catch(error => log(`Review shutdown failed: ${error.message}\n`)); };
  signal?.throwIfAborted();
  const launch = (command, args, cwd) => {
    const child = spawn(command, args, { cwd, env: runtimeEnv, windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', buffer => log(buffer.toString())); child.stderr.on('data', buffer => log(buffer.toString()));
    const closed = new Promise(resolve => { child.once('error', error => { log(`Review process failed: ${error.message}\n`); resolve({ code: 1 }); }); child.once('close', (code, endedSignal) => resolve({ code, signal: endedSignal })); });
    closed.then(() => { if (!stopping) { stopping = true; Promise.all(children.filter(other => other !== child).map(kill)).catch(error => log(`Review shutdown failed: ${error.message}\n`)); } });
    children.push(child); return { child, closed };
  };
  const backend = launch(api, backendEntry ? [] : ['-m', 'uvicorn', 'regen.app:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', String(backendPort), '--no-access-log'], backendEntry ? path.dirname(api) : root);
  const frontend = launch(node, frontendEntry ? [web] : [web, 'start', '--hostname', '127.0.0.1', '--port', String(uiPort)], frontendEntry ? path.dirname(web) : root);
  signal?.addEventListener('abort', abort, { once: true });
  return { stop, childPids: [backend.child.pid, frontend.child.pid].filter(Boolean), closed: Promise.all([backend.closed, frontend.closed]) };
}
