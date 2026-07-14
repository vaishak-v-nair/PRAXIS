// Terminal UI helpers — Claude-Code-style banner and colors.
// Colors auto-disable when not a TTY or when NO_COLOR is set.

const useColor = !!process.stdout.isTTY && !process.env.NO_COLOR;
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

export function timeAgo(date) {
  const s = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
