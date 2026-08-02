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
import { loadReceipt, listReceipts, renderTerminal, renderHtml, renderMarkdown } from '../lib/receipt/render.js';
import { verifyFile } from '../lib/receipt/store.js';
import { wantsJson, emitJson } from '../lib/jsonout.js';
import { bold, grey, sage, rose, amber, dim } from '../lib/ui.js';

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

/** Why a receipt failed, said in words rather than an enum. */
export function explainVerifyFailure(res) {
  switch (res.reason) {
    case 'not-found':
      return 'no file at that path.';
    case 'not-a-file':
      return 'that path is a directory, not a receipt.';
    case 'unreadable':
      return 'the file could not be read (' + (res.detail || 'unknown reason') + ').';
    case 'empty-or-unparseable':
    case 'empty-or-missing':
      return 'this is not a receipt — no readable entries in it.';
    case 'chain-broken':
      return `the chain breaks at line ${res.at + 1}. A line was edited, inserted or removed after this receipt was sealed.`;
    case 'no-signature':
      return 'the final line carries no signature.';
    case 'signature-invalid':
      return 'the signature does not match the record. It was re-signed, or the sealed hash was altered.';
    case 'signature-unverifiable-here':
      return 'this receipt predates portable keys and was sealed on another machine, so its signature cannot be checked here. The chain itself is intact.';
    case 'signature-error':
      return 'the signature block is malformed.';
    default:
      return 'it did not verify.';
  }
}

/**
 * `praxis receipt verify <file>` — the offline proof (D56).
 *
 * Deliberately NOT the same thing as `--verify`, which spends a model call to
 * judge the current session. This one recomputes hashes and checks a signature:
 * no network, no model, nothing spent. It is what a stranger runs on evidence
 * they were handed, and what a CI check runs on a pull request.
 */
export function verifyReceiptFile(argv = []) {
  const target = argv.find((a) => !a.startsWith('--'));
  const json = wantsJson(argv);

  if (!target && json) {
    emitJson({ ok: false, error: 'missing-file', hint: 'receipt verify <file> checks one receipt offline — give it a path' });
    return 2;
  }

  if (target && json) {
    // The CI surface. verifyFile's result is already the whole story; `status`
    // names the three outcomes so a gate can switch on one word, and the human
    // explanation rides along for the log line a failing gate prints.
    const res = verifyFile(path.resolve(target));
    emitJson({
      ok: res.ok,
      file: path.resolve(target),
      status: !res.ok ? 'NOT_VERIFIED' : res.finalized ? 'VERIFIED' : 'INTACT_UNSEALED',
      ...res,
      explanation: res.ok ? null : explainVerifyFailure(res),
    });
    return res.ok ? 0 : 1;
  }

  // The disambiguation moment. Someone typing `receipt verify` with no file is
  // usually reaching for one of two different things — say so in two lines
  // rather than erroring at them.
  if (!target) {
    console.log('\n  ' + bold('Two different checks, two different costs:') + '\n');
    console.log(
      '  ' + bold('praxis receipt verify <file>') + grey('   offline proof — recomputes the chain and signature.'),
    );
    console.log('  ' + ' '.repeat(28) + grey('   No network, no model call, free.'));
    console.log('  ' + bold('praxis receipt --verify') + grey('        judges THIS session — one real model call, ~minutes.'));
    console.log('\n  ' + dim('Give the first one a path: praxis receipt verify .praxis/receipts/r-1a2b3c4d.jsonl') + '\n');
    return 2;
  }

  const res = verifyFile(path.resolve(target));
  const name = path.basename(target);
  console.log('\n  ' + bold('PRAXIS receipt verify') + '  ' + grey(name) + '\n');

  if (!res.ok) {
    console.log('  ' + rose('✗ ' + (res.chain ? 'signature' : 'chain')) + '  ' + explainVerifyFailure(res));
    console.log('\n  ' + rose('NOT VERIFIED') + grey(' — do not treat this file as evidence.') + '\n');
    return 1;
  }

  console.log('  ' + sage('✓') + ' chain intact     ' + grey(`${res.entries} entries, every hash recomputes`));
  if (res.finalized) {
    console.log(
      '  ' +
        sage('✓') +
        ' signature valid  ' +
        grey(`key ${res.keyFingerprint || '?'}${res.embeddedKey ? '' : ' (this machine)'}`),
    );
  } else {
    console.log('  ' + amber('·') + ' not sealed       ' + grey('this receipt has no final line yet'));
  }

  const prov = res.provenance;
  if (String(prov).startsWith('demo')) {
    console.log('  ' + amber('·') + ' provenance       ' + amber(`${prov} — produced by the demo, not real work`));
  } else {
    console.log('  ' + sage('·') + ' provenance       ' + grey('real work'));
  }

  console.log(
    '\n  ' +
      (res.finalized ? sage('VERIFIED') : amber('INTACT, UNSEALED')) +
      grey(' — this record was not altered after it was sealed.'),
  );
  console.log('  ' + dim('Checked offline: no network, no model call, nothing spent.'));
  console.log(
    '  ' + dim('It proves the record is unaltered — not who sealed it. Identity is a signature you choose to trust.') + '\n',
  );
  return 0;
}

