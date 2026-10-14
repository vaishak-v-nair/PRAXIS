// One local Review owner. No optional desktop dependencies are loaded here.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

const SCHEMA = 'praxis.review-service.v1';
const OWNER_SCHEMA = 'praxis.review-owner.v1';
const ACTIVE = new Set(['scanning', 'analyzing', 'planning_fix', 'fixing', 'verifying']);
const hex = count => randomBytes(count).toString('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
// The app's identity must survive marketing/title copy changes. Keep the old
// title for already-built clients, while new builds emit a stable head marker.
export function isReviewSurface(html) {
  if (typeof html !== 'string') return false;
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
  const marker = /<meta\b(?=[^>]*\bname=["']praxis-review-surface["'])(?=[^>]*\bcontent=["']workbench-v1["'])[^>]*>/i;
  return marker.test(head) || /<title>PRAXIS[^<]*Project Review<\/title>/i.test(html);
}
const exists = file => { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; return true; } };

function noLink(target) {
  if (exists(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Review service state cannot be a symbolic link. Existing files were preserved.');
}

/** Protect only the dedicated service directory, never a user's project. */
export async function protectServiceDirectory(directory, { platform = process.platform } = {}) {
  if (!path.isAbsolute(directory) || path.parse(directory).root === directory) throw new Error('Review service requires an absolute dedicated data folder.');
  noLink(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (platform === 'win32') {
    const identity = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
    const sid = identity.stdout?.match(/S-1-5-\d+(?:-\d+)+/)?.[0];
    if (identity.status !== 0 || !sid) throw new Error('Could not identify the Windows user to protect local Review credentials.');
    // /reset clears explicit grants; /inheritance:r removes inherited grants.
    for (const args of [[directory, '/reset'], [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '/grant:r', '*S-1-5-18:(OI)(CI)F']]) {
      const result = spawnSync('icacls.exe', args, { encoding: 'utf8', windowsHide: true });
      if (result.status !== 0) throw new Error('Could not restrict the local Review service directory to this user. No service was started.');
    }
  } else fs.chmodSync(directory, 0o700);
}

function record(file, limit = 16384) {
  noLink(file);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > limit) throw new Error('Review service descriptor is too large or is not a file.');
  if (process.platform !== 'win32' && (stat.mode & 0o077)) throw new Error('Review service descriptor is not private to its owner.');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('Invalid Review service descriptor. Existing files were preserved.'); }
}

export function readServiceDescriptor(file) {
  const value = record(file);
  let origin;
  try { origin = new URL(value.origin); } catch { throw new Error('Invalid Review service endpoint.'); }
  if (value.schema !== SCHEMA || !/^[a-f0-9]{32}$/.test(value.instanceId || '') || !/^[a-f0-9]{64}$/.test(value.nonce || '') || !/^[a-f0-9]{64}$/.test(value.token || '') ||
      !Number.isSafeInteger(value.pid) || value.pid < 1 || typeof value.version !== 'string' || value.version.length > 80 || typeof value.runtimeId !== 'string' || value.runtimeId.length > 256 ||
      !Number.isFinite(Date.parse(value.startedAt)) || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.pathname !== '/' || origin.username || origin.password || origin.search || origin.hash) {
    throw new Error('Invalid or unrecognized Review service descriptor. Existing files were preserved.');
  }
  return value;
}

function proof(descriptor, challenge) {
  return createHmac('sha256', Buffer.from(descriptor.token, 'hex')).update(`${SCHEMA}\n${descriptor.instanceId}\n${descriptor.nonce}\n${challenge}`).digest('hex');
}

/** A listener is PRAXIS only after a private-capability challenge succeeds. */
export async function authenticateService(descriptor, { fetchImpl = fetch, timeout = 3000 } = {}) {
  const challenge = hex(16);
  try {
    const response = await fetchImpl(`${descriptor.origin}/__praxis/handshake`, { method: 'POST', headers: { authorization: `Bearer ${descriptor.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ challenge }), signal: AbortSignal.timeout(timeout), redirect: 'error' });
    const result = await response.json();
    if (!response.ok || result.schema !== SCHEMA || result.instanceId !== descriptor.instanceId || !same(result.proof, proof(descriptor, challenge))) throw new Error();
    return result;
  } catch { throw new Error('Review service authentication failed. The listener was not trusted or changed.'); }
}

async function control(descriptor, action, body = {}) {
  const response = await fetch(`${descriptor.origin}/__praxis/client/${action}`, { method: 'POST', headers: { authorization: `Bearer ${descriptor.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000), redirect: 'error' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Review service request failed.');
  return result;
}

function attached(descriptor) {
  return { owned: false, origin: descriptor.origin, instanceId: descriptor.instanceId,
    browserUrl: async (target = '/') => (await control(descriptor, 'browser', { target })).url,
    status: () => control(descriptor, 'status'),
    stop: async () => { throw new Error('Only the service owner can stop this Review instance.'); } };
}

function ownerIdentity(file) {
  const value = record(file, 4096);
  if (value.schema !== OWNER_SCHEMA || !Number.isSafeInteger(value.pid) || value.pid <= 0 || !/^[a-f0-9]{64}$/.test(value.nonce || '') || !Number.isFinite(Date.parse(value.createdAt)) ||
      (value.childPids && (!Array.isArray(value.childPids) || value.childPids.some(pid => !Number.isSafeInteger(pid) || pid <= 0)))) throw new Error('Invalid Review service ownership. Existing files were preserved.');
  return value;
}

function atomic(file, value) {
  noLink(file);
  const temporary = `${file}.${hex(8)}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, file);
}

async function freePort(preferred, excluded) {
  const attempt = port => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => { const number = server.address().port; server.close(error => error ? reject(error) : resolve(number)); });
  });
  if (!excluded.has(preferred)) {
    try { const result = await attempt(preferred); excluded.add(result); return result; }
    catch (error) { if (!['EADDRINUSE', 'EACCES'].includes(error.code)) throw error; }
  }
  for (let index = 0; index < 8; index++) { const number = await attempt(0); if (!excluded.has(number)) { excluded.add(number); return number; } }
  throw new Error('No local Review port was available. Other listeners were preserved.');
}

function json(res, status, data) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(data)); }
async function body(req, maximum = 4096) {
  const buffers = []; let size = 0;
  for await (const buffer of req) { size += buffer.length; if (size > maximum) throw new Error('Request too large.'); buffers.push(buffer); }
  return JSON.parse(Buffer.concat(buffers).toString('utf8'));
}
async function boundedJson(response, maximum = 262144) {
  if (!response.ok) throw new Error('Project status is unavailable. Refresh the local Review service.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > maximum) throw new Error('Project status exceeded its bounded response size.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const safeTarget = target => typeof target === 'string' && target.length <= 8192 && target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/__praxis') && !/[\r\n\\]/.test(target);
const bootstrapHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Opening PRAXIS</title><style>body{background:#111519;color:#e2e8f0;font:16px system-ui;padding:48px;max-width:640px;margin:auto}h1{font-size:24px}p{line-height:1.6}</style><h1>Opening your local PRAXIS workspace</h1><p id="state">Checking this private session…</p><script>const ticket=location.hash.slice(1);history.replaceState(null,'','/__praxis/bootstrap');fetch('/__praxis/bootstrap',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticket})}).then(async response=>{if(!response.ok)throw Error();const result=await response.json();location.replace(result.target)}).catch(()=>{document.getElementById('state').textContent='This opening link has expired or was already used. Open PRAXIS again from the desktop app or CLI.'})</script></html>`;

function proxy(req, res, origin, token) {
  const headers = { ...req.headers, host: new URL(origin).host };
  delete headers.cookie; delete headers.authorization;
  delete headers['x-praxis-instance']; delete headers['x-forwarded-host']; delete headers['x-forwarded-proto'];
  if (token) { headers.authorization = `Bearer ${token}`; if (headers.origin) headers.origin = origin; }
  const forward = http.request(new URL(req.url, origin), { method: req.method, headers }, response => {
    const outgoing = { ...response.headers }; delete outgoing['set-cookie'];
    res.writeHead(response.statusCode || 502, outgoing); response.pipe(res);
  });
  forward.once('error', () => { if (!res.headersSent) json(res, 503, { error: 'The local Review service is unavailable. Existing evidence was preserved.' }); else res.destroy(); });
  req.once('aborted', () => forward.destroy()); res.once('close', () => { if (!res.writableEnded) forward.destroy(); }); req.pipe(forward);
}

/**
 * start({backendPort,uiPort,token,instanceId,signal}) must start the EXISTING
 * engine with PRAXIS_REVIEW_SERVICE_TOKEN/INSTANCE and return {stop,childPids}.
 * The lease is acquired before backend startup/recovery touches shared jobs.
 * Browser links are one-use tickets; reusable capabilities never enter a URL.
 */
export async function acquireReviewService({ dataRoot, version, runtimeId, start, ports = {}, activeJobs, startupTimeout = 90000, attachTimeout = 15000, signal } = {}) {
  if (!path.isAbsolute(dataRoot || '') || path.parse(dataRoot).root === dataRoot || typeof start !== 'function' || typeof version !== 'string' || typeof runtimeId !== 'string' || !runtimeId || runtimeId.length > 256) throw new Error('Invalid Review service configuration.');
  noLink(dataRoot);
  const root = path.join(dataRoot, '.praxis-service'), lease = path.join(root, 'owner'), identityFile = path.join(lease, 'identity.json'), descriptorFile = path.join(root, 'endpoint.json');
  await protectServiceDirectory(root);
  const nonce = hex(32), createdAt = new Date().toISOString(), deadline = Date.now() + attachTimeout;
  let own = false;
  while (!own) {
    signal?.throwIfAborted(); noLink(lease);
    try { fs.mkdirSync(lease, { mode: 0o700 }); fs.writeFileSync(identityFile, JSON.stringify({ schema: OWNER_SCHEMA, pid: process.pid, nonce, createdAt }), { flag: 'wx', mode: 0o600 }); own = true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (exists(identityFile)) {
        const previous = ownerIdentity(identityFile);
        if (!alive(previous.pid)) {
          if (previous.childPids?.some(alive)) throw new Error('The Review owner stopped while a child service is still running. Existing services were not terminated; inspect the recorded owner before restarting.');
          const old = exists(descriptorFile) ? readServiceDescriptor(descriptorFile) : null;
          if (old && (old.nonce !== previous.nonce || old.pid !== previous.pid)) throw new Error('Stale Review ownership and endpoint descriptor disagree. Existing files were preserved.');
          // Rename the same checked lease out of the acquisition path. Never
          // delete arbitrary state from a malformed or live ownership record.
          if (ownerIdentity(identityFile).nonce !== previous.nonce) continue;
          const retired = path.join(root, `retired-${hex(12)}`);
          try { fs.renameSync(lease, retired); } catch (renameError) { if (['ENOENT', 'EEXIST', 'EPERM'].includes(renameError.code)) { await pause(30); continue; } throw renameError; }
          if (old && exists(descriptorFile) && readServiceDescriptor(descriptorFile).nonce === previous.nonce) fs.unlinkSync(descriptorFile);
          fs.rmSync(retired, { recursive: true }); continue;
        }
        if (exists(descriptorFile)) {
          const descriptor = readServiceDescriptor(descriptorFile);
          if (descriptor.nonce !== previous.nonce || descriptor.pid !== previous.pid) throw new Error('Review ownership and endpoint descriptor disagree. Existing services were preserved.');
          await authenticateService(descriptor);
          if (descriptor.version !== version || descriptor.runtimeId !== runtimeId) throw new Error('A different runtime already owns these Review data. Close it explicitly before starting this version.');
          return attached(descriptor);
        }
      }
      if (Date.now() >= deadline) throw new Error('Another Review owner is starting or its ownership is unavailable. No duplicate backend was started.');
      await pause(50);
    }
  }
  const instanceId = hex(16), token = hex(32), controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason); signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Review services did not become ready in time.')), startupTimeout); timer.unref();
  let services, gateway, descriptor, stopped = false, runtimeEnded = false, shutdown;
  const tickets = new Map(), sessions = new Map();
  const cleanOwned = () => {
    if (exists(descriptorFile) && readServiceDescriptor(descriptorFile).nonce === nonce) fs.unlinkSync(descriptorFile);
    if (exists(identityFile) && ownerIdentity(identityFile).nonce === nonce) { fs.unlinkSync(identityFile); fs.rmdirSync(lease); }
  };
  let status;
  const stop = async ({ force = false } = {}) => {
    if (shutdown) return shutdown;
    if (!force && (await status()).activeJobs) throw new Error('An active review is still running. Confirm Quit and interrupt reviews, or close the window to keep working in the background.');
    if (shutdown) return shutdown;
    shutdown = (async () => {
      stopped = true; controller.abort(); clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      if (gateway) { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); }
      await services?.stop?.(); cleanOwned(); tickets.clear(); sessions.clear();
    })();
    return shutdown;
  };
  try {
    // Managed clients reach the services through the private gateway, so they
    // do not need the fixed development ports. Ephemeral defaults avoid two
    // independent owners racing to bind 9123/3000 after the free-port probe.
    const excluded = new Set(), backendPort = await freePort(ports.backend ?? 0, excluded), uiPort = await freePort(ports.ui ?? 0, excluded);
    const backendOrigin = `http://127.0.0.1:${backendPort}`, uiOrigin = `http://127.0.0.1:${uiPort}`;
    services = await start({ backendPort, uiPort, token, instanceId, signal: controller.signal });
    if (services?.closed) services.closed.then(() => { runtimeEnded = true; if (!stopped) stop({ force: true }).catch(() => {}); });
    if (services?.childPids?.length) atomic(identityFile, { schema: OWNER_SCHEMA, pid: process.pid, nonce, createdAt, childPids: services.childPids });
    if (typeof services?.stop !== 'function') throw new Error('Review runtime did not provide an owned shutdown lifecycle.');
    let ready = false;
    while (!ready) {
      controller.signal.throwIfAborted();
      if (runtimeEnded) throw new Error('An owned Review process stopped before the interface became ready.');
      try {
        const requestSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(1500)]);
        const [api, ui] = await Promise.all([fetch(`${backendOrigin}/api/health`, { headers: { authorization: `Bearer ${token}` }, signal: requestSignal, redirect: 'error' }), fetch(uiOrigin, { signal: requestSignal, redirect: 'error' })]);
        const health = await api.json(), html = await ui.text();
        ready = api.ok && ui.ok && health.status === 'ok' &&
          health.service_instance === instanceId && isReviewSurface(html);
      } catch { controller.signal.throwIfAborted(); }
      if (!ready) await pause(50);
    }
    status = async () => {
      let count;
      if (activeJobs) count = await activeJobs();
      else {
        const response = await fetch(`${backendOrigin}/api/jobs`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000), redirect: 'error' });
        if (!response.ok) throw new Error('Cannot determine active Review work. Confirm explicit interruption before quitting.');
        const result = await response.json();
        const jobs = Array.isArray(result) ? result : result.jobs;
        if (!Array.isArray(jobs)) throw new Error('Review activity was unavailable. No idle state was assumed.');
        count = jobs.filter(job => ACTIVE.has(job.status)).length;
      }
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Review activity was unavailable. No idle state was assumed.');
      return { schema: SCHEMA, instanceId, version, runtimeId, activeJobs: count, state: 'ready' };
    };
    const browserUrl = async (target = '/') => {
      if (!safeTarget(target)) throw new Error('Invalid local Review navigation target.');
      for (const [id, value] of tickets) if (value.expires < Date.now()) tickets.delete(id);
      if (tickets.size >= 64) throw new Error('Too many pending Review opening links. Retry after a minute.');
      const ticket = hex(32); tickets.set(ticket, { target, expires: Date.now() + 60000 });
      return `${descriptor.origin}/__praxis/bootstrap#${ticket}`;
    };
    const cookieName = `praxis_${instanceId.slice(0, 12)}`;
    gateway = http.createServer(async (req, res) => {
      try {
        const expectedHost = new URL(descriptor.origin).host;
        if (req.headers.host !== expectedHost || !req.url?.startsWith('/') || req.url.startsWith('//') || /[\r\n\\]/.test(req.url)) return json(res, 403, { error: 'Untrusted local Review request.' });
        const endpoint = req.url.split('?')[0];
        const isControl = endpoint === '/__praxis/handshake' || endpoint.startsWith('/__praxis/client/');
        if (isControl) {
          if (req.method !== 'POST' || !same(req.headers.authorization || '', `Bearer ${token}`)) return json(res, 401, { error: 'Review service authentication is required.' });
          if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Use application/json.' });
          const input = await body(req);
          if (endpoint === '/__praxis/handshake') {
            if (!/^[a-f0-9]{32}$/.test(input.challenge || '')) return json(res, 400, { error: 'Invalid service challenge.' });
            return json(res, 200, { schema: SCHEMA, instanceId, proof: proof(descriptor, input.challenge) });
          }
          if (endpoint === '/__praxis/client/browser') return json(res, 200, { url: await browserUrl(input.target || '/') });
          if (endpoint === '/__praxis/client/status') return json(res, 200, await status());
          if (endpoint === '/__praxis/client/projects' || endpoint === '/__praxis/client/project-status') {
            const single = endpoint.endsWith('/project-status');
            if (single && (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(input.project_id || '') || input.previous_revision !== undefined && (!Number.isSafeInteger(input.previous_revision) || input.previous_revision < 0))) return json(res, 400, { error: 'Invalid project status request.' });
            const target = single ? `/api/projects/${encodeURIComponent(input.project_id)}/status${input.previous_revision === undefined ? '' : `?previous_revision=${input.previous_revision}`}` : '/api/projects';
            const result = await boundedJson(await fetch(backendOrigin + target, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000), redirect: 'error' }));
            if (!single) {
              if (!Array.isArray(result)) return json(res, 503, { error: 'Project list is unavailable.' });
              const keys = ['schema_version', 'id', 'revision', 'source_kind', 'name', 'created_at', 'updated_at', 'latest_job_id', 'latest_snapshot_id'];
              return json(res, 200, result.map(project => Object.fromEntries(keys.filter(key => Object.hasOwn(project, key)).map(key => [key, project[key]]))));
            }
            const keys = ['schema_version', 'instance_id', 'project_id', 'job_id', 'snapshot_id', 'project_revision', 'job_revision', 'phase', 'freshness', 'source_freshness', 'source_available', 'checks', 'findings_count', 'readiness', 'model_spend', 'model_budget', 'revision', 'emitted_at'];
            if (result.schema_version !== 1 || result.project_id !== input.project_id || result.instance_id !== instanceId) return json(res, 503, { error: 'Project status does not match this Review instance.' });
            return json(res, 200, Object.fromEntries(keys.filter(key => Object.hasOwn(result, key)).map(key => [key, result[key]])));
          }
          return json(res, 404, { error: 'Unknown service action.' });
        }
        if (endpoint === '/__praxis/bootstrap' && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'", 'x-frame-options': 'DENY' }); return res.end(bootstrapHtml);
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          if (req.headers.origin && req.headers.origin !== descriptor.origin) return json(res, 403, { error: 'Untrusted origin.' });
          if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Use application/json.' });
        }
        if (endpoint === '/__praxis/bootstrap' && req.method === 'POST') {
          const input = await body(req), ticket = tickets.get(input.ticket);
          tickets.delete(input.ticket);
          if (!ticket || ticket.expires < Date.now()) return json(res, 401, { error: 'This Review opening link expired or was already used.' });
          for (const [id, expires] of sessions) if (expires < Date.now()) sessions.delete(id);
          if (sessions.size >= 256) return json(res, 429, { error: 'Too many Review sessions.' });
          const session = hex(32); sessions.set(session, Date.now() + 12 * 60 * 60 * 1000);
          res.setHeader('set-cookie', `${cookieName}=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200`);
          return json(res, 200, { target: ticket.target });
        }
        const cookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
        if (!cookie || !sessions.has(cookie) || sessions.get(cookie) < Date.now()) return json(res, 401, { error: 'Open PRAXIS from the desktop app or CLI to create a private local session.' });
        if (endpoint.startsWith('/__praxis')) return json(res, 404, { error: 'Unknown service action.' });
        proxy(req, res, endpoint.startsWith('/api/') ? backendOrigin : uiOrigin, endpoint.startsWith('/api/') ? token : undefined);
      } catch (error) { if (!res.headersSent) json(res, 400, { error: error.message.includes('active') || error.message.includes('activity') ? error.message : 'The local Review request could not be completed.' }); else res.destroy(); }
    });
    gateway.requestTimeout = 120000; gateway.headersTimeout = 15000;
    const gatewayPort = await freePort(ports.gateway || 0, excluded);
    await new Promise((resolve, reject) => { gateway.once('error', reject); gateway.listen(gatewayPort, '127.0.0.1', resolve); });
    descriptor = { schema: SCHEMA, instanceId, nonce, token, origin: `http://127.0.0.1:${gateway.address().port}`, pid: process.pid, version, runtimeId, startedAt: createdAt };
    atomic(descriptorFile, descriptor); clearTimeout(timer);
    await authenticateService(descriptor);
    return { owned: true, origin: descriptor.origin, instanceId, browserUrl, status, stop };
  } catch (error) {
    try { await stop({ force: true }); } catch { /* Preserve failed ownership rather than imply a clean shutdown. */ }
    throw new Error(error.message || 'Review services did not become ready.');
  }
}
