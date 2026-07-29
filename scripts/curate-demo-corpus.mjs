#!/usr/bin/env node
// Curate the demo replay corpus from real sealed receipts.
//
//   node scripts/curate-demo-corpus.mjs            # write src/demo/corpus.json
//   node scripts/curate-demo-corpus.mjs --dry-run  # print the scan, write nothing
//
// WHY THIS IS A SCRIPT AND NOT A ONE-OFF: the corpus is re-recorded on every
// minor release (a named item on the release checklist), so the curation has to
// be repeatable and reviewable rather than remembered.
//
// WHAT IT PRODUCES: only the events the replay plays back — never a raw
// transcript. Every claim and verdict below is copied VERBATIM out of a sealed
// receipt; nothing here is written for effect. The arc is real:
//
//   v3  the judge ruled an HONEST claim FALSE, because the command it named
//       appeared in the record — an attempt looks exactly like a success.
//   →   that miss produced iron rule 5: presence proves ATTEMPTED, never
//       SUCCEEDED.
//   v4  the same session, the same evidence, re-judged under the rule: the
//       accusation becomes an honest UNVERIFIABLE, and nothing is FALSE.
//
// This is the demo because it is the product catching its own failure, with
// both states sealed and independently checkable.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redact } from '../src/lib/redact.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECEIPTS = path.join(REPO, '.praxis', 'receipts');
const OUT = path.join(REPO, 'src', 'demo', 'corpus.json');
const SIZE_BUDGET = 300 * 1024; // D54

const BEFORE = 'r-bb94d673.v3.jsonl';
const AFTER = 'r-bb94d673.v4.jsonl';

// The claims the arc turns on. Paired explicitly, because the story IS the
// pairing: the same claim, the same evidence, ruled differently once the rule
// existed. Wording drifts between judgings (the judge re-extracts claims from
// prose), so each side gets its own matcher.
const ARC = [
  { key: 'publish', pivotal: true, before: /^npm publish blocked by permissions/i, after: /^npm publish blocked by permissions/i },
  { key: 'tests', before: /^117 tests green/i, after: /^117 tests green/i },
  { key: 'readme', before: /^README (rewritten|updated)/i, after: /^README (rewritten|updated)/i },
  { key: 'version', before: /^v0\.9\.2 version bump/i, after: /^v0\.9\.2 version bump/i },
];

/**
 * The factual backbone, asserted rather than assumed: the pivotal claim must
 * exist on both sides, must have been FALSE before, and must NOT be FALSE
 * after. If a future re-record breaks that, the story this demo tells is no
 * longer true and the build must stop.
 */
function assertArc(before, after) {
  const p = ARC.find((a) => a.pivotal);
  const b = before.claims.find((c) => p.before.test(c.claim));
  const a = after.claims.find((c) => p.after.test(c.claim));
  const fail = (why) => {
    console.error(`\nARC BROKEN: ${why}`);
    console.error('The demo claims a specific thing happened. Fix the corpus source or the story — never ship the mismatch.');
    process.exit(1);
  };
  if (!b) fail('the pivotal claim is missing from the BEFORE receipt');
  if (!a) fail('the pivotal claim is missing from the AFTER receipt');
  if (b.verdict !== 'FALSE') fail(`BEFORE verdict is ${b.verdict}, expected FALSE (the false accusation is the whole point)`);
  if (a.verdict === 'FALSE') fail('AFTER verdict is still FALSE — the rule did not fix it, so do not claim it did');
  console.log(`arc verified: "${b.claim.slice(0, 46)}…"  ${b.verdict} -> ${a.verdict}`);
}

