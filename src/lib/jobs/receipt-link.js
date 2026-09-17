// The fusion: every finished job leaves a sealed receipt — automatically.
//
// The claude adapter runs with --output-format json, so a job's out.log is a
// run envelope carrying `session_id` (which names the transcript file) and
// `result` (the agent's final words). From those two facts this module:
//   1. parses the envelope (tolerantly — other adapters emit plain text),
//   2. finds the job's own transcript,
//   3. seals an evidence-only receipt for it (zero model calls, the same
//      silent invariant as the Stop hook),
// and hands the deck what it needs: the receipt id + verdict per job.
// "done" and "proven" become different columns — which is the whole point.

import fs from 'node:fs';
import path from 'node:path';
import { transcriptDir } from '../transcript.js';
import { recordReceipt } from '../receipt/record.js';

/**
 * Pull the agent's final text + session id out of a job's raw output.
 * Tolerant by design: a claude JSON envelope parses fully; anything else
 * (fixture agents, future adapters, plain text) falls back to raw text.
 */
export function parseEnvelope(raw) {
  const text = String(raw || '').trim();
  if (!text) return { resultText: '', sessionId: null };

  // 1. Claude single-envelope format (or candidate lines with session_id)
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const candidates = [text, ...lines.slice().reverse().filter((l) => l.startsWith('{'))];
  for (const c of candidates) {
    try {
      const env = JSON.parse(c);
      if (env && typeof env === 'object' && typeof env.session_id === 'string') {
        return {
          resultText: typeof env.result === 'string' ? env.result : text,
          sessionId: env.session_id,
          costUsd: typeof env.total_cost_usd === 'number' ? env.total_cost_usd : null,
        };
      }
    } catch {
      /* not valid JSON single object — continue */
    }
  }

  // 2. Stream-based / JSONL format (Codex or multi-event streams)
  let threadId = null;
  let agentMessageText = null;
  let lastErrorText = null;
  let costUsd = null;

  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    try {
      const ev = JSON.parse(line);
      if (!ev || typeof ev !== 'object') continue;

      if (typeof ev.thread_id === 'string') threadId = ev.thread_id;
      if (typeof ev.session_id === 'string') threadId = ev.session_id;

      if (ev.type === 'item.completed' && ev.item) {
        const item = ev.item;
        if (item.type === 'agent_message' || item.type === 'message') {
          if (typeof item.text === 'string' && item.text.trim()) {
            agentMessageText = item.text.trim();
          } else if (typeof item.content === 'string' && item.content.trim()) {
            agentMessageText = item.content.trim();
          }
        } else if (item.type === 'error' && typeof item.message === 'string') {
          lastErrorText = item.message.trim();
        }
      }

      if (ev.type === 'error' && typeof ev.message === 'string') {
        lastErrorText = ev.message.trim();
      } else if (ev.type === 'turn.failed' && ev.error && typeof ev.error.message === 'string') {
        lastErrorText = ev.error.message.trim();
      }

      if (typeof ev.total_cost_usd === 'number') costUsd = ev.total_cost_usd;
      if (typeof ev.cost_usd === 'number') costUsd = ev.cost_usd;
    } catch {
      /* skip line */
    }
  }

  if (threadId) {
    return {
      resultText: agentMessageText || lastErrorText || text,
      sessionId: threadId,
      costUsd,
    };
  }

  // 3. Fallback: single JSON object without session_id (e.g. { result: 'foo' })
  for (const c of candidates) {
    try {
      const env = JSON.parse(c);
      if (env && typeof env === 'object') {
        return {
          resultText: typeof env.result === 'string' ? env.result : text,
          sessionId: null,
          costUsd: typeof env.total_cost_usd === 'number' ? env.total_cost_usd : null,
        };
      }
    } catch {
      /* keep trying */
    }
  }

  return { resultText: text, sessionId: null };
}

/**
 * Seal the receipt for a finished job. Never throws — a receipt failure must
 * never break job completion. Returns whatever it could establish.
 * @param {string} praxisDir  the project's .praxis
 * @param {{id:string,cwd:string}} meta  the job meta
 * @param {{home?:string}} opts  injectable for tests (PRAXIS_TRANSCRIPT_HOME)
 */
export async function sealJobReceipt(praxisDir, meta, { home } = {}) {
  try {
    const raw = fs.readFileSync(path.join(praxisDir, 'jobs', meta.id, 'out.log'), 'utf8');
    const parsed = parseEnvelope(raw);
    const out = { resultTail: parsed.resultText.slice(-1200), sessionId: parsed.sessionId, costUsd: parsed.costUsd ?? null };
    if (!parsed.sessionId) return out; // non-claude/codex adapter or malformed — no transcript to receipt

    const tHome = home || process.env.PRAXIS_TRANSCRIPT_HOME || undefined;
    const tFile = path.join(transcriptDir(meta.cwd || process.cwd(), tHome), parsed.sessionId + '.jsonl');
    const transcriptText = fs.existsSync(tFile) ? fs.readFileSync(tFile, 'utf8') : raw;

    const r = await recordReceipt(
      path.join(praxisDir, 'receipts'),
      { text: transcriptText, sessionId: parsed.sessionId },
      { project: path.basename(meta.cwd || ''), now: new Date().toISOString(), verify: false },
    );
    return { ...out, receiptId: r.id, receiptVerdict: r.verdict };
  } catch {
    return {};
  }
}
