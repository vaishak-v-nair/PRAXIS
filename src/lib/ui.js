// Terminal UI helpers — Claude-Code-style banner and colors.
// Colors auto-disable when not a TTY or when NO_COLOR is set.

import { MASCOT_ART, MASCOT_ART_WIDTH } from './mascot-art.js';

const forceRich = process.env.PRAXIS_RICH === '1';
const useColor = (forceRich || !!process.stdout.isTTY) && !process.env.NO_COLOR;
const richTerm =
  forceRich ||
  (useColor &&
    (process.env.WT_SESSION || process.env.COLORTERM === 'truecolor' || process.env.TERM_PROGRAM));
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const rose = paint('38;5;205');
export const sage = paint('38;5;114');
export const amber = paint('38;5;179');
export const blue = paint('38;5;110');
export const red = paint('38;5;174');
export const bold = paint('1');
export const dim = paint('2');
export const grey = paint('38;5;245');

export function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

export function box(lines, pad = 2) {
  const width = Math.max(...lines.map((l) => stripAnsi(l).length)) + pad * 2;
  const top = dim('╭' + '─'.repeat(width) + '╮');
  const bottom = dim('╰' + '─'.repeat(width) + '╯');
  const body = lines.map((l) => {
    const fill = width - pad - stripAnsi(l).length;
    return dim('│') + ' '.repeat(pad) + l + ' '.repeat(Math.max(0, fill)) + dim('│');
  });
  return [top, ...body, bottom].join('\n');
}

export function banner(version, extraLines = []) {
  const lines = [
    '',
    rose('✦ ') + bold('PRAXIS') + grey('  v' + version),
    grey('your AI never forgets your project'),
    '',
    ...extraLines,
  ];
  if (extraLines.length) lines.push('');
  return box(lines);
}

export function slashHelp() {
  return [
    rose('/praxis-save') + grey('     rich session summary, written by Claude'),
    rose('/praxis-status') + grey('   memory at a glance, inside Claude Code'),
  ];
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

// Two-column welcome box: mascot + welcome on the left, slash commands on the right.
// Falls back to the simple banner on narrow / basic terminals.
export function bigBanner(version, leftExtras = []) {
  const cols = process.stdout.columns || (forceRich ? 120 : 80);
  const menu = slashMenu();
  const nameW = Math.max(...menu.map((m) => m[0].length));
  const right = [
    bold('Inside Claude Code, type /'),
    '',
    ...menu.map(([n, d]) => rose(n.padEnd(nameW + 2)) + grey(d)),
    '',
    grey('praxis help — everything else'),
  ];
  const leftW = Math.max(MASCOT_ART_WIDTH, ...leftExtras.map((l) => stripAnsi(l).length), 18);
  const rightW = Math.max(...right.map((l) => stripAnsi(l).length));
  const total = leftW + rightW + 9;
  if (!richTerm || cols < total + 2) return banner(version, slashHelp());

  const center = (s) => {
    const pad = Math.floor((leftW - stripAnsi(s).length) / 2);
    return ' '.repeat(Math.max(0, pad)) + s;
  };
  const left = ['', center(bold('Welcome!')), '', ...MASCOT_ART.map(center), ''];
  for (const l of leftExtras) left.push(center(l));
  if (leftExtras.length) left.push('');

  const rightPadTop = Math.max(0, Math.floor((left.length - right.length) / 2));
  const r2 = [...Array(rightPadTop).fill(''), ...right];
  const rows = Math.max(left.length, r2.length);
  const line = (arr, i, w) => {
    const s = arr[i] || '';
    return s + ' '.repeat(Math.max(0, w - stripAnsi(s).length));
  };

  const title = ' ' + rose('✦') + ' ' + bold('PRAXIS') + grey(' v' + version) + ' ';
  const titleLen = stripAnsi(title).length;
  const top = dim('╭──') + title + dim('─'.repeat(Math.max(0, total - titleLen - 3)) + '╮');
  const bottom = dim('╰' + '─'.repeat(total) + '╯');
  const body = [];
  for (let i = 0; i < rows; i++) {
    body.push(
      dim('│') +
        '  ' +
        line(left, i, leftW) +
        '  ' +
        dim('│') +
        '  ' +
        line(r2, i, rightW) +
        '  ' +
        dim('│'),
    );
  }
  return [top, ...body, bottom].join('\n');
}

export function timeAgo(date) {
  const s = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
