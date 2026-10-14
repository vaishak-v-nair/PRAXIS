import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { acquireReviewService } from './review-service.mjs';
import { startReviewRuntime } from './review-service-runtime.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const dataRoot = process.env.PRAXIS_DESKTOP_DATA_ROOT;
if (!dataRoot || !path.isAbsolute(dataRoot)) throw new Error('The desktop did not supply a private local data directory.');
const runtimeDirectory = relative => {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Invalid bundled runtime manifest.');
  const result = path.resolve(root, relative);
  if (!result.startsWith(root + path.sep)) throw new Error('Invalid bundled runtime path.');
  return result;
};
const write = value => process.stdout.write(JSON.stringify(value) + '\n');
const cancellation = new AbortController();
let service, runtime, quitting = false;
const localEnv = { ...process.env, PRAXIS_WORKBENCH_DATA_DIR: dataRoot, PRAXIS_WORKBENCH_ENV_FILE: path.join(path.dirname(dataRoot), 'provider.env') };
// No developer-machine .env, npm cache, or checkout history is bundled/imported.
async function start({ backendPort, uiPort, token, instanceId, signal }) {
  const options = { backendPort, uiPort, token, instanceId, signal, env: localEnv };
  if (manifest.mode === 'source') {
    if (!path.isAbsolute(manifest.appPath)) throw new Error('Invalid development Workbench path.');
    options.root = manifest.appPath;
  } else if (manifest.mode === 'standalone') {
    options.root = root; options.backendEntry = runtimeDirectory(manifest.backend); options.frontendEntry = runtimeDirectory(manifest.frontend);
  } else throw new Error('Unsupported bundled Review runtime.');
  runtime = startReviewRuntime(options);
  return runtime;
}

async function quit(force = false) {
  if (quitting) return;
  if (service?.owned) await service.stop({ force });
  quitting = true;
}
for (const name of ['SIGINT', 'SIGTERM']) process.on(name, () => quit(true).then(() => process.exit(0), () => process.exit(1)));

try {
  service = await acquireReviewService({ dataRoot, version: manifest.version, runtimeId: manifest.runtimeId, start, signal: cancellation.signal });
  write({ event: 'ready', origin: service.origin, url: await service.browserUrl(), owned: service.owned });
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    let request;
    try {
      if (line.length > 16384) throw new Error('Desktop request too large.');
      request = JSON.parse(line);
      if (!Number.isSafeInteger(request.id) || request.id < 1) throw new Error('Invalid desktop request.');
      let result;
      if (request.method === 'status') result = await service.status();
      else if (request.method === 'open') result = { url: await service.browserUrl(request.target || '/') };
      else if (request.method === 'quit') { await quit(request.force === true); result = { stopped: true }; }
      else throw new Error('Unsupported desktop lifecycle action.');
      write({ id: request.id, result });
      if (quitting) { input.close(); break; }
    } catch (error) { write({ id: request?.id || 0, error: error.message }); }
  }
  // Losing the native control pipe is a crash, not successful job completion.
  if (!quitting) await quit(true);
} catch (error) {
  write({ event: 'error', error: error.message });
  try { await runtime?.stop(); } catch { /* No success state. */ }
  process.exitCode = 1;
}
