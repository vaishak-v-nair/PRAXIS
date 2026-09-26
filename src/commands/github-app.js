import fs from 'node:fs';
import http from 'node:http';
import { GitHubApi } from '../lib/verify/github-api.js';
import { parsePullRequestDelivery, processPullRequest, verifyWebhookSignature } from '../lib/verify/github-app.js';
import { verifyGitHubPullRequest } from '../lib/verify/github-worker.js';

const MAX_BODY = 2 * 1024 * 1024;

function privateKey(env) {
  if (env.PRAXIS_GITHUB_PRIVATE_KEY_FILE) return fs.readFileSync(env.PRAXIS_GITHUB_PRIVATE_KEY_FILE, 'utf8');
  if (env.PRAXIS_GITHUB_PRIVATE_KEY) return env.PRAXIS_GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n');
  throw new Error('Set PRAXIS_GITHUB_PRIVATE_KEY_FILE or PRAXIS_GITHUB_PRIVATE_KEY.');
}

function configuration(env) {
  const appId = env.PRAXIS_GITHUB_APP_ID, secret = env.PRAXIS_GITHUB_WEBHOOK_SECRET;
  if (!appId) throw new Error('Set PRAXIS_GITHUB_APP_ID.');
  if (!secret || secret.length < 16) throw new Error('Set a strong PRAXIS_GITHUB_WEBHOOK_SECRET.');
  return { appId, secret, privateKey: privateKey(env) };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    request.on('data', (chunk) => { size += chunk.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Webhook body is too large.'), { status: 413 })); request.destroy(); } else chunks.push(chunk); });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function header(request, name) {
  const value = request.headers[name]; return Array.isArray(value) ? value[0] : String(value || '');
}

export function createGitHubAppServer({ env = process.env, fetchImpl = globalThis.fetch, verify = verifyGitHubPullRequest, logger = console } = {}) {
  const config = configuration(env), inFlight = new Set();
  return http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"ok":true}\n'); return; }
    if (request.method !== 'POST' || request.url !== '/webhooks/github') { response.writeHead(404); response.end('not found\n'); return; }
    try {
      const rawBody = await readBody(request);
      if (!verifyWebhookSignature(rawBody, config.secret, header(request, 'x-hub-signature-256'))) { response.writeHead(401); response.end('invalid signature\n'); return; }
      const deliveryId = header(request, 'x-github-delivery');
      if (!/^[A-Za-z0-9-]{8,100}$/.test(deliveryId)) { response.writeHead(400); response.end('invalid delivery id\n'); return; }
      const delivery = parsePullRequestDelivery(header(request, 'x-github-event'), rawBody);
      if (delivery.kind === 'ping') { response.writeHead(200); response.end('pong\n'); return; }
      if (delivery.kind === 'ignored') { response.writeHead(202); response.end('ignored\n'); return; }
      if (inFlight.has(deliveryId)) { response.writeHead(202); response.end('duplicate\n'); return; }
      inFlight.add(deliveryId);
      response.writeHead(202); response.end('accepted\n');
      void (async () => {
        const unauthenticated = new GitHubApi({ fetchImpl, apiUrl: env.PRAXIS_GITHUB_API_URL });
        const token = await unauthenticated.installationToken({ appId: config.appId, privateKey: config.privateKey, installationId: delivery.installationId, repositoryId: delivery.repositoryId });
        const api = new GitHubApi({ token, fetchImpl, apiUrl: env.PRAXIS_GITHUB_API_URL });
        await processPullRequest(delivery, { api, deliveryId, verifyPullRequest: (input) => verify(input, { token, env, stateRoot: env.PRAXIS_GITHUB_STATE_DIR }) });
      })().catch((error) => logger.error(`PRAXIS GitHub delivery ${deliveryId} failed: ${error.message}`)).finally(() => inFlight.delete(deliveryId));
    } catch (error) {
      if (!response.headersSent) { response.writeHead(error.status || 400); response.end('invalid webhook\n'); }
    }
  });
}

export async function githubAppCommand(argv = [], env = process.env) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('\n  praxis github-app [--check] [--port <number>]\n\n  Runs the PRAXIS Verify GitHub App webhook service.\n'); return 0;
  }
  try {
    configuration(env);
    if (argv.includes('--check')) { console.log('PRAXIS GitHub App configuration is valid.'); return 0; }
    const at = argv.indexOf('--port'), port = Number(at >= 0 ? argv[at + 1] : env.PORT || 8787);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
    const server = createGitHubAppServer({ env });
    server.listen(port, '127.0.0.1', () => console.log(`PRAXIS GitHub App listening on http://127.0.0.1:${port}/webhooks/github`));
    return 0;
  } catch (error) { console.error(`\n  PRAXIS GitHub App: ${error.message}\n`); return 1; }
}
