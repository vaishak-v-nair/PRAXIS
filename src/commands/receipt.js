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
    console.log('\n  ' + grey('Running the judge on this session…'));
    const r = await recordReceipt(p.receiptsDir, tr, {
      project: path.basename(p.root),
      now: new Date().toISOString(),
      verify: true,
      judge: realJudge,
    });
    console.log(renderTerminal(loadReceipt(p.receiptsDir, r.id, r.version)));
    if (!r.verified) console.log('  ' + grey(`judge unavailable: ${r.judgeError} — evidence sealed, claims left honest.`) + '\n');
    return;
  }

  // resolve which receipt to show: explicit id, else newest
  let id = positional[0];
  let version;
  if (!id) {
    const rows = listReceipts(p.receiptsDir);
    if (!rows.length) {
      console.log(
        '\n  ' +
          grey('No receipts yet — they record automatically when a session ends.\n  End a Claude Code session, or run `praxis receipt --verify` now.') +
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

  // --html / --open — write the self-contained card
  if (flags.has('--html') || flags.has('--open')) {
    const out = positional[1] || path.join(p.receiptsDir, `${loaded.id}${loaded.version > 1 ? '.v' + loaded.version : ''}.html`);
    fs.writeFileSync(out, renderHtml(loaded));
    console.log('\n  ' + sage('✓') + ' receipt written  ' + grey(out) + '\n');
    return;
  }

  console.log(renderTerminal(loaded));
}
