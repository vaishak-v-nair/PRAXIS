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
import { sage, rose, amber, blue, grey, bold, dim, chip, rule, wrap, claimRow, g, CONTENT, COL, CHIP_W } from '../ui.js';

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

/**
 * One claim, on the grid: state word in its own fixed column, the claim wrapped
 * beside it, the judge's reasoning as a caption underneath.
 *
 * The state word is never shortened and never moves. Someone scanning only that
 * column sees the shape of the judging — how much held, how much the record
 * simply could not answer — before reading a word of the claims.
 */
export function renderClaim(c) {
  return claimRow(c.verdict, c.claim, c.reasoning, verdictColor(c.verdict))
    .map((l) => g(l))
    .join('\n');
}

/** Headlines share one width so the two judgings are the same shape on screen
 *  and the eye compares the COLOUR, which is the arc. CLAIMS_FAILED is longest. */
export const HEADLINE_W = 13;

/** Outcome colour for a headline. The two judgings must be comparable at a
 *  glance — rose then amber is the whole arc, visible before any reading. */
export function headlineTone(headline) {
  if (headline === 'CLAIMS_FAILED') return 'rose';
  if (headline === 'VERIFIED') return 'sage';
  if (headline === 'PARTIAL') return 'amber';
  return 'grey';
}

/** A recorded judging, always labelled as recorded — never mistakable for now. */
export function renderVerdictBlock(v, label) {
  const out = [];
  out.push(g(rule(label)));
  out.push(g(amber('recorded verdict') + grey(' · from the original run, on another machine')));
  out.push('');
  out.push(g(chip(v.headline, headlineTone(v.headline), HEADLINE_W) + '  ' + grey(summariseTotals(v.totals))));
  out.push('');
  // One blank line between entries. Without it a four-claim block is a wall,
  // and the state column — the thing a reader is meant to scan first — stops
  // reading as a column at all.
  for (const c of v.claims) {
    out.push(renderClaim(c));
    out.push('');
  }
  out.pop();
  return out.join('\n');
}

/** "15 unverifiable · 9 true · 2 false" — biggest bucket first, lowercase so the
 *  state words in the column below stay the loudest thing on the screen. */
export function summariseTotals(totals = {}) {
  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${k.toLowerCase().replace(/_/g, ' ')}`)
    .join(' · ');
}

/**
 * Play the recorded session.
 * @returns {Promise<void>}
 */
export async function playBeats(corpus, { speed = 0.55, write = (s) => process.stdout.write(s + '\n') } = {}) {
  const claimsByKey = new Map((corpus.verdicts.before.claims || []).map((c) => [c.key, c]));
  const AGENT_INDENT = COL;
  let prevKind = null;

  for (const beat of corpus.beats) {
    // Vertical rhythm, derived rather than authored. Blank lines used to be
    // sprinkled by feel inside each case, which is how prose ends up welded to
    // the data block above it. One rule instead: a change of element type is a
    // change of thought, and gets air.
    if (prevKind && prevKind !== beat.kind) write('');
    prevKind = beat.kind;

    switch (beat.kind) {
      case 'narration':
        // Prose wraps. Before this it ran to whatever length the sentence
        // happened to be, which is unreadable at phone width — and the launch
        // asset is a GIF people scroll past on phones.
        for (const l of wrap(beat.text, CONTENT)) write(g(grey(l)));
        break;
      case 'agent': {
        // Verbatim from the sealed receipt — the demo never writes the agent's lines.
        const claim = claimsByKey.get(beat.claimRef);
        const text = claim ? claim.claim : beat.text;
        const lines = wrap(text, CONTENT - AGENT_INDENT);
        write(g(blue('agent'.padEnd(AGENT_INDENT)) + lines[0]));
        for (const l of lines.slice(1)) write(g(' '.repeat(AGENT_INDENT) + l));
        break;
      }
      case 'seal':
        write(g(chip('sealed', 'sage', CHIP_W) + '  ' + grey(beat.text)));
        break;
      case 'rule':
        // The turn of the story. It gets the loudest treatment in the replay
        // because it is the thing the replay exists to teach.
        write(g(rule('iron rule 5')));
        for (const l of wrap(beat.text.replace(/^Iron rule 5:\s*/i, ''), CONTENT)) write(g(bold(amber(l))));
        break;
      case 'verdict':
        write(renderVerdictBlock(corpus.verdicts[beat.which], beat.which === 'before' ? 'judged' : 're-judged'));
        break;
      default:
        for (const l of wrap(beat.text, CONTENT)) write(g(l));
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