export async function receipt(argv = []) {
  const p = projectPaths();
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const positional = argv.filter((a) => !a.startsWith('--'));
  const json = wantsJson(argv);

  // `receipt verify <file>` — the free, offline sibling of `--verify`
  if (positional[0] === 'verify') {
    process.exitCode = verifyReceiptFile(argv.slice(argv.indexOf('verify') + 1));
    return;
  }

  // --list — every receipt in this project
  if (flags.has('--list')) {
    const rows = listReceipts(p.receiptsDir);
    if (json) {
      // An empty list is a normal answer, not an error — ok mirrors the exit.
      emitJson({ ok: true, receipts: rows });
      return;
    }
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
      if (json) emitJson({ ok: true, judged: false, reason: 'no-active-session', receipt: null });
      else console.log('\n  ' + grey('No active session transcript to verify.') + '\n');
      return;
    }
    const tr = { text: fs.readFileSync(file, 'utf8'), sessionId: path.basename(file, '.jsonl') };
    if (!json) console.log('\n  ' + grey('Running the judge on this session… (up to ~4 minutes — one real model call)'));
    const r = await recordReceipt(p.receiptsDir, tr, {
      project: path.basename(p.root),
      now: new Date().toISOString(),
      verify: true,
      // a human explicitly asked and is waiting: give the judge real room.
      // (Hook and tool paths keep the tighter default.)
      judge: (input) => realJudge(input, { timeoutMs: 240000 }),
    });
    if (json) {
      emitJson({ ok: true, judged: !!r.verified, judgeError: r.verified ? null : r.judgeError || null, receipt: loadReceipt(p.receiptsDir, r.id, r.version) });
      return;
    }
    console.log(renderTerminal(loadReceipt(p.receiptsDir, r.id, r.version), { suggestVerify: false }));
    if (!r.verified) console.log('  ' + grey('No verdict: ' + humanizeJudgeError(r.judgeError)) + '\n');
    // the sibling, named where someone has just paid for the other one
    console.log(
      '  ' + dim('Proving the file itself is unaltered costs nothing: praxis receipt verify <file>') + '\n',
    );
    return;
  }

  // resolve which receipt to show: explicit id, else newest
  let id = positional[0];
  let version;
  if (!id) {
    const rows = listReceipts(p.receiptsDir);
    if (!rows.length) {
      if (json) {
        // "There is no newest receipt" is an answer, not a failure.
        emitJson({ ok: true, receipt: null });
        return;
      }
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
    // Asking for a receipt BY NAME and not finding it is a failure, and the
    // exit code says so now — a script checking $? deserves the same signal
    // a human gets from the colour rose.
    if (json) emitJson({ ok: false, error: 'no-such-receipt', id });
    else console.log('\n  ' + rose('No receipt ') + id + '.\n');
    process.exitCode = 1;
    return;
  }

  if (json && !flags.has('--html') && !flags.has('--open') && !flags.has('--md')) {
    // loadReceipt already carries the chain check; a reader gets the receipt
    // AND whether to believe it in one document.
    emitJson({ ok: true, receipt: loaded });
    return;
  }

  // --md — GitHub-flavored markdown on stdout, meant to be pasted or piped
  // straight into a PR body (`praxis receipt --md >> body.md`).
  if (flags.has('--md')) {
    const md = renderMarkdown(loaded);
    if (json) {
      emitJson({ ok: true, markdown: md });
      return;
    }
    console.log(md);
    return;
  }

  // --html / --open — write the self-contained card. Default lands in the
  // PROJECT ROOT, visible and attachable — not buried in gitignored .praxis/
  // (the whole point of the card is to travel: PRs, chats, "is it done?" asks).
  if (flags.has('--html') || flags.has('--open')) {
    const out = positional[1] || path.join(p.root, `praxis-receipt-${loaded.id}${loaded.version > 1 ? '.v' + loaded.version : ''}.html`);
    fs.writeFileSync(out, renderHtml(loaded));
    if (json) {
      emitJson({ ok: true, wrote: out, receipt: { id: loaded.id, version: loaded.version } });
      return;
    }
    console.log('\n  ' + sage('✓') + ' receipt card written  ' + grey(out));
    console.log('  ' + grey('Self-contained file — attach it to the PR, or send it to whoever asked "is it done?"') + '\n');
    return;
  }

  console.log(renderTerminal(loaded));
}
