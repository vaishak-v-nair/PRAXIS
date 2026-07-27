// The Deck server — Mission Control in the browser, without leaving the
// machine. Node's own http, zero dependencies, and two hard rules:
//
//   1. 127.0.0.1 ONLY. The deck never binds an outside interface — this is a
//      window onto your machine, not a service.
//   2. Every state-changing request carries the per-launch token the page was
//      born with, so a random local website can't drive your fleet by firing
//      requests at localhost (the classic drive-by-localhost attack).
//
// The server is a thin skin: jobs/approve/gov/receipts all call the same lib
// functions the CLI does. Remove the CLI and the deck still works; remove the
// deck and nothing else notices. The platform rule, again.

import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { listJobs } from '../jobs/store.js';
import { readMeta, updateMeta, jobStatus } from '../jobs/store.js';
import { loadReceipt, renderHtml } from '../receipt/render.js';
import { govern } from '../gov.js';
import { readMemory } from '../memory.js';
import { extractBrief } from '../handoff.js';
import { deckPage } from './page.js';

/** Everything the page needs, in one JSON — pure read, safe to poll. */
export function buildState(praxisDir, memoryFile) {
  let memoryBrief = '';
  try {
    memoryBrief = extractBrief(readMemory(memoryFile)) || '';
  } catch {
    /* young project */
  }
  const jobs = listJobs(praxisDir).map((j) => ({
    id: j.id,
    task: j.task || '',
    status: j.status,
    receiptId: j.receiptId || null,
    receiptVerdict: j.receiptVerdict || null,
    resultTail: j.status === 'draft' ? j.resultTail || '' : undefined,
    goal: j.goal || null,
  }));
  return { jobs, memoryBrief };
}

/**
 * Create (but do not listen) the deck server bound to a project.
 * Injectable deps keep it fully testable without a real model or browser.
 */
export function createDeckServer({ cwd, praxisDir, memoryFile, project, startJob, executionTask, governFn = govern, token = crypto.randomBytes(16).toString('hex') }) {
  const governor = { busy: false, lastNote: '', lastError: '' };

  function authed(req, url) {
    return req.headers['x-praxis-token'] === token || url.searchParams.get('t') === token;
  }
  function json(res, code, obj) {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(deckPage({ token, project }));
      return;
    }
    if (!authed(req, url)) return json(res, 403, { error: 'bad token' });

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return json(res, 200, { ...buildState(praxisDir, memoryFile), governor: { ...governor }, project });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/receipt/')) {
      const id = url.pathname.split('/')[2];
      const loaded = loadReceipt(path.join(praxisDir, 'receipts'), id);
      res.writeHead(loaded ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderHtml(loaded));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', (d) => (body += d));
      await new Promise((r) => req.on('end', r));
      let data = {};
      try {
        data = JSON.parse(body || '{}');
      } catch {
        return json(res, 400, { error: 'bad json' });
      }

      if (url.pathname === '/api/gov') {
        const goal = String(data.goal || '').trim();
        if (!goal) return json(res, 400, { error: 'empty goal' });
        if (governor.busy) return json(res, 409, { error: 'the governor is already thinking' });
        governor.busy = true;
        governor.lastNote = '';
        governor.lastError = '';
        // async: the page polls /api/state; the browser never waits a minute
        (async () => {
          try {
            const g = await governFn(goal, { briefing: buildState(praxisDir, memoryFile).memoryBrief, deckState: '' });
            if (!g.ok) {
              governor.lastError = g.reason || 'governor failed';
              return;
            }
            if (!g.jobs.length) {
              governor.lastNote = g.note || 'the goal needs no background work';
              return;
            }
            for (const job of g.jobs) await startJob({ task: job.task, mode: 'plan', goal, cwd });
            governor.lastNote = g.note || `queued ${g.jobs.length} safe draft${g.jobs.length === 1 ? '' : 's'}`;
          } catch (e) {
            governor.lastError = (e && e.message) || 'governor crashed';
          } finally {
            governor.busy = false;
          }
        })();
        return json(res, 202, { ok: true });
      }

      if (url.pathname === '/api/approve') {
        const id = String(data.id || '');
        const meta = readMeta(praxisDir, id);
        if (!meta) return json(res, 404, { error: 'no such job' });
        if (data.deny) {
          if (meta.approval !== 'pending') return json(res, 409, { error: 'nothing pending' });
          updateMeta(praxisDir, id, { approval: 'denied' });
          return json(res, 200, { ok: true, denied: true });
        }
        if (jobStatus(meta) !== 'draft') return json(res, 409, { error: 'only a waiting draft can be approved' });
        const planTail = (meta.resultTail || '').slice(-2400);
        const r = await startJob({ task: executionTask(meta, planTail), tool: meta.tool, mode: 'acceptEdits', approvedFrom: id, cwd });
        if (r.error) return json(res, 500, { error: r.error });
        updateMeta(praxisDir, id, { approval: 'approved', approvedTo: r.id });
        return json(res, 200, { ok: true, twin: r.id });
      }

      return json(res, 404, { error: 'unknown endpoint' });
    }

    json(res, 404, { error: 'not found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      try {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":"internal"}');
      } catch {
        /* connection gone */
      }
    });
  });
  return { server, token };
}

/** Listen on 127.0.0.1 starting at `port`, walking up if taken. */
export function listenLocal(server, port = 4517, tries = 10) {
  return new Promise((resolve, reject) => {
    const attempt = (p, left) => {
      const onErr = (e) => {
        if (e && e.code === 'EADDRINUSE' && left > 0) attempt(p + 1, left - 1);
        else reject(e);
      };
      server.once('error', onErr);
      server.listen(p, '127.0.0.1', () => {
        server.removeListener('error', onErr); // stale handlers must not stack
        resolve(p);
      });
    };
    attempt(port, tries);
  });
}
