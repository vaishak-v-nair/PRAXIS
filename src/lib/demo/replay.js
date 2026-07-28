// The replay: what a stranger sees in the first sixty seconds.
//
// It plays a recorded real session, then seals a REAL receipt on this machine
// from that session's evidence, then verifies it offline. Two things are true
// at once and both are said out loud:
//
//   - the VERDICTS on screen are a recording. They were produced by a judge on
//     another day, on another machine. We show them because they are the story.
//   - the RECEIPT is not a recording. It is sealed here, now, with this
//     machine's key, and it carries no verdict at all — because no judge ran
//     here, and a verdict is never invented.
//
// That distinction is the product in miniature. Blur it and the demo becomes
// the first thing PRAXIS lies about.

import fs from 'node:fs';
import { open, append, finalize, verifyFile, receiptFile } from '../receipt/store.js';
import { sage, rose, amber, blue, grey, bold, dim } from '../ui.js';

/** Pacing. 1 = as recorded; 0 = instant (tests, CI). */
export function speedFactor(env = process.env) {
  const raw = env.PRAXIS_DEMO_SPEED;
  if (raw === undefined || raw === '') return 0.55; // brisk: the whole arc lands well under the 60s promise
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0.55;
}

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function verdictColor(v) {
  if (v === 'TRUE') return sage;
  if (v === 'FALSE') return rose;
  if (v === 'UNVERIFIABLE') return amber;
  return grey;
}

/** One claim, rendered as the judge ruled it — verdict word first, colour second. */
export function renderClaim(c, indent = '     ') {
  const paint = verdictColor(c.verdict);
  const lines = [`${indent}${paint(c.verdict.padEnd(13))} ${c.claim}`];
  if (c.reasoning) lines.push(`${indent}              ${dim(c.reasoning)}`);
  return lines.join('\n');
}

/** A recorded judging, always labelled as recorded — never mistakable for now. */
export function renderVerdictBlock(v, label) {
  const out = [];
  out.push('');
  out.push(`     ${bold(label)}  ${amber('· recorded verdict, from the original run')}`);
  out.push(`     ${grey('headline:')} ${bold(v.headline)}   ${grey(summariseTotals(v.totals))}`);
  out.push('');
  for (const c of v.claims) out.push(renderClaim(c));
  return out.join('\n');
}

export function summariseTotals(totals = {}) {
  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${k}`)
    .join(' · ');
}

/**
 * Play the recorded session.
 * @returns {Promise<void>}
 */
export async function playBeats(corpus, { speed = 0.55, write = (s) => process.stdout.write(s + '\n') } = {}) {
  const claimsByKey = new Map((corpus.verdicts.before.claims || []).map((c) => [c.key, c]));

  for (const beat of corpus.beats) {
    switch (beat.kind) {
      case 'narration':
        write('  ' + grey(beat.text));
        break;
      case 'agent': {
        // Verbatim from the sealed receipt — the demo never writes the agent's lines.
        const claim = claimsByKey.get(beat.claimRef);
        write('  ' + blue('agent') + '  ' + (claim ? claim.claim : beat.text));
        break;
      }
      case 'seal':
        write('  ' + sage('◆ sealed') + '  ' + grey(beat.text));
        break;
      case 'rule':
        write('');
        write('  ' + bold(amber(beat.text)));
        break;
      case 'verdict':
        write(renderVerdictBlock(corpus.verdicts[beat.which], beat.which === 'before' ? 'JUDGED' : 'RE-JUDGED'));
        break;
      default:
        write('  ' + beat.text);
    }
    await sleep(Math.round((beat.holdMs || 900) * speed));
  }
}

/**
 * Seal a real receipt from the recording's evidence, on THIS machine.
 *
 * provenance is sealed inside the signed record, so this receipt can never be
 * counted as evidence of real work — not by the index, not by the PR check,
 * not by anyone reading it later.
 *
 * The verdict is UNVERIFIED, deliberately. No judge ran here; writing the
 * recorded verdict into a receipt sealed on the user's machine would be
 * fabricating a ruling, which is the one thing this product may never do.
 */
export function sealDemoReceipt(receiptsDir, corpus, { sessionId, now }) {
  fs.mkdirSync(receiptsDir, { recursive: true });
  const o = open(receiptsDir, {
    sessionId,
    project: 'praxis-demo',
    now,
    provenance: 'demo-replay',
  });
  append(
    receiptsDir,
    o.id,
    {
      channels_harvested: corpus.evidence.channels_harvested || [],
      completeness_note: corpus.evidence.completeness_note,
      commands_run: corpus.evidence.commands_run || [],
      files_edited: corpus.evidence.files_edited || [],
      counts: corpus.evidence.counts || {},
      replay_of: corpus.source,
    },
    o.version,
  );
  finalize(receiptsDir, o.id, { verdict: 'UNVERIFIED', claims: [], now }, o.version);
  return { id: o.id, version: o.version, file: receiptFile(receiptsDir, o.id, o.version) };
}

/** Seal, then immediately prove it — offline, on the spot. */
export function sealAndVerify(receiptsDir, corpus, { sessionId, now }) {
  const sealed = sealDemoReceipt(receiptsDir, corpus, { sessionId, now });
  return { ...sealed, verification: verifyFile(sealed.file) };
}
