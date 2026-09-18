// Reading a receipt back — the surface a human actually sees.
//
// A receipt on disk is hash-chained JSONL: correct, but not something you show a
// person. loadReceipt folds it into one plain object; renderTerminal prints it
// in the terminal; renderHtml writes a self-contained, shareable card (no
// external assets — it opens anywhere, offline). This is the layer that turns
// "the AI says it's done" into something you can look at and forward.

import fs from 'node:fs';
import path from 'node:path';
import { receiptFile, readEntries, verify, latestVersion } from './store.js';
import { bold, grey, sage, rose, dim } from '../ui.js';

/**
 * Fold a receipt's entries into a single structured object, with the integrity
 * check already run. Returns null if the receipt does not exist.
 */
export function loadReceipt(receiptsDir, id, version) {
  const v = version || latestVersion(receiptsDir, id);
  if (!v) return null;
  const entries = readEntries(receiptFile(receiptsDir, id, v));
  if (!entries.length) return null;
  const openE = entries.find((e) => e.t === 'open') || {};
  const evidenceE = entries.find((e) => e.t === 'evidence') || null;
  const finalE = entries.find((e) => e.t === 'final') || null;
  return {
    id,
    version: v,
    sessionId: openE.sessionId || '',
    project: openE.project || '',
    openedAt: openE.openedAt || '',
    finalizedAt: finalE ? finalE.finalizedAt || '' : '',
    verdict: finalE ? finalE.verdict : 'OPEN',
    claims: finalE ? finalE.claims || [] : [],
    evidence: evidenceE,
    sealed: !!finalE,
    keyFingerprint: finalE && finalE.sig ? finalE.sig.key : null,
    chain: verify(receiptsDir, id, v),
  };
}

/** Every receipt in a project, newest first. */
export function listReceipts(receiptsDir) {
  let files;
  try {
    files = fs.readdirSync(receiptsDir).filter((f) => /^r-[0-9a-f]{8}(?:\.v\d+)?\.jsonl$/.test(f));
  } catch {
    return [];
  }
  const rows = files.map((f) => {
    const m = f.match(/^(r-[0-9a-f]{8})(?:\.v(\d+))?\.jsonl$/);
    const id = m[1];
    const version = m[2] ? Number(m[2]) : 1;
    const entries = readEntries(path.join(receiptsDir, f));
    const openE = entries.find((e) => e.t === 'open') || {};
    const finalE = entries.find((e) => e.t === 'final');
    return {
      id,
      version,
      label: id + (version > 1 ? `.v${version}` : ''),
      verdict: finalE ? finalE.verdict : 'OPEN',
      openedAt: openE.openedAt || '',
      sealed: !!finalE,
    };
  });
  rows.sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt)) || b.version - a.version);
  return rows;
}

// ── terminal render ─────────────────────────────────────────────────────────

function workBits(counts = {}) {
  const b = [];
  if (counts.commands) b.push(`${counts.commands} command${counts.commands === 1 ? '' : 's'}`);
  if (counts.files_edited) b.push(`${counts.files_edited} file${counts.files_edited === 1 ? '' : 's'}`);
  if (counts.test) b.push('tests run');
  if (counts.build) b.push('build run');
  if (counts.git) b.push('git activity');
  return b;
}

function verdictBadge(v) {
  switch (v) {
    case 'VERIFIED':
      return sage('✓ VERIFIED');
    case 'CLAIMS_FAILED':
      return rose('✗ CLAIMS FAILED');
    case 'PARTIAL':
      return '~ PARTIAL';
    case 'NO_CLAIMS':
      return grey('· NO CLAIMS');
    default:
      return grey('· UNVERIFIED');
  }
}

function integrityLine(chain) {
  if (!chain || !chain.ok) return rose('CHAIN BROKEN' + (chain && chain.at != null ? ` at line ${chain.at}` : ''));
  if (chain.finalized) return sage('chain intact · signature valid');
  return grey('chain intact · not yet sealed');
}

