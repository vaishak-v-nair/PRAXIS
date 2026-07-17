// praxis health — how full is the current Claude session, really, and where
// to go next. Claude is measured from real token usage in its own transcript;
// other tools are checked shallowly (installed or not). Plain English out.

import { healthReport, suggestNext, detectTools, writeHealthFile } from '../lib/health.js';
import { projectPaths } from '../lib/paths.js';
import { TOOLS } from '../lib/tools.js';
import { rose, sage, amber, red, blue, bold, grey, dim } from '../lib/ui.js';

export async function health(args = []) {
  const report = healthReport();
  const installed = detectTools();

  if (args.includes('--json')) {
    console.log(JSON.stringify({ report, installed }, null, 2));
    return;
  }

  console.log('\n  ' + rose('✦') + ' ' + bold('Session health') + grey('  ·  ' + process.cwd()) + '\n');

  if (!report) {
    console.log(
      '  ' +
        bold('Claude Code'.padEnd(14)) +
        grey('○ not connected — no session in this folder yet') +
        `\n\n  Start ${bold('claude')} here and I measure it live. Everything else already works:` +
        `\n  ${bold('praxis status')} · ${bold('praxis switch')} · ${bold('praxis feedback')}\n`,
    );
    printTools(installed);
    return;
  }

  const k = (n) => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
  const facts = [];
  if (report.compactions > 0) {
    facts.push(
      `squeezed ${report.compactions} time${report.compactions === 1 ? '' : 's'} already (each squeeze loses detail)`,
    );
  }
  if (report.toolErrors > 2) facts.push(`${report.toolErrors} tool errors this session`);
  if (report.lastTs) facts.push('last active ' + agoFromIso(report.lastTs));

  if (!report.live) {
    // that session is over — its number is history, not a warning
    console.log(
      '  ' +
        bold('Claude Code'.padEnd(14)) +
        grey('◌ not open right now') +
        grey(` — last session ended at ${report.pct}% full (${k(report.contextTokens)} tokens)`),
    );
    if (facts.length) console.log('  ' + ' '.repeat(14) + grey(facts.join(' · ')));
    console.log(
      '\n  ' +
        bold('What to do') +
        '\n  Nothing. A new session always starts fresh at 0%, and your project memory loads into it automatically.',
    );
  } else {
    const dot =
      report.level === 'fresh'
        ? sage('●')
        : report.level === 'critical'
          ? red('●')
          : amber('●');
    console.log(
      '  ' +
        bold('Claude Code'.padEnd(14)) +
        dot +
        ` ${report.pct}% full ` +
        grey(
          (report.contextTokens > report.contextLimit
            ? `(${k(report.contextTokens)} tokens) — `
            : `(${k(report.contextTokens)} of ${k(report.contextLimit)} tokens) — `) + report.level,
        ),
    );
    if (facts.length) console.log('  ' + ' '.repeat(14) + grey(facts.join(' · ')));

    const s = suggestNext(report.level, installed);
    console.log('\n  ' + bold('What to do') + '\n  ' + (s.urgent ? red(s.text) : s.text));
    if (s.command) console.log('  ' + dim('exact command: ') + rose(s.command));
  }

  printTools(installed);

  // leave the breadcrumb so the tray companion can see what we saw
  writeHealthFile(projectPaths().praxisDir, report, 'health');
}

function printTools(installed) {
  console.log('\n  ' + bold('Other tools on this machine'));
  for (const [key, t] of Object.entries(TOOLS)) {
    if (key === 'claude') continue;
    const mark = installed[key] ? sage('● installed') : grey('○ not found');
    console.log('  ' + t.name.padEnd(14) + mark + grey('   praxis switch ' + key));
  }
  console.log(
    '\n  ' +
      dim('"full" = that session\'s context window (Claude\'s working memory) filling up —') +
      '\n  ' +
      dim('NOT your plan usage or quota. Numbers come from the transcript Claude itself writes.') +
      '\n',
  );
}

function agoFromIso(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
