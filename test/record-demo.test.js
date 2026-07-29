// The launch recorder's pure half.
//
// Imports scripts/lib/termframe.mjs and nothing else — the recorder proper
// pulls in sharp and ffmpeg-static, and CI runs this suite with no install step
// at all. Everything worth asserting about the asset is decided here anyway:
// which frame the loop starts on, how ANSI becomes colour, and whether the
// grid the CLI lays out survives into the pixels.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLine,
  frameSvg,
  castFrames,
  typingFrames,
  screenWindow,
  sealIndex,
  plain,
  W,
  H,
  ROWS,
  XTERM,
} from '../scripts/lib/termframe.mjs';

const sealFrame = (extra = []) => ({
  lines: ['  NONE OF THIS PART IS A RECORDING  ────', '   SEALED       on this machine', '   VERIFIED     chain intact · signature valid', ...extra],
});

test('the loop starts on proof, not on the run-up to it', () => {
  const frames = [
    { lines: ['  JUDGED', '  FALSE   something'] },
    { lines: ['  NONE OF THIS PART IS A RECORDING  ────'] },
    sealFrame(),
    { lines: ['  VERIFY IT YOURSELF'] },
  ];
  // Not index 1: that frame carries the header but the receipt is not yet
  // sealed on screen, so a scroller meeting it sees verdicts and has to wait.
  assert.equal(sealIndex(frames), 2, 'anchors on the verification line itself');
});

test('sealIndex degrades to the header, then to the tail — never silently to zero', () => {
  const headerOnly = [{ lines: ['x'] }, { lines: ['  NONE OF THIS PART IS A RECORDING'] }];
  assert.equal(sealIndex(headerOnly), 1);

  const nothing = Array.from({ length: 30 }, (_, i) => ({ lines: ['line ' + i] }));
  assert.equal(sealIndex(nothing), 18, 'falls back to the tail, so the GIF never loops from the top of the replay');
});

test('ANSI becomes the shipped palette, and only the shipped palette', () => {
  const runs = parseLine('\x1b[38;5;114mchain intact\x1b[0m plain');
  assert.equal(runs[0].text, 'chain intact');
  assert.equal(runs[0].fg, XTERM[114], 'sage, from ui.js');
  assert.equal(runs[1].fg, null, 'and the reset really resets');

  const chip = parseLine('\x1b[48;5;114m\x1b[38;5;232m\x1b[1m SEALED \x1b[0m');
  assert.equal(chip[0].bg, XTERM[114]);
  assert.equal(chip[0].fg, XTERM[232]);
  assert.equal(chip[0].bold, true);

  assert.equal(parseLine('\x1b[2mquiet\x1b[0m')[0].dim, true);
  assert.deepEqual(parseLine('nothing special'), [{ text: 'nothing special', fg: null, bg: null, bold: false, dim: false }]);
});

test('runs are positioned by column, so the CLI grid survives the font', () => {
  // A chip on one line and a label on the next must land on the same x. If the
  // renderer trusted the font's advance width instead of forcing textLength,
  // this is the assertion that would drift.
  const svg = frameSvg(['\x1b[48;5;114m SEALED     \x1b[0m  on this machine', 'provenance    demo-replay']);
  const xs = [...svg.matchAll(/<text x="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(xs.length >= 2);
  assert.ok(
    svg.includes('lengthAdjust="spacing"') && svg.includes('textLength='),
    'every run declares its own width rather than hoping',
  );
  assert.match(svg, new RegExp(`width="${W}" height="${H}"`));
});

test('the frame obeys the launch spec it was built for', () => {
  assert.ok(W <= 720, `frame is ${W}px, the spec caps it at 720`);
  assert.equal(W % 2, 0, 'h.264 refuses odd dimensions');
  assert.equal(H % 2, 0);
  const svg = frameSvg(['hello']);
  assert.ok(svg.includes('fill="#0e0f12"'), 'the dark ground is the receipt card colour');
  assert.ok(!/font-family="[^"]*(Arial|Helvetica)/.test(svg), 'monospace only — it is a terminal');
});

test('escaping: terminal text that looks like markup stays text', () => {
  const svg = frameSvg(['a < b && c > d']);
  assert.ok(svg.includes('a &lt; b &amp;&amp; c &gt; d'));
});

test('the window shows what a terminal shows: the last rows, no trailing void', () => {
  const text = Array.from({ length: 60 }, (_, i) => 'line ' + i).join('\n') + '\n\n\n';
  const win = screenWindow(text);
  assert.equal(win.length, ROWS);
  assert.equal(win[win.length - 1], 'line 59', 'trailing blank lines are not a frame of nothing');
});

test('frames carry the real gaps, coalesced and capped', () => {
  const events = [
    { t: 0, text: 'a' },
    { t: 20, text: 'ab' }, // same burst — a viewer sees one change
    { t: 500, text: 'abc' },
    { t: 9000, text: 'abcd' }, // a stall, not a beat
  ];
  const frames = castFrames(events, { min: 90, cap: 1600, tail: 1000 });
  assert.equal(frames.length, 3, 'the 20ms burst merged');
  assert.equal(frames[0].delay, 500, 'real gaps are kept');
  assert.equal(frames[1].delay, 1600, 'and long ones are capped so a pause is a beat');
  assert.equal(frames[2].delay, 1000);
});

test('the recording opens on the command being typed', () => {
  const frames = typingFrames('npx praxis-memory demo');
  assert.ok(frames.length > 20);
  assert.match(plain(frames[frames.length - 1].lines[1]), /^\$ npx praxis-memory demo$/, 'and ends with it whole');
  assert.ok(frames.every((f) => f.delay > 0), 'every frame has a duration or it is not a frame');
});
