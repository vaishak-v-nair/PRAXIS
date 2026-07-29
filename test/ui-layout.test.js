// The layout system, and the guardrail that keeps it honest.
//
// A grid nobody measures is a suggestion. The last test here runs the real demo
// and asserts every line of it fits — because the launch asset is a recording of
// this output at phone width, and one 90-character line ruins the frame it lands
// in whether or not anyone noticed while writing it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { wrap, chip, rule, row, claimRow, masthead, mascotBlock, slashBlock, stripAnsi, g, GUTTER, CONTENT, COL, LABEL_W, CHIP_W } from '../src/lib/ui.js';

const CLI = path.resolve('src', 'cli.js');
const width = (s) => stripAnsi(s).replace(/\s+$/, '').length;

test('wrap never exceeds its column and never loses a word', () => {
  const text = 'The record shows npm publish was actually run as a Bash command, contradicting the assertion that it could not be run here.';
  for (const w of [20, 40, 58, 72]) {
    const lines = wrap(text, w);
    for (const l of lines) assert.ok(l.length <= w, `"${l}" is ${l.length}, over ${w}`);
    assert.equal(lines.join(' '), text.replace(/\s+/g, ' ').trim(), 'wrapping is not editing');
  }
  assert.deepEqual(wrap(''), [], 'empty in, empty out — never a blank line from nothing');
  assert.deepEqual(wrap(null), []);
});

test('a word longer than the column still gets a line rather than vanishing', () => {
  const long = 'C:\\Users\\someone\\AppData\\Local\\Temp\\praxis-live-abc123\\.praxis\\receipts\\r-deadbeef.v2.jsonl';
  const lines = wrap(long, 40);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], long, 'a path is not wrappable — better to overflow than to corrupt it');
});

test('the grid is one column, shared by every component', () => {
  // If these drift apart the screen grows a second left edge, which is the
  // difference between "laid out" and "printed".
  assert.equal(COL, LABEL_W + 2);
  // Measured WITHOUT trailing-space stripping: the padding is the point here.
  const cols = (s) => stripAnsi(s).length;
  assert.equal(cols(chip('sealed', 'sage', CHIP_W) + '  '), COL, 'chip + gap lands on the column');
  assert.equal(cols(chip('verified', 'sage', CHIP_W) + '  '), COL, 'and so does a longer chip');
  assert.equal(cols(row('provenance', '')), COL);
  assert.equal(cols(row('no verdict', '')), COL);
});

test('chips and rules survive NO_COLOR with their meaning intact', () => {
  // D100: state words carry the meaning, colour only reinforces. Under NO_COLOR
  // the test process has no TTY either, so this is the plain path.
  const c = chip('verified', 'sage', CHIP_W);
  assert.match(stripAnsi(c), /VERIFIED/, 'the word is the signal, never the colour');
  assert.match(stripAnsi(rule('judged')), /^JUDGED\s+─+$/);
  assert.ok(width(rule('judged')) <= CONTENT);
  assert.ok(width(rule()) <= CONTENT);
});

test('claimRow keeps the state column fixed and hangs the rest beneath it', () => {
  const lines = claimRow('UNVERIFIABLE', 'a claim long enough that it certainly has to wrap across more than a single line', 'and a reason', (s) => s);
  assert.ok(lines.length >= 3);
  assert.match(lines[0], /^UNVERIFIABLE {2}/, 'widest state word still leaves a gap');
  for (const l of lines.slice(1)) {
    assert.match(stripAnsi(l), new RegExp(`^ {${COL}}\\S`), 'continuations hang at the column, never at the margin');
  }
  for (const l of lines) assert.ok(width(l) <= CONTENT, `"${stripAnsi(l)}" overflows`);
});

test('every line the demo prints fits the grid', () => {
  const r = spawnSync(process.execPath, [CLI, 'demo'], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, PRAXIS_DEMO_SPEED: '0' },
  });
  assert.equal(r.status, 0, (r.stdout || '').slice(-500));

  const max = GUTTER + CONTENT;
  const over = (r.stdout || '')
    .split('\n')
    // The pasteable verify command is exempt and must stay exempt: an absolute
    // receipt path can be any length, and a wrapped command is a broken command.
    .filter((l) => !/receipt verify /.test(stripAnsi(l)))
    .filter((l) => width(l) > max)
    .map((l) => `${width(l)}: ${stripAnsi(l)}`);

  assert.deepEqual(over, [], 'lines over the grid');
});

