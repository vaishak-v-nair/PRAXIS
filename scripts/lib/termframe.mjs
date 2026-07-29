// Terminal → frames. The pure half of the launch recorder.
//
// Split from record-demo.mjs deliberately: that file imports sharp and
// ffmpeg-static, which are devDependencies, and CI runs the test suite with NO
// install step at all (PRAXIS has zero runtime deps and the suite needs none).
// A test that imported the recorder would go red on every CI runner for reasons
// that have nothing to do with the recording. Everything testable lives here;
// nothing here imports anything.

// ── the frame ────────────────────────────────────────────────────────────────
// COLS carries the CLI's own measure (gutter 2 + content 72) with air to spare.
// CHAR_W/LINE_H are enforced on the glyphs rather than hoped for, so the grid
// the CLI lays out is the grid that lands in the pixels.
export const COLS = 78;
export const ROWS = 25;
export const CHAR_W = 8.4;
export const LINE_H = 19;
export const FONT = 14;
export const PAD_X = 18;
export const PAD_Y = 16;

// h.264 refuses odd dimensions, and a frame that only exists as a GIF is half
// the deliverable. Rounded to even at the source rather than patched with a
// scale filter, so the GIF and the mp4 are the same pixels.
const even = (n) => (Math.round(n) % 2 ? Math.round(n) + 1 : Math.round(n));
export const W = even(COLS * CHAR_W + PAD_X * 2);

/** A frame's pixel height for a given number of rows. */
export const rowsHeight = (rows) => even(rows * LINE_H + PAD_Y * 2);
export const H = rowsHeight(ROWS);

/**
 * The tallest frame in a segment, in rows.
 *
 * The mp4 is a fixed 25-row terminal because it plays a scrolling session. The
 * GIF is not: since the demo leads with proof, its segment is a short block at
 * the top of an empty screen, and rendering it at 25 rows makes two thirds of
 * the asset black void. Sized to its own content, the same frames read as a
 * designed card instead of a mostly-empty terminal.
 */
export function segmentRows(frames, { pad = 1 } = {}) {
  const used = Math.max(1, ...frames.map((f) => f.lines.length));
  return Math.min(ROWS, used + pad);
}

// The receipt-card palette (D96) and the shipped ui.js tokens (D99). Nothing new.
export const BG = '#0e0f12';
export const FG = '#c8ccd4';
export const XTERM = {
  205: '#ff5faf', // rose
  114: '#87d787', // sage
  179: '#d7af5f', // amber
  110: '#87afd7', // blue
  174: '#d78787', // red
  220: '#ffd700', // gold
  245: '#8a8a8a', // grey
  232: '#0b0b0b', // chip ink
};

export const plain = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

/** Split one line into runs of {text, fg, bg, bold, dim}. */
export function parseLine(line) {
  const runs = [];
  let style = { fg: null, bg: null, bold: false, dim: false };
  let buf = '';
  const flush = () => {
    if (buf) runs.push({ text: buf, ...style });
    buf = '';
  };
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    buf += line.slice(last, m.index);
    last = re.lastIndex;
    flush();
    const codes = m[1].split(';').filter(Boolean).map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) style = { fg: null, bg: null, bold: false, dim: false };
      else if (c === 1) style.bold = true;
      else if (c === 2) style.dim = true;
      else if (c === 38 && codes[i + 1] === 5) {
        style.fg = XTERM[codes[i + 2]] || null;
        i += 2;
      } else if (c === 48 && codes[i + 1] === 5) {
        style.bg = XTERM[codes[i + 2]] || null;
        i += 2;
      }
    }
  }
  buf += line.slice(last);
  flush();
  return runs;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * One frame of terminal, as SVG.
 *
 * Every run is positioned by COLUMN and given an explicit textLength, so the
 * layout is the CLI's layout regardless of which monospace font the renderer
 * happens to find. Trusting a font's advance width is how a recorded grid ends
 * up half a character out of true by the right-hand edge.
 */
