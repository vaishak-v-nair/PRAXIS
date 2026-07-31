// The tray's brain, in JavaScript — one implementation, every platform.
//
// The Windows host (tray.ps1) computes this inline in PowerShell. When the
// macOS companion arrived, reimplementing the same precedence rules a second
// time in a second language was the obvious way to end up with two trays that
// disagree about what "warning" means. So the rules live here, in Node, where
// they can be unit-tested on any machine — including a Windows one with no Mac
// in sight — and the macOS host stays a thin renderer that asks this what to
// draw.
//
// Windows keeps its inline copy for now (rewriting a shipped 791-line host to
// prove a point is not a fix), but this is the reference: if the two ever
// disagree, this file is right.
import fs from 'node:fs';
import path from 'node:path';
import { healthReport } from './health.js';

const DEFAULT_CAP = 16384;
const STATES = ['idle', 'warning', 'limit', 'switching', 'restored', 'happy'];

/** "just now" / "12 m ago" / "3 h ago" / "2 d ago" — the tooltip's whole vocabulary. */
export function relativeAge(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} h ago`;
  return `${Math.floor(mins / 1440)} d ago`;
}

/** The newest sealed receipt's verdict, read by tailing one line. */
export function receiptBadge(receiptsDir) {
  try {
    const files = fs
      .readdirSync(receiptsDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const full = path.join(receiptsDir, f);
        return { full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    if (!files.length) return null;
    const lines = fs.readFileSync(files[0].full, 'utf8').trim().split('\n');
    const m = /"verdict":"([A-Z_]+)"/.exec(lines[lines.length - 1] || '');
    if (!m) return null;
    const verdict = m[1];
    if (verdict === 'VERIFIED') return { text: '✓ verified', color: '#6fbd8c', verdict };
    if (verdict === 'CLAIMS_FAILED') return { text: '✕ claims failed', color: '#e0604d', verdict };
    if (verdict === 'PARTIAL') return { text: '~ partial', color: '#edb54f', verdict };
    return { text: '· receipt sealed', color: '#a8988a', verdict };
  } catch {
    return null;
  }
}

/**
 * What the axolotl should look like right now, and why.
 *
 * Precedence is deliberate and matches tray.ps1: an active carry-over beats
 * everything, then the LIVE session fill. A session that stopped writing more
 * than 5 minutes ago is history — it must not hold the glow amber while you
 * are working on something else.
 *
 * The memory file deliberately does NOT drive the glow. It used to: >=0.6 of
 * `maxLogBytes` went amber and >=0.9 went red. But the trimmer stops the
 * instant the log is under the cap (memory.js: `while (bytes > maxBytes)
 * pop()`), so "just under the cap" is exactly where every healthy project
 * parks and stays. Green needs <0.6, which would require the log to shrink 40%
 * on its own — it never does. The effect was that one trim turned the axolotl
 * red permanently, on every project at once, for the ordinary condition the
 * tooltip itself describes as "nothing is lost". An alarm that can never clear
 * is not an alarm, and this tray's whole premise is being invisible until
 * something actually needs a human. Size still travels in `kb`/`capKb` for the
 * panel to show; it just no longer shouts.
 *
 * @param {string} root project root
 * @param {{now?: number, uptimeMs?: number}} [opts]
 */
export function computeTrayState(root, opts = {}) {
  const now = opts.now ?? Date.now();
  const uptimeMs = opts.uptimeMs ?? Infinity;
  const praxisDir = path.join(root, '.praxis');
  const memoryFile = path.join(praxisDir, 'memory.md');

  let cap = DEFAULT_CAP;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(praxisDir, 'config.json'), 'utf8'));
    if (Number.isFinite(cfg.maxLogBytes) && cfg.maxLogBytes > 0) cap = cfg.maxLogBytes;
  } catch {
    /* default cap */
  }

  let bytes = 0;
  let updated = '';
  try {
    const st = fs.statSync(memoryFile);
    bytes = st.size;
    updated = relativeAge(now - st.mtimeMs);
  } catch {
    /* no memory file yet */
  }

  let phase = '';
  let phaseAgeSec = Infinity;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(praxisDir, 'state.json'), 'utf8'));
    phase = String(s.phase || '');
    phaseAgeSec = (now - Date.parse(s.ts)) / 1000;
  } catch {
    /* no breadcrumb */
  }

  // live session health first; the health.json breadcrumb is the fallback for
  // when no transcript is readable (another agent, or a locked file).
  let sess = null;
  try {
    const hr = healthReport(root);
    if (hr) sess = { pct: hr.pct, level: hr.level, id: hr.sessionId, ageMin: hr.idleMinutes ?? 999 };
  } catch {
    /* fall through */
  }
  if (!sess) {
    try {
      const hj = JSON.parse(fs.readFileSync(path.join(praxisDir, 'health.json'), 'utf8'));
      const ageSec = (now - Date.parse(hj.updated)) / 1000;
      if (ageSec < 900 && hj.pct >= 0) {
        sess = { pct: hj.pct | 0, level: String(hj.level), id: String(hj.sessionId), ageMin: Math.floor(ageSec / 60) };
      }
    } catch {
      /* none */
    }
  }

  const ratio = cap > 0 ? bytes / cap : 0;
  const sessLive = !!sess && sess.ageMin <= 5;
  let name = 'idle';
  let label = 'healthy';
  if (phase === 'switching' && phaseAgeSec < 90) {
    name = 'switching';
    label = 'carrying context over';
  } else if (phase === 'restored' && phaseAgeSec < 120) {
    name = 'restored';
    label = 'context restored';
  } else if (sessLive && sess.level === 'critical') {
    name = 'limit';
    label = `session ${sess.pct}% full — switch soon`;
  } else if (sessLive && sess.level === 'heavy') {
    name = 'warning';
    label = `session ${sess.pct}% full`;
  } else if (uptimeMs < 8000) {
    name = 'happy';
    label = 'hello!';
  }

  let entries = 0;
  let recent = [];
  try {
    const heads = fs
      .readFileSync(memoryFile, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('### '));
    entries = heads.length;
    recent = heads.slice(0, 3).map((h) => {
      let t = h.slice(4).trim();
      // raw ISO stamps read like machine noise — show local "15 Jul 19:02"
      const iso = /^(\S+Z)\s*-\s*(.*)$/.exec(t);
      if (iso) {
        const d = new Date(iso[1]);
        if (!Number.isNaN(d.getTime())) {
          const mon = d.toLocaleString('en', { month: 'short' });
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          t = `${String(d.getDate()).padStart(2, '0')} ${mon} ${hh}:${mm} - ${iso[2]}`;
        }
      }
      return t.length > 42 ? t.slice(0, 42) + '…' : t;
    });
  } catch {
    /* no memory file */
  }

  return {
    name,
    label,
    ratio,
    updated,
    kb: Math.round((bytes / 1024) * 10) / 10,
    capKb: Math.round(cap / 1024),
    entries,
    recent,
    sess,
    receipt: receiptBadge(path.join(praxisDir, 'receipts')),
    project: path.basename(root),
  };
}

export const TRAY_STATES = STATES;

// `warning` and `limit` are now reachable only from a live session's fill, so
// they say what to do about a session — not about the memory file, which no
// longer drives the glow at all.
export const SUGGEST = {
  happy: 'Fresh start. Your memory loads automatically each time a session opens.',
  idle: 'All caught up. /praxis-save before you wrap up keeps today’s decisions.',
  warning: 'This session is filling up. /praxis-save now so nothing is lost to the next compaction.',
  limit: 'This session is nearly full. /praxis-save, then /compact or praxis switch to carry the context over.',
  switching: 'Carrying your context across sessions. Hold on…',
  restored: 'Context written back. The next session opens pre-briefed.',
};

export const STATE_COLOR = {
  happy: '#ef6f95',
  idle: '#6fbd8c',
  warning: '#edb54f',
  limit: '#e0604d',
  switching: '#6aa5e0',
  restored: '#d9ad55',
};