function claimLine(v) {
  if (v.verdict === 'TRUE') return sage('✓') + '  ' + v.claim;
  if (v.verdict === 'FALSE') return rose('✗  ' + v.claim + '   ← FALSE');
  return grey('?') + '  ' + v.claim + grey('  (unverifiable)');
}

function shortId(s) {
  s = String(s || '');
  return s.length > 14 ? s.slice(0, 10) + '…' : s;
}

/** Render a loaded receipt for the terminal. Pass renderTerminal(loadReceipt(...)).
 *  opts.suggestVerify=false suppresses the --verify hint (e.g. right after a
 *  verify attempt failed — suggesting the thing that just failed is a loop). */
export function renderTerminal(r, { suggestVerify = true } = {}) {
  if (!r) return '\n  No such receipt.\n';
  const ev = r.evidence || {};
  const L = [];
  L.push('');
  L.push('  ' + bold('PRAXIS receipt') + '   ' + grey(r.id + (r.version > 1 ? ` · v${r.version}` : '')) + '   ' + verdictBadge(r.verdict));
  L.push('  ' + grey('─'.repeat(52)));
  L.push('  ' + grey('session  ') + ' ' + shortId(r.sessionId));
  L.push('  ' + grey('work     ') + ' ' + (workBits(ev.counts).join(' · ') || grey('no recorded activity')));
  if (ev.channels_harvested && ev.channels_harvested.length) L.push('  ' + grey('channels ') + ' ' + ev.channels_harvested.join(', '));
  L.push('  ' + grey('integrity') + ' ' + integrityLine(r.chain));
  if (r.sealed && r.finalizedAt) L.push('  ' + grey('sealed   ') + ' ' + r.finalizedAt);

  const claims = (r.claims || []).filter((v) => v.verdict !== 'NOT_A_CLAIM');
  if (claims.length) {
    const t = claims.filter((v) => v.verdict === 'TRUE').length;
    const f = claims.filter((v) => v.verdict === 'FALSE').length;
    const u = claims.filter((v) => v.verdict === 'UNVERIFIABLE').length;
    L.push('');
    L.push('  ' + bold('claims') + '   ' + `${t} TRUE · ${f} FALSE · ${u} UNVERIFIABLE`);
    for (const v of claims) L.push('    ' + claimLine(v));
  } else {
    L.push('');
    L.push('  ' + grey('evidence only — no claims judged yet.'));
    if (suggestVerify) L.push('  ' + dim('run ') + 'praxis receipt --verify' + dim(" to have the judge rule the agent's claims."));
  }
  L.push('');
  return L.join('\n');
}

// ── Markdown render (GitHub-flavored, for PR bodies) ─────────────────────────

function mdVerdictBadge(v) {
  switch (v) {
    case 'VERIFIED':
      return '✅ **VERIFIED**';
    case 'CLAIMS_FAILED':
      return '❌ **CLAIMS FAILED**';
    case 'PARTIAL':
      return '⚠️ **PARTIAL**';
    case 'NO_CLAIMS':
      return '· NO CLAIMS';
    default:
      return '· UNVERIFIED';
  }
}

function mdIntegrityLine(chain) {
  if (!chain || !chain.ok) return '🔴 chain broken' + (chain && chain.at != null ? ` at line ${chain.at}` : '');
  if (chain.finalized) return '🟢 chain intact · signature valid';
  return 'chain intact · not yet sealed';
}

