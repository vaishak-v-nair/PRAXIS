// Terminal UI helpers — Claude-Code-style banner and colors.
// Colors auto-disable when not a TTY or when NO_COLOR is set.

import { MASCOT_ART } from './mascot-art.js';

const forceRich = process.env.PRAXIS_RICH === '1';
const useColor = (forceRich || !!process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const rose = paint('38;5;205');
export const sage = paint('38;5;114');
export const amber = paint('38;5;179');
export const blue = paint('38;5;110');
export const red = paint('38;5;174');
export const gold = paint('38;5;220');
export const bold = paint('1');
export const dim = paint('2');
export const grey = paint('38;5;245');

/** One clean line for everyday commands — the big welcome is init-only. */
export function miniHeader(version, note = '') {
  return rose('✦ ') + bold('PRAXIS') + (version ? grey(' v' + version) : '') + (note ? grey('  ·  ' + note) : '');
}

export function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

// ─── the layout system ───────────────────────────────────────────────────────
//
// Terminal output is typography. It gets the same three things any designed page
// gets — a grid, a type scale, and components — because the alternative is what
// this file used to produce: ragged indentation, 150-character lines, and blank
// lines dropped by feel.
//
// The numbers are not taste. GUTTER + CONTENT keeps every line inside 80 columns
// so nothing wraps by accident in a narrow terminal, and keeps the recorded GIF
// legible at 360px phone width, which the launch asset is required to be.
// LABEL_W is the widest state word we print (UNVERIFIABLE), so the data column
// never moves between rows.

export const GUTTER = 2;
export const CONTENT = 72;
export const LABEL_W = 12;
/** The single data column. Every label, chip and state word ends here, so one
 *  edge runs down the whole screen instead of one per block. */
export const COL = LABEL_W + 2;

const pad = (n) => ' '.repeat(Math.max(0, n));

/** The left margin every line shares. One gutter, applied in one place. */
export function g(s = '') {
  return pad(GUTTER) + s;
}

/**
 * Wrap plain text to a column. Operates on unpainted strings by design — paint
 * after wrapping, never before, or the escape codes get counted as characters
 * and the measurement lies.
 */
export function wrap(text, width = CONTENT) {
  const words = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  if (!words[0]) return [];
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  lines.push(cur);
  return lines;
}

/**
 * A solid badge — dark text on a filled colour. The one deliberately loud
 * element in the system, reserved for state that is the point of the screen
 * (SEALED, VERIFIED). Without colour it degrades to the word itself, which is
 * why the word always carries the meaning and the colour only reinforces it.
 */
export function chip(text, tone = 'sage', width = 0) {
  const BG = { sage: 114, rose: 205, amber: 179, blue: 110, gold: 220, grey: 245 };
  // `width` makes a STACK of chips share one edge. Two chips of different
  // lengths sitting above each other push their text to different columns, and
  // a column that moves between adjacent rows is the single most obvious tell
  // that output was printed rather than laid out.
  const body = ` ${String(text).toUpperCase().padEnd(width)} `;
  if (!useColor) return body;
  return `\x1b[48;5;${BG[tone] ?? BG.grey}m\x1b[38;5;232m\x1b[1m${body}\x1b[0m`;
}

/** The chip width that puts chip text on the same column as a `row()` label. */
export const CHIP_W = COL - 4;

/** A divider. With a label it becomes a section marker; without, a quiet break. */
export function rule(label = '', width = CONTENT) {
  if (!label) return dim('─'.repeat(width));
  const head = bold(String(label).toUpperCase());
  const used = stripAnsi(head).length + 2;
  return head + '  ' + dim('─'.repeat(Math.max(0, width - used)));
}

/** An aligned label/value row — the same left edge on every line of a block. */
export function row(label, value, labelW = COL) {
  return grey(String(label).padEnd(labelW)) + value;
}

/**
 * One judged claim: state word in a fixed column, claim wrapped beside it, the
 * judge's reasoning indented under the claim as a caption.
 *
 * The alignment is the argument. A reader scanning the state column sees the
 * shape of a judging — how much was TRUE, how much the record simply could not
 * answer — before reading a single claim.
 */
export function claimRow(verdictWord, claim, reasoning, paintFn = (s) => s) {
  const indent = COL;
  const w = CONTENT - indent;
  const out = [];
  const head = wrap(claim, w);
  out.push(paintFn(String(verdictWord).padEnd(indent)) + bold(head[0] || ''));
  for (const l of head.slice(1)) out.push(pad(indent) + bold(l));
  for (const l of wrap(reasoning, w)) out.push(pad(indent) + dim(l));
  return out;
}

// ─── the front door ──────────────────────────────────────────────────────────
//
// The welcome used to be a rounded two-column box with its own layout laws —
// centring, borders, a width negotiation with the terminal — while every other
// screen lived on the grid above. A product whose first screen obeys different
// rules than its second has two design systems, which is none (D7, reversing
// D99's "the big welcome is init-only"). So the box is gone, and the welcome
// is composed from the same grid, the same rules, the same rows as the demo
// and the receipts. No fallback path either: the grid needs no negotiation,
// so narrow and plain terminals see the same screen as rich ones.

/** The masthead. Set like a rule() so the family resemblance is immediate. */
export function masthead(version, tagline = 'your AI never forgets your project') {
  const head = rose('✦ ') + bold('PRAXIS') + grey('  v' + version);
  const used = stripAnsi(head).length + 2;
  const lines = [head + '  ' + dim('─'.repeat(Math.max(0, CONTENT - used)))];
  if (tagline) lines.push(grey(tagline));
  return lines.map((l) => g(l)).join('\n');
}

/** The axolotl, on the grid. Brand, not decoration — it is the tray icon too. */
export function mascotBlock() {
  return MASCOT_ART.map((l) => g(l)).join('\n');
}

export function slashMenu() {
  return [
    ['/praxis-recap', 'catch me up on this project'],
    ['/praxis-save', 'rich session summary, written by Claude'],
    ['/praxis-remember', 'save a fact or decision right now'],
    ['/praxis-forget', 'remove outdated info from memory'],
    ['/praxis-status', 'memory at a glance'],
  ];
}

/** The slash commands, as a section on the grid. */
export function slashBlock() {
  const menu = slashMenu();
  const nameW = Math.max(...menu.map((m) => m[0].length)) + 2;
  const lines = [rule('inside claude code, type /')];
  for (const [n, d] of menu) lines.push(rose(n.padEnd(nameW)) + grey(d));
  lines.push(grey('+ ') + rose('/praxis-') + grey('checkpoint · health · switch · trace · … — one per command'));
  return lines.map((l) => g(l)).join('\n');
}

// One line a day: motivation, humour, and axolotl wisdom. Rotates daily.
const QUOTES = [
  'Ship it. The axolotl believes in you.',
  'Your context died so this memory could live.',
  'Regrow. Refactor. Repeat.',
  'Yesterday-you left notes. Today-you is welcome.',
  'A fresh session is not a fresh start. You have history now.',
  'The best time to save context was yesterday. Praxis did.',
  'Slow is smooth. Smooth is shipped.',
  'Axolotls regrow limbs. You regrow codebases. Same energy.',
  'Do not "simplify" the load-bearing file. It remembers.',
  'Every dead end you logged is a road nobody walks twice.',
  'Memory is a feature. Forgetting is a bug.',
  'Small commits, long memory, calm mornings.',
  'You are one /praxis-save away from a better tomorrow.',
  'The rewrite can wait. The decision log cannot.',
  'Perfect is the enemy of merged.',
  'Somewhere, your future self is thanking you for this.',
  'Context is expensive. Yours is already paid for.',
  'A gill-bearing amphibian watches over your session. Relax.',
  'Write it down. Brains are for ideas, not storage.',
  'The bug was in the part everyone was afraid to touch. Naturally.',
  'Today is a great day to not re-explain your stack.',
  'Tests pass, memory saved, coffee hot. Peak existence.',
  'Be the senior dev your memory file thinks you are.',
  'Nothing leaves your machine. Except excuses.',
  'Read the error message. Then read it again. Then believe it.',
  'Your architecture makes sense. There are notes proving it.',
  'One command a day keeps amnesia away.',
  'The axolotl never panics. It just regenerates.',
  'Scope creep is a limb you did not mean to grow.',
  'Git remembers what you did. Praxis remembers why.',
  'It is not tech debt if you wrote down the interest rate.',
  'Deep work loves a pre-briefed morning.',
  'The fastest onboarding is the one that already happened.',
  'Delete boldly. The reasons are backed up.',
  'Yesterday’s dead end stays dead. That is growth.',
  'You have survived 100% of your worst sessions.',
  'An unsaved decision is a future argument.',
  'Keep the weirdness. Document the weirdness.',
  'Rubber ducks quack. Axolotls remember.',
  'Fewer tabs, more shipped.',
  'The cap is not a wall. It is a haircut.',
  'Legacy code is just memory nobody wrote down.',
  'Name things like the next reader is tired. They are.',
  'A quiet tray icon is a healthy session.',
  'Progress is measured in decisions kept, not lines written.',
  'When in doubt, /praxis-recap.',
  'Your project has lore now. Guard it.',
  'Big refactor? The memory file goes first, like a lantern.',
  'Breathe like the axolotl: slowly, and with intent.',
  'Done today beats perfect someday. The log agrees.',
];

export function dailyQuote() {
  const day = Math.floor(Date.now() / 86400000);
  return QUOTES[day % QUOTES.length];
}

export function timeAgo(date) {
  const s = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
