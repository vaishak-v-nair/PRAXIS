// praxis hud — a live, readable view of your Claude Code session.
// Terminals full of scrolling text are hard to read. The HUD retells the whole
// session as a story: you said / claude said / what it did, one aligned line
// each, with a real context-health bar in the header.
// It tails the session transcript file — it never touches Claude's terminal.

import fs from 'node:fs';
import path from 'node:path';
import {
  transcriptDir,
  newestTranscript,
  freshHudState,
  applyLine,
  whatIsHappening,
} from '../lib/transcript.js';
import { classifyContext, DEFAULT_CONTEXT_LIMIT, writeHealthFile } from '../lib/health.js';
import { plainify } from '../lib/plain.js';
import { projectPaths } from '../lib/paths.js';
import { rose, sage, amber, blue, red, bold, grey, dim, stripAnsi } from '../lib/ui.js';
import { praxisCmd } from '../lib/runner.js';

const POLL_MS = 250; // re-read the transcript
const RESCAN_MS = 3000; // look for a newer session file
const ALT_ON = '\x1b[?1049h\x1b[?25l';
const ALT_OFF = '\x1b[?1049l\x1b[?25h';

export async function hud(args = []) {
  const once = args.includes('--once') || !process.stdout.isTTY;
  let file = argValue(args, '--session');

  if (!file) {
    const dir = transcriptDir();
    file = newestTranscript(dir);
    if (!file) {
      console.log(`
  No Claude Code sessions found for this folder yet.

  Do this:
  1. Open a terminal in this folder and start ${bold('claude')}.
  2. Open a second terminal next to it and run ${bold(`${praxisCmd()} hud`)}.

  The HUD shows what is happening in plain English, updating live.
`);
      process.exitCode = 1;
      return;
    }
  }

  const tail = makeTail(file);
  tail.catchUp();

  if (once) {
    console.log(render(tail.state, tail.meta()));
    return;
  }

  process.stdout.write(ALT_ON);
  const cleanup = () => {
    process.stdout.write(ALT_OFF);
  };
  process.on('exit', cleanup);
  const quit = () => {
    cleanup();
    process.exit(0);
  };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (b) => {
      const k = b.toString();
      if (k === 'q' || k === 'Q' || k === '\x03' || k === '\x1b') quit();
    });
  }

  let lastFrame = '';
  const draw = () => {
    const frame = render(tail.state, tail.meta());
    if (frame !== lastFrame) {
      lastFrame = frame;
      process.stdout.write('\x1b[H' + frame + '\x1b[J');
    }
  };

  // while the HUD watches, it leaves a live health breadcrumb for the tray
  const praxisDir = projectPaths().praxisDir;
  let lastCrumb = 0;
  const crumb = () => {
    const st = tail.state;
    if (!st.contextTokens || Date.now() - lastCrumb < 10000) return;
    lastCrumb = Date.now();
    const { pct, level } = classifyContext(st.contextTokens);
    writeHealthFile(
      praxisDir,
      {
        sessionId: path.basename(tail.file(), '.jsonl'),
        contextTokens: st.contextTokens,
        contextLimit: DEFAULT_CONTEXT_LIMIT,
        pct,
        level,
        compactions: st.compactions,
      },
      'hud',
    );
  };

  draw();
  setInterval(() => {
    tail.catchUp();
    crumb();
    draw();
  }, POLL_MS);

  // A new session in the same folder becomes the newest file — follow it.
  if (!argValue(args, '--session')) {
    setInterval(() => {
      const latest = newestTranscript(transcriptDir());
      if (latest && latest !== tail.file()) tail.switchTo(latest);
    }, RESCAN_MS);
  }
}

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Incremental JSONL tail: replay on open, then only read appended bytes. */
function makeTail(initialFile) {
  let file = initialFile;
  let offset = 0;
  let partial = '';
  let state = freshHudState();

  function catchUp() {
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }
    if (size < offset) {
      // truncated or replaced — start over
      offset = 0;
      partial = '';
      state = freshHudState();
    }
    if (size === offset) return;
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      offset = size;
      const chunk = partial + buf.toString('utf8');
      const lines = chunk.split('\n');
      partial = lines.pop() || '';
      for (const line of lines) if (line.trim()) applyLine(state, line);
    } catch {
      /* transient read error — next tick retries */
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* already closed */
        }
      }
    }
  }

  function switchTo(next) {
    file = next;
    offset = 0;
    partial = '';
    state = freshHudState();
    catchUp();
  }

  return {
    catchUp,
    switchTo,
    file: () => file,
    get state() {
      return state;
    },
    meta: () => ({ file, bytes: offset }),
  };
}

