// Trusted Workbench bridge; no executable, environment or mode from a request.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const shared = existsSync(path.join(here, 'agent/execute.js')) ? path.join(here, 'agent') : path.resolve(here, '../../../src/lib/jobs');
const { discoverAgents } = await import(pathToFileURL(path.join(shared, 'discovery.js')));
const { executeAgent } = await import(pathToFileURL(path.join(shared, 'execute.js')));
const abort = new AbortController();
process.on('SIGTERM', () => abort.abort()); process.on('SIGINT', () => abort.abort());
try {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 131072) throw new Error('Oversized agent input.'); }
  const body = JSON.parse(input);
  const result = body.operation === 'discover' ? { agents: discoverAgents().map(agent => ({ ...agent, authentication: 'not_checked' })) }
    : body.operation === 'plan' ? await executeAgent({ tool: body.tool, task: body.task, cwd: body.cwd, timeoutMs: body.timeoutMs, signal: abort.signal })
    : { status: 'failed', detail: 'Unsupported agent operation.' };
  process.stdout.write(JSON.stringify(result));
} catch { process.stdout.write(JSON.stringify({ status: 'failed', detail: 'The coding-agent bridge is unavailable or misconfigured. No result was inferred.' })); process.exitCode = 1; }