// ── the front door lives on the same grid (T4, reversing D99 per D7) ─────────

test('the welcome components are grid citizens, not a second design system', () => {
  for (const l of masthead('9.9.9').split('\n')) {
    assert.match(l, new RegExp(`^ {${GUTTER}}\\S`), 'masthead starts at the gutter');
    assert.ok(width(l) <= GUTTER + CONTENT, `"${stripAnsi(l)}" overflows the grid`);
  }
  assert.match(stripAnsi(masthead('9.9.9')), /PRAXIS\s+v9\.9\.9\s+─+/, 'the masthead is set like a rule — same family, no box');

  for (const l of mascotBlock().split('\n')) {
    assert.ok(width(l) <= GUTTER + CONTENT, 'the mascot fits the measure');
  }

  const slash = slashBlock().split('\n');
  assert.match(stripAnsi(slash[0]), /^ {2}INSIDE CLAUDE CODE, TYPE \/\s+─+$/, 'the menu is a section, marked like every section');
  const descCols = slash.slice(1, -1).map((l) => stripAnsi(l).match(/^ {2}\/praxis-\S+\s+/)[0].length);
  assert.equal(new Set(descCols).size, 1, 'command descriptions share one column — aligned, not ragged');
  for (const l of slash) assert.ok(width(l) <= GUTTER + CONTENT, `"${stripAnsi(l)}" overflows`);

  // The box is retired. Its resurrection would mean two systems again.
  return import('../src/lib/ui.js').then((ui) => {
    for (const gone of ['box', 'banner', 'bigBanner', 'slashHelp']) {
      assert.equal(ui[gone], undefined, `${gone}() was retired with D7 — the welcome is composition, not a box`);
    }
  });
});