function render(state, meta) {
  const cols = Math.max(48, process.stdout.columns || 80);
  const rows = Math.max(14, process.stdout.rows || 30);
  const now = whatIsHappening(state);
  const dot =
    now.kind === 'ask'
      ? red('●')
      : now.kind === 'busy'
        ? amber('●')
        : now.kind === 'reply'
          ? sage('●')
          : grey('●');

  // real tokens from the transcript, drawn as a bar — not a guess
  let bar = grey('▯▯▯▯▯▯▯▯▯▯  warming up');
  let critical = false;
  if (state.contextTokens > 0) {
    const { pct, level } = classifyContext(state.contextTokens);
    critical = level === 'critical';
    const paint = critical ? red : level === 'fresh' ? sage : amber;
    const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
    bar = paint('▮'.repeat(filled) + '▯'.repeat(10 - filled) + `  ${pct}% full`);
  }

  const title =
    ' ' + rose('✦ ') + bold('PRAXIS HUD') + grey('  ·  ' + shortPath(process.cwd()));
  const titlePad = Math.max(2, cols - 1 - stripAnsi(title).length - stripAnsi(bar).length);
  const lines = [];
  lines.push('');
  lines.push(title + ' '.repeat(titlePad) + bar);
  lines.push(
    ' ' +
      dot +
      ' ' +
      (now.kind === 'ask' ? bold(red(now.text)) : now.text) +
      (state.lastTs ? grey('  ·  ' + agoFromIso(state.lastTs)) : '') +
      (critical ? red('  ·  praxis switch = fresh start') : ''),
  );
  lines.push(' ' + grey('─'.repeat(cols - 2)));

  // the session as a story — newest at the bottom, like a chat
  const bannerRows = state.needsYou ? 3 : 0;
  const budget = Math.max(4, rows - 7 - bannerRows);
  const story = storyLines(state.timeline, cols).slice(-budget);
  if (story.length === 0) {
    lines.push('');
    lines.push('   ' + dim('Nothing yet. Start claude in this folder — the session appears here,'));
    lines.push('   ' + dim('in plain English, as it happens.'));
  }
  for (const l of story) lines.push(l);

  lines.push(' ' + grey('─'.repeat(cols - 2)));
  if (state.needsYou) {
    lines.push(' ' + red(bold('▌ CLAUDE IS WAITING FOR YOUR ANSWER')));
    for (const l of wrap(state.asking, cols - 6, 2)) lines.push(' ' + red('▌ ') + l);
  }
  lines.push(
    ' ' +
      dim('q to quit  ·  watching ') +
      dim(path.basename(meta.file)) +
      dim('  ·  ' + fmtSize(meta.bytes) + ' of session so far'),
  );
  // pad every line to full width so in-place redraw leaves no ghosts
  return lines.map((l) => l + ' '.repeat(Math.max(0, cols - 1 - stripAnsi(l).length))).join('\n');
}

/** Timeline entries → aligned rows: time column, speaker column, wrapped text. */
function storyLines(timeline, cols) {
  const indent = 17; // " 19:02  claude  "
  const width = Math.max(20, Math.min(cols - indent - 2, 96));
  const out = [];
  for (const t of timeline) {
    const time = dim(hhmm(t.ts).padEnd(5));
    let tag;
    let paint = (x) => x;
    if (t.who === 'you') {
      tag = rose(bold('you   '));
    } else if (t.who === 'claude') {
      tag = blue('claude');
    } else if (t.who === 'note') {
      tag = amber('  ⚠   ');
      paint = amber;
    } else {
      tag = grey('  ·   ');
      paint = dim;
    }
    // plain English means no raw markdown noise — and no unexplained jargon:
    // Claude's replies get inline glosses ("refactor (rewriting code without
    // changing what it does)") so non-programmers can follow the story too
    let raw = t.text.replace(/\*\*|__|`/g, '');
    if (t.who === 'claude') raw = plainify(raw);
    const text = raw + (t.count > 1 ? ` ×${t.count}` : '');
    const wrapped = wrap(text, width, t.who === 'claude' ? 3 : 2);
    if (t.who === 'you' && out.length) out.push(''); // breathing room between turns
    out.push(' ' + time + ' ' + tag + '  ' + paint(wrapped[0]));
    for (const cont of wrapped.slice(1)) out.push(' '.repeat(indent) + paint(cont));
  }
  return out;
}

function hhmm(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '     ';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** Simple word wrap; words longer than the width are hard-sliced. */
export function wrap(text, width, maxLines) {
  const words = String(text).split(' ');
  const lines = [];
  let cur = '';
  for (let w of words) {
    while (stripAnsi(w).length > width) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      lines.push(w.slice(0, width));
      w = w.slice(width);
      if (lines.length >= maxLines) break;
    }
    if (lines.length >= maxLines) break;
    const cand = cur ? cur + ' ' + w : w;
    if (stripAnsi(cand).length > width) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cand;
    }
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length >= maxLines) {
    const last = lines[maxLines - 1];
    lines.length = maxLines;
    if (stripAnsi(last).length >= width) lines[maxLines - 1] = last.slice(0, width - 1) + '…';
    else lines[maxLines - 1] = last + '…';
  }
  return lines.length ? lines : [''];
}

function fmtSize(bytes) {
  return bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + ' MB' : (bytes / 1024).toFixed(0) + ' KB';
}

function agoFromIso(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 5) return 'just now';
  if (s < 60) return Math.floor(s) + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

function shortPath(p) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length <= 2 ? p : parts.slice(-2).join('/');
}
