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
  // the envelope is one JSON object; some runs prepend warnings — try the
  // whole thing first, then the last line that looks like JSON
  const candidates = [text, ...text.split('\n').reverse().filter((l) => l.trim().startsWith('{'))];
  for (const c of candidates) {
    try {
      const env = JSON.parse(c);
      if (env && typeof env === 'object') {
        return {
          resultText: typeof env.result === 'string' ? env.result : text,
          sessionId: typeof env.session_id === 'string' ? env.session_id : null,
          costUsd: typeof env.total_cost_usd === 'number' ? env.total_cost_usd : null,
        };
      }
    } catch {
      /* not JSON — keep trying */
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
    if (!parsed.sessionId) return out; // non-claude adapter or malformed — no transcript to receipt

    const tHome = home || process.env.PRAXIS_TRANSCRIPT_HOME || undefined;
    const tFile = path.join(transcriptDir(meta.cwd || process.cwd(), tHome), parsed.sessionId + '.jsonl');
    if (!fs.existsSync(tFile)) return out;

    const r = await recordReceipt(
      path.join(praxisDir, 'receipts'),
      { text: fs.readFileSync(tFile, 'utf8'), sessionId: parsed.sessionId },
      { project: path.basename(meta.cwd || ''), now: new Date().toISOString(), verify: false },
    );
    return { ...out, receiptId: r.id, receiptVerdict: r.verdict };
  } catch {
    return {};
  }
}