test('every line the front door prints fits the grid — welcome and plain status', () => {
  // A throwaway project so the run is hermetic: memory exists, no receipts.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-ui-door-'));
  fs.mkdirSync(path.join(dir, '.praxis'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.praxis', 'memory.md'), '# PRAXIS Memory\n## Project\n\n### 2026-01-01 - session\n- x\n');

  const max = GUTTER + CONTENT;
  const check = (args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, PRAXIS_SKIP_TRAY: '1' },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const over = (r.stdout || '')
      .split('\n')
      .filter((l) => width(l) > max)
      .map((l) => `${width(l)}: ${stripAnsi(l)}`);
    assert.deepEqual(over, [], `lines over the grid in \`praxis ${args.join(' ') || '(front door)'}\``);
    return r.stdout;
  };

  const welcome = check([]); // the front door: full welcome
  assert.match(welcome, /INSIDE CLAUDE CODE, TYPE \//, 'the slash menu made it onto the grid');
  assert.ok(!/[╭╰│╮╯]/.test(welcome), 'no box characters anywhere — the rounded box is gone');

  const plain = check(['status']);
  assert.ok(!/INSIDE CLAUDE CODE/.test(plain), 'plain status stays lean — the menu is the front door’s');
});

test('the mascot only draws where truecolor can draw it — the grid draws everywhere', () => {
  // The mascot is pre-painted 24-bit ANSI. On legacy conhost or a pipe those
  // codes land as literal escape garbage — a real user reported the result as
  // "UI not looking good". The old welcome box gated this and the box
  // retirement dropped the gate wholesale; this pins its return.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-ui-mascot-'));
  fs.mkdirSync(path.join(dir, '.praxis'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.praxis', 'memory.md'), '# PRAXIS Memory\n## Project\n\n### 2026-01-01 - session\n- x\n');

  const env = { ...process.env, PRAXIS_SKIP_TRAY: '1' };
  delete env.PRAXIS_RICH;
  delete env.WT_SESSION;
  delete env.COLORTERM;
  delete env.TERM_PROGRAM;

  const plain = spawnSync(process.execPath, [CLI], { cwd: dir, encoding: 'utf8', timeout: 60000, env });
  // eslint-disable-next-line no-control-regex
  assert.ok(!/\x1b\[38;2/.test(plain.stdout), 'no truecolor bytes reach a terminal that never claimed to draw them');
  assert.match(stripAnsi(plain.stdout), /THIS PROJECT/, 'the grid itself needs no gate and is all there');

  const rich = spawnSync(process.execPath, [CLI], { cwd: dir, encoding: 'utf8', timeout: 60000, env: { ...env, PRAXIS_RICH: '1' } });
  // eslint-disable-next-line no-control-regex
  assert.ok(/\x1b\[38;2/.test(rich.stdout), 'and a terminal that can draw the axolotl gets the axolotl');
});

test('the state caption never restates the state word', () => {
  // "state ● near the cap — At the cap — …" shipped once. The near-cap copy is
  // pinned here so the duplication cannot come back reworded.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-ui-cap-'));
  fs.mkdirSync(path.join(dir, '.praxis'), { recursive: true });
  // over 90% of the default 16384-byte cap, so the near-the-cap branch renders
  fs.writeFileSync(path.join(dir, '.praxis', 'memory.md'), '# PRAXIS Memory\n' + '- filler line\n'.repeat(1200));

  const r = spawnSync(process.execPath, [CLI, 'status'], { cwd: dir, encoding: 'utf8', timeout: 60000, env: { ...process.env, PRAXIS_SKIP_TRAY: '1' } });
  const out = stripAnsi(r.stdout || '');
  assert.match(out, /near the cap/, 'the near-cap branch is the one on screen');
  assert.ok(!/At the cap/i.test(out.replace(/near the cap/g, '')), 'the caption explains, the row states — neither repeats the other');
  const capMentions = (out.match(/the cap/gi) || []).length;
  assert.equal(capMentions, 1, 'one mention of the cap, total');
});

test('help descriptions share their columns — measured, in both command forms', () => {
  // `demo --live` spent three releases two spaces off every other row because
  // the column was hand-counted spaces per line. Now it is measured — and so
  // is this: primaries on one column, sub-rows (a command's variants) on one
  // deeper column, whether the CLI calls itself `praxis` or the npx long form.
  for (const cmd of ['praxis', 'npx praxis-memory']) {
    const r = spawnSync(process.execPath, [CLI, 'help'], {
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, PRAXIS_CMD: cmd },
    });
    assert.equal(r.status, 0);

    const primaries = new Set();
    const subs = new Set();
    for (const raw of (r.stdout || '').split('\n')) {
      const l = stripAnsi(raw);
      if (!l.startsWith('  npx praxis-memory') && !l.startsWith(`  ${cmd} `)) continue;
      const gap = l.slice(2).match(/^(\S.*?) {2,}\S/);
      if (!gap) continue; // prose lines like the "Also included" list
      const col = 2 + gap[0].length - 1;
      (/verify <file>|--verify/.test(gap[1]) ? subs : primaries).add(col);
    }
    assert.ok(primaries.size >= 1 && subs.size >= 1, `found rows to measure (${cmd})`);
    assert.equal(primaries.size, 1, `one primary column with \`${cmd}\` — got ${[...primaries].join(', ')}`);
    assert.equal(subs.size, 1, `one sub-row column with \`${cmd}\` — got ${[...subs].join(', ')}`);
  }
});

test('the demo indents from one gutter, not from taste', () => {
  const r = spawnSync(process.execPath, [CLI, 'demo'], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, PRAXIS_DEMO_SPEED: '0' },
  });
  const starts = new Set();
  for (const l of (r.stdout || '').split('\n')) {
    const plain = stripAnsi(l);
    if (!plain.trim()) continue;
    starts.add(plain.length - plain.trimStart().length);
  }
  // Legal left edges: the gutter, the data column, the command indent, and the
  // chip's own inset (its background begins one space before its text).
  const legal = new Set([GUTTER, GUTTER + 1, GUTTER + COL, GUTTER + 2, GUTTER + 4]);
  const strays = [...starts].filter((s) => !legal.has(s)).sort((a, b) => a - b);
  assert.deepEqual(strays, [], 'stray indents');
  assert.equal(g('x'), ' '.repeat(GUTTER) + 'x');
});
