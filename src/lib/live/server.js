import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLiveScenarioOrchestrated } from './orchestrator.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB_ROOT = path.join(ROOT, 'web', 'live');
const RECEIPT_VERIFY = path.join(ROOT, 'web', 'receipt', 'verify.js');
const live = (name) => path.join(WEB_ROOT, name);
const three = (name) => path.join(ROOT, 'node_modules', 'three', 'build', name);
const JS = 'text/javascript; charset=utf-8';
const ASSETS = Object.freeze({
  '/': { file: live('index.html'), type: 'text/html; charset=utf-8' },
  '/app.js': { file: live('app.js'), type: JS },
  '/engine-visual.js': { file: live('engine-visual.js'), type: JS, optional: true },
  '/graph.js': { file: live('graph.js'), type: JS },
  '/style.css': { file: live('style.css'), type: 'text/css; charset=utf-8' },
  '/receipt-verify.js': { file: RECEIPT_VERIFY, type: JS },
  '/three.module.js': { file: three('three.module.js'), type: JS, optional: true },
  '/three.core.js': { file: three('three.core.js'), type: JS, optional: true },
});

function securityHeaders(type) {
  return {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
  };
}

function sendJson(res, status, value) {
  res.writeHead(status, securityHeaders('application/json; charset=utf-8'));
  res.end(JSON.stringify(value));
}

async function readJson(req, limit = 4096) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Request body is not valid JSON.'), { status: 400 }); }
}

export function createLiveServer({ token = crypto.randomBytes(16).toString('hex'), stageDelayMs = 360, runner = runLiveScenarioOrchestrated } = {}) {
  let running = false;
  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const asset = req.method === 'GET' ? ASSETS[url.pathname] : null;
    if (asset) {
      if (asset.optional && !fs.existsSync(asset.file)) return sendJson(res, 404, { error: 'missing' });
      if (url.pathname === '/') {
        const page = fs.readFileSync(asset.file, 'utf8').replaceAll('__PRAXIS_LIVE_TOKEN__', token);
        res.writeHead(200, securityHeaders(asset.type)); res.end(page); return;
      }
      res.writeHead(200, securityHeaders(asset.type)); fs.createReadStream(asset.file).pipe(res); return;
    }

    if (req.method !== 'POST' || url.pathname !== '/api/run') return sendJson(res, 404, { error: 'not found' });
    if (req.headers['x-praxis-token'] !== token) return sendJson(res, 403, { error: 'bad token' });
    if (running) return sendJson(res, 409, { error: 'A PRAXIS Live run is already in progress.' });
    const body = await readJson(req);
    running = true;
    res.writeHead(200, {
      ...securityHeaders('application/x-ndjson; charset=utf-8'),
      'transfer-encoding': 'chunked',
    });
    const write = (event) => res.write(`${JSON.stringify(event)}\n`);
    try {
      await runner(String(body.scenario || ''), { onEvent: write, delayMs: stageDelayMs });
    } catch (error) {
      write({ type: 'error', message: error.message || 'The live verification failed.' });
    } finally {
      running = false;
      res.end();
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => sendJson(res, error.status || 500, { error: error.message || 'internal error' }));
  });
  return { server, token };
}

export function listenLiveLocal(server, port = 4527, tries = 10) {
  return new Promise((resolve, reject) => {
    const attempt = (candidate, left) => {
      const onError = (error) => {
        server.removeListener('listening', onListening);
        if (error?.code === 'EADDRINUSE' && left > 0) attempt(candidate + 1, left - 1);
        else reject(error);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve(server.address().port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(candidate, '127.0.0.1');
    };
    attempt(port, tries);
  });
}
