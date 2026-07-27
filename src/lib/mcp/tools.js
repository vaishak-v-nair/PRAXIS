// The PRAXIS tool registry — each command's intelligence, re-exposed as an MCP
// tool the host model invokes on its own. This is the layer that lets commands
// disappear: the logic lives in lib/, and these thin handlers are what the
// platform calls. A human never types `praxis receipt`; the model calls
// praxis_receipt when it's about to claim it finished.
//
// Handlers take an injectable context (cwd, a transcript reader, a judge fn) so
// the whole registry is unit-testable without a real session or a real model.

import fs from 'node:fs';
import path from 'node:path';
import { projectPaths } from '../paths.js';
import { transcriptDir, newestTranscript } from '../transcript.js';
import { verify, receiptFile, readEntries } from '../receipt/store.js';
import { recordReceipt } from '../receipt/record.js';
import { judge as realJudge } from '../receipt/judge.js';

// summarizeVerdicts lives with the shared record path now; re-exported here so
// existing consumers/tests that import it from the tool registry still resolve.
export { summarizeVerdicts } from '../receipt/record.js';

function defaultReadTranscript(cwd) {
  const file = newestTranscript(transcriptDir(cwd));
  if (!file) return null;
  try {
    return { file, text: fs.readFileSync(file, 'utf8'), sessionId: path.basename(file, '.jsonl') };
  } catch {
    return null;
  }
}

/**
 * Build the tool list bound to a context.
 * @param {{cwd?:string, readTranscript?:Function, judge?:Function, now?:string}} ctx
 */
export function buildTools(ctx = {}) {
  const cwd = ctx.cwd || process.cwd();
  const p = projectPaths(cwd);
  const project = path.basename(cwd);
  const readTranscript = ctx.readTranscript || (() => defaultReadTranscript(cwd));
  const judge = ctx.judge || realJudge;
  const now = () => ctx.now || new Date().toISOString();

  return [
    {
      name: 'praxis_receipt',
      description:
        "Check whether this coding session's agent actually did what it claimed. Records the deterministic evidence (commands run, files touched, tests invoked) and, with verify=true, has an adversarial judge rule each of the agent's claims TRUE / FALSE / UNVERIFIABLE against that evidence. Call this before telling the user you finished.",
      inputSchema: {
        type: 'object',
        properties: {
          verify: { type: 'boolean', description: 'Run the LLM judge to rule the claims (costs a model call). Default false = record evidence only.' },
        },
      },
      handler: async (args) => {
        const tr = readTranscript();
        if (!tr) return 'No Claude Code session transcript found for this project yet — nothing to receipt.';
        const wantVerify = !!(args && args.verify);
        const r = await recordReceipt(p.receiptsDir, tr, { project, now: now(), verify: wantVerify, judge });

        if (!wantVerify) {
          return `Receipt ${r.id} recorded (evidence only): ${r.evidence.counts.commands} commands across [${r.evidence.channels_harvested.join(', ')}], ${r.evidence.counts.files_edited} files touched. Pass verify=true to have the judge rule the agent's claims.`;
        }
        if (!r.verified) {
          const why = /ENOENT/i.test(String(r.judgeError))
            ? 'the judge needs the claude CLI, which was not found'
            : /timeout/i.test(String(r.judgeError))
              ? 'the judge timed out'
              : String(r.judgeError);
          return `Receipt ${r.id}: evidence recorded, but no verdict — ${why}. Claims left UNVERIFIED, nothing fabricated.`;
        }
        const sum = r.summary;
        const failLine = sum.failed.length ? ` FAILED: ${sum.failed.map((c) => `"${c}"`).join('; ')}.` : '';
        return `Receipt ${r.id} — ${sum.headline}. ${sum.true}/${sum.total} claims TRUE, ${sum.false} FALSE, ${sum.unverifiable} UNVERIFIABLE.${failLine}`;
      },
    },

    {
      name: 'praxis_verify',
      description: "Verify a receipt's signature and hash chain by id — proves it has not been altered since it was sealed.",
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Receipt id, e.g. r-1a2b3c4d' } }, required: ['id'] },
      handler: async (args) => {
        const id = args && args.id;
        if (!id) return 'Provide a receipt id.';
        const res = verify(p.receiptsDir, id);
        if (!res.ok) return `Receipt ${id}: verification FAILED (${res.reason || 'unknown'})${res.at != null ? ' at line ' + res.at : ''}.`;
        if (!res.finalized) return `Receipt ${id}: chain intact, not yet sealed.`;
        return `Receipt ${id}: chain intact and signature valid — untampered.`;
      },
    },

    {
      name: 'praxis_receipts',
      description: 'List the receipts recorded for this project, newest first, with each one\'s verdict.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        let files;
        try {
          files = fs.readdirSync(p.receiptsDir).filter((f) => f.endsWith('.jsonl'));
        } catch {
          return 'No receipts yet.';
        }
        if (!files.length) return 'No receipts yet.';
        const rows = files
          .map((f) => {
            const entries = readEntries(path.join(p.receiptsDir, f));
            const openE = entries.find((e) => e.t === 'open');
            const finalE = entries.find((e) => e.t === 'final');
            return { id: f.replace(/\.jsonl$/, ''), verdict: finalE ? finalE.verdict : 'OPEN', at: (openE && openE.openedAt) || '' };
          })
          .sort((a, b) => String(b.at).localeCompare(String(a.at)));
        return rows.map((r) => `${r.id}  ${r.verdict}  ${r.at}`).join('\n');
      },
    },

    {
      name: 'praxis_recall',
      description: 'What PRAXIS remembers about this project — the durable memory carried across sessions.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        try {
          const mem = fs.readFileSync(p.memoryFile, 'utf8').trim();
          return mem ? mem.slice(0, 6000) : 'Project memory is empty.';
        } catch {
          return 'No PRAXIS memory for this project yet.';
        }
      },
    },
  ];
}

// re-export for the CLI entry
export { receiptFile };