export function frameSvg(lines, rows = ROWS) {
  const h = rowsHeight(rows);
  const parts = [`<rect width="${W}" height="${h}" fill="${BG}"/>`];
  lines.slice(0, rows).forEach((line, r) => {
    const y = PAD_Y + r * LINE_H + FONT;
    let col = 0;
    for (const run of parseLine(line)) {
      const len = run.text.length;
      if (!len) continue;
      const x = PAD_X + col * CHAR_W;
      const wRun = len * CHAR_W;
      if (run.bg) {
        // One short of the line height so a STACK of chips reads as two states
        // rather than one slab — the terminal puts them on adjacent rows and a
        // full-bleed fill welds them together.
        parts.push(
          `<rect x="${x.toFixed(2)}" y="${(y - FONT + 3).toFixed(2)}" width="${wRun.toFixed(2)}" height="${LINE_H - 2}" rx="2" fill="${run.bg}"/>`,
        );
      }
      if (run.text.trim()) {
        const fill = run.bg ? run.fg || BG : run.fg || FG;
        const opacity = run.dim && !run.bg ? ' opacity="0.62"' : '';
        const weight = run.bold ? ' font-weight="700"' : '';
        parts.push(
          `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" textLength="${wRun.toFixed(2)}" lengthAdjust="spacing"` +
            ` fill="${fill}"${opacity}${weight} xml:space="preserve">${esc(run.text)}</text>`,
        );
      }
      col += len;
    }
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}">` +
    `<style>text{font-family:'DejaVu Sans Mono','Consolas','Menlo','Liberation Mono',monospace;font-size:${FONT}px;}</style>` +
    parts.join('') +
    `</svg>`
  );
}

// The CLI's hanging-indent column: gutter (2) + data column (14). A line
// starting here is the CONTINUATION of something whose first line is above it.
export const CONT_INDENT = 16;

/**
 * Blank any orphaned continuations at the top of a frame.
 *
 * A scrolling window cuts wherever it lands, so a frame could open on the tail
 * of a sentence whose beginning had already scrolled away — "…cannot be
 * confirmed or refuted." with nothing to attach it to. The eye starts on a
 * half-thought, which is the cheapest way to make a designed screen look
 * accidental.
 *
 * They are BLANKED, not trimmed. Trimming would shift every remaining line up
 * and make the whole frame jitter between beats; blanking keeps each line
 * exactly where it was and simply lets the top breathe.
 */
export function snapTop(lines) {
  const out = [...lines];
  for (let i = 0; i < out.length; i++) {
    const l = out[i];
    if (!l.trim()) break; // already a clean edge
    const indent = plain(l).length - plain(l).trimStart().length;
    if (indent < CONT_INDENT) break; // a real beginning — leave it alone
    out[i] = '';
  }
  return out;
}

/**
 * Soft-wrap one line at the window width, the way a terminal does.
 *
 * The CLI keeps every line inside the grid except one: the pasteable verify
 * command, which is exempt because an absolute receipt path can be any length
 * and a command with a newline in it is a broken command. A real terminal soft-
 * wraps that line and it still pastes as one; a fixed-width recorder CLIPPED
 * it, so the launch asset ended on a truncated path — the single line a viewer
 * is most likely to read character by character.
 *
 * Escape sequences are zero-width and are carried across the fold, so a wrapped
 * line keeps its colour instead of losing it halfway through.
 */
export function foldLine(line, cols = COLS) {
  const s = String(line);
  if (plain(s).length <= cols) return [s];
  const out = [];
  let buf = '';
  let vis = 0;
  let style = '';
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[[0-9;]*m/g;
  let i = 0;
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (m && m.index === i) {
      buf += m[0];
      style = m[0] === '\x1b[0m' ? '' : style + m[0];
      i = re.lastIndex;
      continue;
    }
    buf += s[i++];
    if (++vis === cols) {
      out.push(buf + (style ? '\x1b[0m' : ''));
      buf = style;
      vis = 0;
    }
  }
  if (plain(buf).length) out.push(buf);
  return out;
}

/** The last ROWS lines — what a terminal actually shows as output scrolls past. */
export function screenWindow(text) {
  const lines = String(text).split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return snapTop(lines.flatMap((l) => foldLine(l, COLS)).slice(-ROWS));
}

