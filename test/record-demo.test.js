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
  segmentRows,
  foldLine,
  rowsHeight,
  snapTop,
  sealIndex,
  storyIndex,
  proofSegment,
  frameWith,
  CONT_INDENT,
  plain,
  W,
  H,
  ROWS,
  XTERM,
} from '../scripts/lib/termframe.mjs';

// A stand-in for the inverted demo: command typed, receipt sealed and checked,
// the pasteable command, then the recorded story.
const REEL = [
  { lines: ['$ npx praxis-memory demo'] },
  { lines: ['  NOT A RECORDING  ────'] },
  { lines: ['  NOT A RECORDING  ────', '   SEALED       on this machine'] },
  { lines: ['   SEALED       on this machine', '   VERIFIED     chain intact · signature valid'] },
  { lines: ['   VERIFIED     chain intact · signature valid', '    praxis receipt verify /tmp/r-a.jsonl'] },
  { lines: ['  REPLAY  ────'] },
  { lines: ['  JUDGED', '  FALSE   something'] },
  { lines: ['   sealed        chain intact · signature valid'] },
  { lines: ['  VERIFY IT YOURSELF'] },
];

test('the loop opens on proof ARRIVING, not on proof already complete', () => {
  // Not 1 — that frame is the header, with no proof on it yet.
  // Not 3 — the receipt is already sealed AND checked, so the most satisfying
  // moment in the demo happens off-camera and the loop opens on a fait accompli.
  assert.equal(sealIndex(REEL), 2, 'the receipt exists at frame zero, and VERIFIED still lands inside the loop');
});

test('the loop never anchors on the RECORDED seal further down the replay', () => {
  // Both say "sealed". Only one happened on this machine, and an anchor that
  // matched the other would open the launch asset on a frame inside a recording.
  assert.equal(sealIndex(REEL), 2);
  assert.ok(sealIndex(REEL) < storyIndex(REEL), 'the anchor is on the real seal, above the story');
});

test('sealIndex degrades through named anchors — never silently to zero', () => {
  const verifiedOnly = [{ lines: ['x'] }, { lines: ['   VERIFIED     chain intact · signature valid'] }];
  assert.equal(sealIndex(verifiedOnly), 1);

  const headerOnly = [{ lines: ['x'] }, { lines: ['  NOT A RECORDING'] }];
  assert.equal(sealIndex(headerOnly), 1);

  const nothing = Array.from({ length: 30 }, (_, i) => ({ lines: ['line ' + i] }));
  assert.equal(sealIndex(nothing), 18, 'falls back to the tail, so the GIF never loops from the top of the replay');
});

test('the GIF is the proof segment — it ends where the recorded story begins', () => {
  // Since the demo leads with proof, "seal to the end" is the whole recording:
  // a forty-second GIF, roughly ten times the 3MB budget. The asset takes the
  // part that IS proof and stops.
  const { start, end } = proofSegment(REEL);
  assert.equal(start, 2, 'opens on the receipt arriving');
  assert.equal(end, 5, 'and closes the frame before REPLAY');

  const seg = REEL.slice(start, end);
  assert.ok(seg.some((f) => f.lines.some((l) => /VERIFIED/.test(l))), 'the check is inside the loop');
  assert.ok(seg.some((f) => f.lines.some((l) => /receipt verify/.test(l))), 'so is the command to run');
  assert.ok(!seg.some((f) => f.lines.some((l) => /FALSE/.test(l))), 'and none of the recorded story is');
});

test('a recording with no story header runs to the end rather than guessing', () => {
  const noStory = REEL.slice(0, 5);
  assert.equal(storyIndex(noStory), -1);
  assert.deepEqual(proofSegment(noStory), { start: 2, end: 5 }, 'end of frames, so nothing is silently dropped');
});

