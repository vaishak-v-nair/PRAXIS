// `praxis receipt` — look at the proof of what the AI did this session.
//
// Receipts record themselves silently when a session ends (the Stop hook). This
// command is how a human reads one back: the newest by default, any by id,
// --list for all, --verify to run the judge on the current session now, and
// --html to write a self-contained card you can forward.
//
// The intelligence is all in lib/ (record + render); this is a thin surface.

import fs from 'node:fs';
import path from 'node:path';
import { projectPaths } from '../lib/paths.js';
import { transcriptDir, newestTranscript } from '../lib/transcript.js';
import { recordReceipt } from '../lib/receipt/record.js';
import { judge as realJudge } from '../lib/receipt/judge.js';
import { loadReceipt, listReceipts, renderTerminal, renderHtml } from '../lib/receipt/render.js';
import { bold, grey, sage, rose } from '../lib/ui.js';

function tag(v) {
  if (v === 'VERIFIED') return sage('✓ VERIFIED   ');
  if (v === 'CLAIMS_FAILED') return rose('✗ FAILED     ');
  if (v === 'PARTIAL') return '~ PARTIAL    ';
  return grey('· ' + (v || 'UNVERIFIED').padEnd(10));
}

/** Judge failures reach humans in plain English — raw spawn errors are for logs. */
export function humanizeJudgeError(reason) {
  const r = String(reason || '');
  if (/ENOENT/i.test(r)) {
    return 'the judge needs the `claude` CLI, which was not found on this machine. Install Claude Code, or point PRAXIS_JUDGE_CMD at any model CLI.';
  }
  if (/timeout/i.test(r)) {
    return 'the judge ran out of time — a busy model or a very large session. The evidence is sealed; try again in a quieter moment.';
  }
  if (/spawn/i.test(r)) {
    return 'the judge command could not start (' + r + '). Check PRAXIS_JUDGE_CMD.';
  }
  return 'the judge did not return a usable ruling (' + r + '). The evidence is sealed; no verdict was invented.';
}

export async function receipt(argv = []) {
  const p = projectPaths();
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const positional = argv.filter((a) => !a.startsWith('--'));

  // --list — every receipt in this project
  if (flags.has('--list')) {
    const rows = listReceipts(p.receiptsDir);
    if (!rows.length) {
      console.log('\n  ' + grey('No receipts yet — they record automatically when a session ends.') + '\n');
      return;
    }
    console.log('\n  ' + bold('PRAXIS receipts') + '  ' + grey(`(${rows.length})`) + '\n');
    for (const r of rows) console.log('  ' + tag(r.verdict) + '  ' + r.label.padEnd(16) + '  ' + grey(r.openedAt || ''));
    console.log('');
    return;
  }

  // --verify — run the judge on the CURRENT session now (the opt-in paid path)
  if (flags.has('--verify')) {
    const file = newestTranscript(transcriptDir(p.root));
    if (!file) {
      console.log('\n  ' + grey('No active session transcript to verify.') + '\n');
      return;
    }
    const tr = { text: fs.readFileSync(file, 'utf8'), sessionId: path.basename(file, '.jsonl') };
    console.log('\n  ' + grey('Running the judge on this session… (up to ~4 minutes — one real model call)'));
    const r = await recordReceipt(p.receiptsDir, tr, {
      project: path.basename(p.root),
      now: new Date().toISOString(),
      verify: true,
      // a human explicitly asked and is waiting: give the judge real room.
      // (Hook and tool paths keep the tighter default.)
      judge: (input) => realJudge(input, { timeoutMs: 240000 }),
    });
    console.log(renderTerminal(loadReceipt(p.receiptsDir, r.id, r.version), { suggestVerify: false }));
    if (!r.verified) console.log('  ' + grey('No verdict: ' + humanizeJudgeError(r.judgeError)) + '\n');
    return;
  }

  // resolve which receipt to show: explicit id, else newest
  let id = positional[0];
  let version;
  if (!id) {
    const rows = listReceipts(p.receiptsDir);
    if (!rows.length) {
      // only point at --verify when there is actually a session to verify —
      // a brand-new project would just hit a dead end
      const hasSession = !!newestTranscript(transcriptDir(p.root));
      console.log(
        '\n  ' +
          grey(
            'No receipts yet — they record automatically when a session ends.' +
              (hasSession ? '\n  A session is active: `praxis receipt --verify` seals and judges it right now.' : '\n  Work with Claude Code here once, and the first receipt appears on its own.'),
          ) +
          '\n',
      );
      return;
    }
    id = rows[0].id;
    version = rows[0].version;
  }

  const loaded = loadReceipt(p.receiptsDir, id, version);
  if (!loaded) {
    console.log('\n  ' + rose('No receipt ') + id + '.\n');
    return;
  }

  // --html / --open — write the self-contained card. Default lands in the
  // PROJECT ROOT, visible and attachable — not buried in gitignored .praxis/
  // (the whole point of the card is to travel: PRs, chats, "is it done?" asks).
  if (flags.has('--html') || flags.has('--open')) {
    const out = positional[1] || path.join(p.root, `praxis-receipt-${loaded.id}${loaded.version > 1 ? '.v' + loaded.version : ''}.html`);
    fs.writeFileSync(out, renderHtml(loaded));
    console.log('\n  ' + sage('✓') + ' receipt card written  ' + grey(out));
    console.log('  ' + grey('Self-contained file — attach it to the PR, or send it to whoever asked "is it done?"') + '\n');
    return;
  }

  console.log(renderTerminal(loaded));
}
