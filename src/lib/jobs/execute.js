// Bounded foreground execution for the optional Workbench. No detached jobs,
// receipt inference, project-selected commands, or permission-mode fallback.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { builtinAdapter, customAdapter, buildAgentArgv, agentEnvironment } from './adapters.js';
import { agentSpawn } from './spawn.js';

function completion(stdout, tool) {
  let report = '';
  let agentError = false;
  for (const line of [stdout, ...stdout.split('\n')]) {
    try {
      const item = JSON.parse(line);
      if (tool === 'codex' && item.type === 'item.completed' && item.item?.type === 'agent_message') report = item.item.text;
      if (tool === 'claude' && item.type === 'result') { report = item.result || ''; agentError ||= item.is_error === true; }
      if (tool === 'gemini' && typeof item.response === 'string') report = item.response;
      if (tool === 'opencode' && item.type === 'text' && typeof item.part?.text === 'string') report += item.part.text;
      agentError ||= item.type === 'error' || item.type === 'turn.failed' || Boolean(item.error);
    } catch { /* Unknown output is still a claim, never signed evidence. */ }
  }
  return { report: typeof report === 'string' && report.trim() ? report.trim() : stdout.trim(), agentError };
}

export async function executeAgent({ tool, task, cwd, timeoutMs = 120000, maxBytes = 65536, signal, env = process.env }) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool || '') || typeof task !== 'string' || !task.trim() || Buffer.byteLength(task) > 65536) throw new Error('Invalid agent task.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000 || !Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 65536) throw new Error('Invalid agent execution limits.');
  if (!path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory() || fs.lstatSync(cwd).isSymbolicLink()) throw new Error('Agent work requires an absolute review-copy folder.');
  const custom = customAdapter(tool, 'plan', env);
  const base = custom || builtinAdapter(tool);
  if (!base) throw new Error('No configured adapter for this agent.');
  if (signal?.aborted) return { status: 'cancelled', exitCode: null, report: '', verification: 'not_evaluated' };
  const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-agent-task-'));
  const taskFile = path.join(taskDir, 'task.txt');
  fs.writeFileSync(taskFile, task, { mode: 0o600 });
  try {
    const argv = buildAgentArgv(base, { mode: 'plan', injected: !!custom,
      extraArgs: tool === 'codex' && !custom ? ['--skip-git-repo-check'] : [] }).map(arg => arg.replaceAll('{taskFile}', taskFile));
    const launch = agentSpawn(argv, { env });
    return await new Promise(resolve => {
      let stdout = '', stderr = '', bytes = 0, reason = null, finished = false, stopping = false;
      const child = spawn(launch.file, launch.args, { cwd, env: { ...env, ...agentEnvironment(tool, 'plan') },
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32', shell: false });
      function stop(why) {
        if (finished || stopping) return;
        stopping = true; reason = why;
        if (process.platform === 'win32' && child.pid) {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
          killer.on('error', () => child.kill());
        } else {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        }
      }
      const timer = setTimeout(() => stop('timed_out'), timeoutMs);
      const abort = () => stop('cancelled');
      signal?.addEventListener('abort', abort, { once: true });
      const take = target => chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > maxBytes) { stop('output_limit'); return; }
        if (target === 'stdout') stdout += chunk; else stderr += chunk;
      };
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', take('stdout')); child.stderr.on('data', take('stderr'));
      child.stdin.on('error', () => {}); child.stdin.end(task);
      function finish(code, error) {
        if (finished) return; finished = true;
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        const parsed = completion(stdout, tool);
        resolve({ status: reason || (error || code !== 0 || parsed.agentError || !parsed.report ? 'failed' : 'completed'),
          exitCode: Number.isInteger(code) ? code : null, report: parsed.report,
          detail: error ? 'The agent executable could not be started.' : reason ? `Agent execution stopped: ${reason.replaceAll('_', ' ')}.` : (code !== 0 || parsed.agentError) ? 'The coding agent reported a failure. Check its login, credits and configuration.' : !parsed.report ? 'The coding agent returned no completion report.' : 'Plan generated; independent verification has not run.',
          stderr, verification: 'not_evaluated' });
      }
      child.once('error', error => finish(null, error)); child.once('close', code => finish(code));
      if (signal?.aborted) abort();
    });
  } finally { fs.rmSync(taskDir, { recursive: true, force: true }); }
}
