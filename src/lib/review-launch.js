import net from 'node:net';
import { spawn } from 'node:child_process';

export const REVIEW_URL = 'http://127.0.0.1:3000';
export const REVIEW_HEALTH = 'http://127.0.0.1:9123/api/health';

export async function availablePorts(ports = [3000, 9123]) {
  await Promise.all(ports.map(port => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Local port ${port} is already in use. Stop the other PRAXIS session or service first; it was not changed.`)));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(resolve));
  })));
}

export async function waitForReview({ fetchImpl = fetch, signal, timeout = 90000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    try {
      const requestSignal = AbortSignal.any([AbortSignal.timeout(Math.min(3000, Math.max(1, deadline - Date.now()))), ...(signal ? [signal] : [])]);
      const [api, ui] = await Promise.all([
        fetchImpl(REVIEW_HEALTH, { signal: requestSignal }),
        fetchImpl(REVIEW_URL, { signal: requestSignal }),
      ]);
      if (api.ok && ui.ok) {
        const health = await api.json(), html = await ui.text();
        if (health.status === 'ok' && health.providers && /<title>PRAXIS[^<]*Project Review<\/title>/i.test(html)) return;
      }
    } catch { if (signal?.aborted) signal.throwIfAborted(); }
    await sleep(Math.min(500, Math.max(0, deadline - Date.now())));
  }
  throw new Error('The local interface and API did not become ready in time. No successful startup was reported. Check the service logs above.');
}

export function openReview({ platform = process.platform, spawnImpl = spawn, log = console.log } = {}) {
  const command = platform === 'win32' ? 'rundll32.exe' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', REVIEW_URL] : [REVIEW_URL];
  try {
    const child = spawnImpl(command, args, { stdio: 'ignore', windowsHide: true, shell: false });
    child.once('error', () => log(`Open ${REVIEW_URL} in your browser.`));
    child.once('close', code => { if (code) log(`Open ${REVIEW_URL} in your browser.`); });
    child.unref();
  } catch { log(`Open ${REVIEW_URL} in your browser.`); }
}