// Claim text comes from the judge — a model — not from us. A newline or stray
// markdown control character in a claim must not be able to break out of its
// list item and inject headings, tables, checkboxes or mentions into the PR
// body this gets pasted into.
function mdEsc(s) {
  return String(s == null ? '' : s)
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/[\\`*_{}[\]()#+!|>~]/g, (c) => '\\' + c);
}

function mdClaimLine(v) {
  const claim = mdEsc(v.claim);
  if (v.verdict === 'TRUE') return `- ✅ ${claim}`;
  if (v.verdict === 'FALSE') return `- ❌ ${claim} — **FALSE**`;
  return `- ❔ ${claim} _(unverifiable)_`;
}

/** Render a loaded receipt as GitHub-flavored markdown — meant to be pasted or
 *  piped straight into a PR body. Pass renderMarkdown(loadReceipt(...)). */
export function renderMarkdown(r) {
  if (!r) return 'No such receipt.\n';
  const ev = r.evidence || {};
  const L = [];
  L.push(`### PRAXIS receipt \`${r.id}${r.version > 1 ? `.v${r.version}` : ''}\` — ${mdVerdictBadge(r.verdict)}`);
  L.push('');
  L.push('| | |');
  L.push('|---|---|');
  L.push(`| session | \`${shortId(r.sessionId)}\` |`);
  L.push(`| work | ${workBits(ev.counts).join(', ') || '_no recorded activity_'} |`);
  if (ev.channels_harvested && ev.channels_harvested.length) L.push(`| channels | ${ev.channels_harvested.join(', ')} |`);
  L.push(`| integrity | ${mdIntegrityLine(r.chain)} |`);
  if (r.sealed && r.finalizedAt) L.push(`| sealed | ${r.finalizedAt} |`);
  L.push('');

  const claims = (r.claims || []).filter((v) => v.verdict !== 'NOT_A_CLAIM');
  if (claims.length) {
    const t = claims.filter((v) => v.verdict === 'TRUE').length;
    const f = claims.filter((v) => v.verdict === 'FALSE').length;
    const u = claims.filter((v) => v.verdict === 'UNVERIFIABLE').length;
    L.push(`**Claims** — ${t} TRUE · ${f} FALSE · ${u} UNVERIFIABLE`);
    L.push('');
    for (const v of claims) L.push(mdClaimLine(v));
  } else {
    L.push('_Evidence only — no claims judged yet._');
  }
  L.push('');
  return L.join('\n');
}

// ── HTML render (self-contained, shareable) ──────────────────────────────────

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}

const VERDICT_META = {
  VERIFIED: { label: 'Verified', color: '#5bd18a', note: 'Every claim checks out against the evidence.' },
  CLAIMS_FAILED: { label: 'Claims failed', color: '#ff6b6b', note: 'At least one claim is contradicted by the evidence.' },
  PARTIAL: { label: 'Partial', color: '#f5a623', note: 'Some claims could not be confirmed from the evidence.' },
  NO_CLAIMS: { label: 'No claims', color: '#8a8f98', note: 'The agent made no factual work-claims to check.' },
  UNVERIFIED: { label: 'Unverified', color: '#8a8f98', note: 'Evidence sealed; the judge has not ruled the claims yet.' },
  OPEN: { label: 'Open', color: '#8a8f98', note: 'This receipt has not been sealed.' },
};

/** A single self-contained HTML file. No external assets, no network — opens
 *  offline, forwards anywhere. */