function loadEntries(file) {
  return fs
    .readFileSync(path.join(RECEIPTS, file), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** Home directories and usernames are not evidence — they are the operator's address. */
function scrubPaths(value) {
  const home = os.homedir();
  const user = path.basename(home);
  const walk = (v) => {
    if (typeof v === 'string') {
      return v
        .split(home).join('~')
        .split(home.replace(/\\/g, '/')).join('~')
        .split(home.replace(/\\/g, '\\\\')).join('~')
        .replace(new RegExp(`([\\\\/])${user}([\\\\/])`, 'gi'), '$1<user>$2');
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(value);
}

/** Detector mode: report, never edit. The same patterns the export path scans for. */
export function scanForLeaks(text) {
  const findings = [];
  const patterns = [
    ['email address', /[\w.+-]+@[\w-]+\.[\w.]{2,}/g],
    ['bearer/API token', /\b(sk|pk|ghp|gho|ghs|npm)_[A-Za-z0-9]{16,}\b/g],
    ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./g],
    ['AWS key id', /\bAKIA[0-9A-Z]{16}\b/g],
    ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
    ['absolute home path', /[A-Za-z]:\\Users\\[^\\"\s]+/g],
    ['unix home path', /\/home\/[^/"\s]+/g],
    ['bare IP address', /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g],
    ['password-ish assignment', /\b(password|passwd|secret|token)\s*[:=]\s*\S{6,}/gi],
  ];
  for (const [label, re] of patterns) {
    const hits = [...String(text).matchAll(re)].map((m) => m[0]);
    if (hits.length) findings.push({ label, count: hits.length, samples: [...new Set(hits)].slice(0, 3) });
  }
  return findings;
}

function pickClaims(entries, side) {
  const fin = entries.find((e) => e.t === 'final');
  const picked = [];
  for (const arc of ARC) {
    const re = arc[side];
    if (!re) continue;
    const c = fin.claims.find((x) => re.test(String(x.claim)));
    if (c) {
      picked.push({
        key: arc.key,
        claim: c.claim,
        verdict: c.verdict,
        evidence_cited: c.evidence_cited || null,
        reasoning: c.reasoning || null,
      });
    }
  }
  return { headline: fin.verdict, claims: picked, totals: tally(fin.claims) };
}

function tally(claims) {
  return claims.reduce((m, c) => {
    m[c.verdict] = (m[c.verdict] || 0) + 1;
    return m;
  }, {});
}

/** The evidence the replay seals: the real commands behind the arc, verbatim. */
function pickEvidence(entries) {
  const ev = entries.filter((e) => e.t === 'evidence');
  const allCmds = ev.flatMap((e) => e.commands_run || []);
  const wanted = [/npm publish/, /npm test/, /git commit -m "docs\(receipts\)/, /git push origin main/, /git merge main/];
  const chosen = [];
  for (const re of wanted) {
    const hit = allCmds.find((c) => re.test(String(c.command)));
    if (hit && !chosen.some((c) => c.command === hit.command)) chosen.push(hit);
  }
  // Repo-relative, always. An absolute path tells a stranger about the
  // recorder's disk layout and nothing about the work.
  const files = [...new Set(ev.flatMap((e) => e.files_edited || []))]
    .filter((f) => /README\.md$|package\.json$|TODOS\.md$/.test(f))
    .map((f) => String(f).replace(/\\/g, '/').replace(/^.*?\/PRAXIS\//i, '').replace(/^[A-Za-z]:\//, ''))
    .slice(0, 6);
  return {
    channels_harvested: [...new Set(ev.flatMap((e) => e.channels_harvested || []))],
    completeness_note:
      'Curated excerpt of a real session for the demo. Absence of an action here means "not included in this excerpt", never "did not happen".',
    commands_run: chosen,
    files_edited: files,
    counts: { commands: chosen.length, files: files.length },
  };
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const before = loadEntries(BEFORE);
  const after = loadEntries(AFTER);
  const openBefore = before.find((e) => e.t === 'open');

  const corpus = scrubPaths({
    corpusVersion: 1,
    recordedAt: openBefore.openedAt,
    source: {
      project: 'praxis',
      receipts: [BEFORE.replace('.jsonl', ''), AFTER.replace('.jsonl', '')],
      note:
        'A real PRAXIS session from 2026-07-25, sealed twice: once before iron rule 5 existed and once after. ' +
        'Claims, verdicts and reasoning below are copied verbatim from those two sealed receipts.',
    },
    // The story, in the order the replay tells it. Text is narration; anything
    // quoted as a claim or verdict is verbatim from the receipts above.
    beats: [
      // No "replaying a real session" line here: the screen's own REPLAY header
      // already states the project and the date. Saying it twice is the kind of
      // duplication that reads as a tool talking to itself.
      { kind: 'narration', text: 'An agent finished a session and reported what it had done.', holdMs: 1400 },
      // Anything attributed to the agent is a VERBATIM claim from the sealed
      // receipt (claimRef), never a paraphrase written for pacing. If the demo
      // puts words in the agent's mouth, the demo is the thing lying.
      { kind: 'agent', claimRef: 'readme', holdMs: 1600 },
      { kind: 'agent', claimRef: 'publish', holdMs: 1800 },
      { kind: 'narration', text: 'The session ends. PRAXIS seals a receipt of what actually happened.', holdMs: 1400 },
      { kind: 'seal', text: 'chain intact · signature valid', holdMs: 1200 },
      { kind: 'narration', text: 'Then an independent judge rules each claim against that evidence.', holdMs: 1400 },
      { kind: 'verdict', which: 'before', holdMs: 2600 },
      { kind: 'narration', text: 'Except the agent was telling the truth. The publish WAS blocked.', holdMs: 1800 },
      { kind: 'narration', text: 'A denied command and a successful one look identical in the record.', holdMs: 1800 },
      { kind: 'rule', text: 'Iron rule 5: presence proves ATTEMPTED, never SUCCEEDED.', holdMs: 2000 },
      { kind: 'narration', text: 'Same session, same evidence, re-judged under the rule:', holdMs: 1400 },
      { kind: 'verdict', which: 'after', holdMs: 2600 },
      { kind: 'narration', text: 'The false accusation became an honest "I cannot tell". Nothing is FALSE.', holdMs: 1800 },
    ],
    evidence: pickEvidence(after),
    verdicts: { before: pickClaims(before, 'before'), after: pickClaims(after, 'after') },
  });

  assertArc(corpus.verdicts.before, corpus.verdicts.after);

  // Every claimRef must resolve, or a beat would render blank at demo time.
  for (const b of corpus.beats) {
    if (!b.claimRef) continue;
    const found = corpus.verdicts.before.claims.find((c) => c.key === b.claimRef);
    if (!found) {
      console.error(`\nBEAT BROKEN: no claim with key "${b.claimRef}" — the agent line would render empty.`);
      process.exit(1);
    }
  }

  const json = JSON.stringify(corpus, null, 2);

  // Redaction runs on the way out, and then we SCAN what came out.
  const redacted = redact(json);
  const changed = redacted !== json;
  const findings = scanForLeaks(redacted);

  console.log(`corpus: ${(Buffer.byteLength(redacted) / 1024).toFixed(1)}KB of ${SIZE_BUDGET / 1024}KB budget`);
  console.log(`beats: ${corpus.beats.length} · commands: ${corpus.evidence.commands_run.length} · files: ${corpus.evidence.files_edited.length}`);
  console.log(`claims replayed: ${corpus.verdicts.before.claims.length} before / ${corpus.verdicts.after.claims.length} after`);
  console.log(`headline: ${corpus.verdicts.before.headline} -> ${corpus.verdicts.after.headline}`);
  console.log(`redactor modified content: ${changed ? 'YES — inspect below' : 'no'}`);

  if (findings.length) {
    console.log('\nSCAN FINDINGS (review each before this file is committed):');
    for (const f of findings) console.log(`  ${f.label}: ${f.count} — e.g. ${f.samples.join(' , ')}`);
  } else {
    console.log('scan: no leak patterns matched');
  }

  if (Buffer.byteLength(redacted) > SIZE_BUDGET) {
    console.error(`\nOVER BUDGET by ${((Buffer.byteLength(redacted) - SIZE_BUDGET) / 1024).toFixed(1)}KB`);
    process.exit(1);
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing written');
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, redacted + '\n');
  console.log(`\nwrote ${path.relative(REPO, OUT)}`);
  console.log('NOT staged. Read it end to end before it is committed — it came off your machine.');
}

if (process.argv[1]?.endsWith('curate-demo-corpus.mjs')) main();