/** 0-4s: the command being typed. A recording of a command starts with the command. */
export function typingFrames(cmd) {
  const frames = [];
  const prompt = '\x1b[38;5;245m$\x1b[0m ';
  frames.push({ lines: ['', prompt.trim()], delay: 500 });
  for (let i = 1; i <= cmd.length; i++) {
    frames.push({ lines: ['', prompt + cmd.slice(0, i) + '\x1b[38;5;245m_\x1b[0m'], delay: 55 });
  }
  frames.push({ lines: ['', prompt + cmd], delay: 700 });
  return frames;
}

/**
 * Turn a capture into frames carrying real delays.
 *
 * Bursts closer together than `min` become one frame — the terminal writes a
 * screen in several chunks and a viewer sees one change. Long gaps are capped
 * so a pause reads as a beat rather than a stall.
 */
export function castFrames(events, { min = 90, cap = 1600, tail = 1200 } = {}) {
  const frames = [];
  let lastT = 0;
  let pending = null;
  for (const e of events) {
    if (pending && e.t - lastT < min) {
      pending.text = e.text;
      continue;
    }
    if (pending) frames.push({ lines: screenWindow(pending.text), delay: Math.min(cap, Math.max(min, e.t - lastT)) });
    pending = { text: e.text };
    lastT = e.t;
  }
  if (pending) frames.push({ lines: screenWindow(pending.text), delay: tail });
  return frames;
}

/** First frame carrying a line — used to anchor the loop and to time the holds. */
export function frameWith(frames, re) {
  return frames.findIndex((f) => f.lines.some((l) => re.test(plain(l))));
}

/**
 * Where the GIF loops from (D96: "so scrollers meet proof first").
 *
 * Two anchors were tried and rejected before this one, and both failures are
 * worth keeping:
 *
 *   the section header — the frame BEFORE any proof exists. A scroller met a
 *   wall of verdicts and had to wait for the point.
 *
 *   the VERIFIED line — proof already complete at frame zero. Correct, but it
 *   put the single most satisfying moment in the demo, proof ARRIVING, just
 *   off-camera. The loop opened on a fait accompli.
 *
 * The anchor is the SEALED line: the receipt exists at frame zero, so the
 * promise is kept, and VERIFIED still lands inside the loop where it can be
 * watched happening.
 *
 * Note the "on this machine" qualifier. The replay contains a second, RECORDED
 * seal, and an anchor that matched it would loop the asset from a beat inside
 * the recording — a launch GIF opening on the one frame that is not proof.
 */
export function sealIndex(frames) {
  const sealed = frameWith(frames, /SEALED\s+on this machine/);
  if (sealed !== -1) return sealed;
  const verified = frameWith(frames, /VERIFIED\s+chain intact/);
  if (verified !== -1) return verified;
  // Never silently pick frame 0 — a GIF that loops from the typed command
  // buries the thing it is for.
  const header = frameWith(frames, /NOT A RECORDING/);
  return header !== -1 ? header : Math.max(0, frames.length - 12);
}

/** The first frame of the recorded story — where the REPLAY section opens. */
export function storyIndex(frames) {
  return frameWith(frames, /^\s*REPLAY\s+─/);
}

/**
 * The GIF's slice: the seal, and everything the seal needs to stand alone.
 *
 * Since the demo was inverted to lead with proof (D3), "from the seal to the
 * end" is no longer a segment — it is the entire recording, story included,
 * which is a forty-second GIF and roughly ten times the 3MB budget.
 *
 * So the GIF takes the part that IS proof: the receipt arriving, checking out,
 * and the command that checks it, ending the instant the recorded story begins.
 * That slice is self-contained — a stranger who watches only the loop has seen
 * a real file appear, verify, and be handed to them. The story is the mp4's job.
 *
 * If the story header is ever missing the segment runs to the end rather than
 * guessing, and the caller is expected to notice the size.
 */
export function proofSegment(frames) {
  const start = sealIndex(frames);
  const story = storyIndex(frames);
  return { start, end: story > start ? story : frames.length };
}