export function renderHtml(r) {
  if (!r) return '<!doctype html><meta charset="utf-8"><title>No receipt</title><p>No such receipt.</p>';
  const ev = r.evidence || {};
  const counts = ev.counts || {};
  const meta = VERDICT_META[r.verdict] || VERDICT_META.UNVERIFIED;
  const claims = (r.claims || []).filter((v) => v.verdict !== 'NOT_A_CLAIM');
  const chainOk = r.chain && r.chain.ok;

  const stat = (n, label) => `<div class="stat"><span class="n">${esc(n)}</span><span class="l">${esc(label)}</span></div>`;
  const stats = [
    stat(counts.commands || 0, 'commands'),
    stat(counts.files_edited || 0, 'files touched'),
    stat(counts.test || 0, 'test runs'),
    stat(counts.git || 0, 'git actions'),
  ].join('');

  const cRow = (v) => {
    const kind = v.verdict === 'TRUE' ? 'true' : v.verdict === 'FALSE' ? 'false' : 'unv';
    const mark = v.verdict === 'TRUE' ? '✓' : v.verdict === 'FALSE' ? '✗' : '?';
    return `<li class="c ${kind}"><span class="mark">${mark}</span><span class="claim">${esc(v.claim)}</span><span class="tag">${esc(v.verdict)}</span></li>`;
  };
  const claimsBlock = claims.length
    ? `<ul class="claims">${claims.map(cRow).join('')}</ul>`
    : `<p class="muted">Evidence only — no claims have been judged yet.</p>`;

  const channels = (ev.channels_harvested || []).map((c) => `<span class="chip">${esc(c)}</span>`).join('') || '<span class="muted">none recorded</span>';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PRAXIS receipt ${esc(r.id)}</title>
<style>
  :root{--bg:#0e0f12;--card:#16181d;--line:#24272e;--ink:#e8eaed;--muted:#8a8f98;--accent:#f5a623;--v:${meta.color}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased;padding:32px 16px}
  .card{max-width:620px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden}
  .top{padding:22px 26px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .brand{font-weight:700;letter-spacing:.3px}
  .brand .dot{color:var(--accent)}
  .id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);font-size:13px}
  .verdict{display:inline-flex;align-items:center;gap:8px;font-weight:700;color:var(--v)}
  .verdict .pip{width:9px;height:9px;border-radius:50%;background:var(--v);box-shadow:0 0 0 4px color-mix(in srgb,var(--v) 22%,transparent)}
  .note{padding:14px 26px;color:var(--muted);font-size:13.5px;border-bottom:1px solid var(--line)}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line)}
  .stat{background:var(--card);padding:18px 12px;text-align:center}
  .stat .n{display:block;font-size:22px;font-weight:700}
  .stat .l{display:block;font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-top:3px}
  .sec{padding:20px 26px;border-top:1px solid var(--line)}
  .sec h3{margin:0 0 12px;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);font-weight:600}
  .chip{display:inline-block;font-family:ui-monospace,monospace;font-size:12.5px;background:#1f2229;border:1px solid var(--line);border-radius:6px;padding:3px 9px;margin:0 6px 6px 0}
  .claims{list-style:none;margin:0;padding:0}
  .c{display:flex;align-items:flex-start;gap:11px;padding:9px 0;border-bottom:1px solid var(--line)}
  .c:last-child{border-bottom:0}
  .c .mark{font-weight:700;width:16px;flex:none;text-align:center}
  .c .claim{flex:1}
  .c .tag{font-size:11px;color:var(--muted);font-family:ui-monospace,monospace;align-self:center}
  .c.true .mark{color:#5bd18a}.c.false .mark{color:#ff6b6b}.c.false .claim{color:#ffb4b4}.c.unv .mark{color:var(--muted)}
  .muted{color:var(--muted)}
  .foot{padding:16px 26px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted)}
  .seal{color:${chainOk ? '#5bd18a' : '#ff6b6b'};font-weight:600}
  .fp{font-family:ui-monospace,monospace}
</style></head>
<body>
  <main class="card">
    <div class="top">
      <div><span class="brand">PRAXIS<span class="dot">.</span></span> <span class="id">${esc(r.id)}${r.version > 1 ? ` · v${r.version}` : ''}</span></div>
      <div class="verdict"><span class="pip"></span>${esc(meta.label)}</div>
    </div>
    <div class="note">${esc(meta.note)}</div>
    <div class="stats">${stats}</div>
    <div class="sec"><h3>Command channels harvested</h3>${channels}</div>
    <div class="sec"><h3>Claims</h3>${claimsBlock}</div>
    <div class="foot">
      <span class="seal">${chainOk ? '● tamper-evident' : '● chain broken'}${r.sealed ? ' · signed' : ''}</span>
      <span class="fp">${r.keyFingerprint ? 'key ' + esc(r.keyFingerprint) : ''}${r.finalizedAt ? ' · ' + esc(r.finalizedAt) : ''}</span>
    </div>
  </main>
</body></html>`;
}
