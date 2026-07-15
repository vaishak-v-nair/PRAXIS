// praxis hud — a live, readable view of your Claude Code session.
// Terminals full of scrolling text are hard to read. The HUD shows only three
// things, updating in place: what you asked, what Claude says, what is running.
// It tails the session transcript file — it never touches Claude's terminal.

import fs from 'node:fs';
import path from 'node:path';
import {
  transcriptDir,
  newestTranscript,
  freshHudState,
  applyLine,
  toolInPlainEnglish,
  whatIsHappening,
} from '../lib/transcript.js';
import { rose, sage, amber, blue, red, bold, grey, dim, stripAnsi } from '../lib/ui.js';

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
  2. Open a second terminal next to it and run ${bold('praxis hud')}.

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

  draw();
  setInterval(() => {
    tail.catchUp();
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
  const cols = Math.max(40, process.stdout.columns || 80);
  const width = Math.min(cols - 4, 100);
  const now = whatIsHappening(state);
  const dot =
    now.kind === 'ask'
      ? red('●')
      : now.kind === 'busy'
        ? amber('●')
        : now.kind === 'reply'
          ? sage('●')
          : grey('●');

  const lines = [];
  lines.push('');
  lines.push(
    ' ' +
      rose('✦ ') +
      bold('PRAXIS HUD') +
      grey('  ·  ' + shortPath(process.cwd())) +
      '  ' +
      dot +
      ' ' +
      (now.kind === 'ask' ? bold(red(now.text)) : now.text) +
      (state.lastTs ? grey('  ·  ' + agoFromIso(state.lastTs)) : ''),
  );
  lines.push('');

  section(lines, rose, state.needsYou ? 'CLAUDE ASKS YOU' : 'YOU ASKED', state.asking || dim('(nothing yet)'), width);
  section(lines, blue, 'CLAUDE SAYS', state.responding || dim('(nothing yet this turn)'), width);

  let runText = dim('(nothing running)');
  if (state.running) {
    const verb = state.running.done ? sage('done  ') : amber('now   ');
    runText = verb + toolInPlainEnglish(state.running.name, state.running.detail);
    if (state.toolsThisTurn > 1) runText += grey(`   (${state.toolsThisTurn} steps this turn)`);
  }
  section(lines, amber, 'RUNNING', runText, width);

  lines.push(
    ' ' +
      dim('q to quit  ·  watching ') +
      dim(path.basename(meta.file)) +
      dim('  ·  ' + fmtSize(meta.bytes) + ' of session so far'),
  );
  lines.push('');
  // pad every line to full width so in-place redraw leaves no ghosts
  return lines.map((l) => l + ' '.repeat(Math.max(0, cols - 1 - stripAnsi(l).length))).join('\n');
}

function section(lines, color, title, text, width) {
  lines.push(' ' + color(bold(title)));
  for (const l of wrap(text, width, 4)) lines.push('   ' + l);
  lines.push('');
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