test('a frame never opens on the tail of a sentence it cut in half', () => {
  // The window cuts wherever it lands. Continuation lines hang at the CLI's
  // data column, so a frame starting on one shows a fragment whose beginning
  // has already scrolled away.
  const cut = snapTop([
    ' '.repeat(CONT_INDENT) + 'cannot be confirmed or refuted.',
    ' '.repeat(CONT_INDENT) + 'still the same orphan',
    '  TRUE          a real beginning',
    ' '.repeat(CONT_INDENT) + 'its own reasoning, which belongs to it',
  ]);
  assert.equal(cut[0], '', 'the orphan is blanked');
  assert.equal(cut[1], '');
  assert.match(cut[2], /TRUE/, 'and a real beginning is left alone');
  assert.match(cut[3], /its own reasoning/, 'as is everything under it');
  assert.equal(cut.length, 4, 'blanked, never trimmed — trimming would shift every line and make the frame jitter');
});

test('snapTop stops at the first clean edge and touches nothing else', () => {
  assert.deepEqual(snapTop(['', '  anything']), ['', '  anything'], 'a blank top is already clean');
  assert.deepEqual(snapTop(['  NONE OF THIS PART IS A RECORDING']), ['  NONE OF THIS PART IS A RECORDING']);
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

test('the one line allowed to overflow the grid wraps instead of being cut off', () => {
  // The pasteable verify command carries an absolute path and is exempt from
  // the CLI's measure on purpose. A fixed-width recorder used to clip it, so
  // the asset ended on a truncated path — the one line a viewer reads letter
  // by letter. A terminal soft-wraps it; so does the recorder now.
  const long = '    npx praxis-memory receipt verify ' + 'C:\\Users\\someone\\.praxis\\demo\\receipts\\r-abcdef12.jsonl';
  const folded = foldLine(long, 40);
  assert.ok(folded.length > 1, 'it wraps');
  assert.ok(folded.every((l) => plain(l).length <= 40), 'and every piece fits the window');
  assert.equal(folded.join(''), long, 'nothing is lost or invented — it is the same characters');

  const win = screenWindow(long);
  assert.ok(win.length > 1, 'the window folds it too');
  assert.ok(win.every((l) => plain(l).length <= 78), 'nothing runs past the frame edge');
});

test('a wrapped line keeps its colour across the fold', () => {
  const painted = '\x1b[1m' + 'x'.repeat(30) + '\x1b[0m';
  const folded = foldLine(painted, 10);
  assert.equal(folded.length, 3);
  assert.ok(folded.every((l) => l.startsWith('\x1b[1m')), 'the style is carried, not dropped at the seam');
  assert.equal(folded.map(plain).join(''), 'x'.repeat(30));
  assert.deepEqual(foldLine('short', 10), ['short'], 'and a line that fits is returned untouched');
});

test('the GIF is sized to its own content, not to a scrolling terminal', () => {
  // The mp4 is a fixed 25-row terminal because it plays a scrolling session.
  // The GIF is a short block at the top of an empty screen — rendered at 25
  // rows, two thirds of the asset is black void.
  const seg = [{ lines: ['a', 'b'] }, { lines: ['a', 'b', 'c', 'd'] }];
  assert.equal(segmentRows(seg), 5, 'the tallest frame, plus one row to breathe');
  assert.ok(rowsHeight(5) < H, 'and that is shorter than the full window');
  assert.equal(rowsHeight(5) % 2, 0, 'still even — the mp4 path shares this helper');

  const tall = [{ lines: Array.from({ length: 40 }, (_, i) => 'l' + i) }];
  assert.equal(segmentRows(tall), ROWS, 'never taller than the terminal it is recording');

  const svg = frameSvg(['one', 'two'], 4);
  assert.match(svg, new RegExp(`height="${rowsHeight(4)}"`), 'the row count reaches the pixels');
});

test('the window shows what a terminal shows: the last rows, no trailing void', () => {
  const text = Array.from({ length: 60 }, (_, i) => 'line ' + i).join('\n') + '\n\n\n';
  const win = screenWindow(text);
  assert.equal(win.length, ROWS);
  assert.equal(win[win.length - 1], 'line 59', 'trailing blank lines are not a frame of nothing');
});

test('frameWith names the beat, so holds land on content rather than an index', () => {
  const frames = [{ lines: ['a'] }, { lines: ['   VERIFIED     chain intact'] }];
  assert.equal(frameWith(frames, /VERIFIED\s+chain intact/), 1);
  assert.equal(frameWith(frames, /nothing like this/), -1, 'and says so rather than guessing');
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
