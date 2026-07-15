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
    console.log(`  No Claude Code session found for this folder yet.
  Start ${bold('claude')} here, work a bit, then run ${bold('praxis health')} again.\n`);
    return;
  }

  const dot =
    report.level === 'fresh'
      ? sage('●')
      : report.level === 'warming'
        ? amber('●')
        : report.level === 'heavy'
          ? amber('●')
          : red('●');
  const k = (n) => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));

  console.log(
    '  ' +
      bold('Claude Code'.padEnd(14)) +
      dot +
      ` ${report.pct}% full ` +
      grey(`(${k(report.contextTokens)} of ${k(report.contextLimit)} tokens) — ${report.level}`),
  );
  const facts = [];
  if (report.compactions > 0) {
    facts.push(
      `squeezed ${report.compactions} time${report.compactions === 1 ? '' : 's'} already (each squeeze loses detail)`,
    );
  }
  if (report.toolErrors > 2) facts.push(`${report.toolErrors} tool errors this session`);
  if (report.lastTs) facts.push('last active ' + agoFromIso(report.lastTs));
  if (facts.length) console.log('  ' + ' '.repeat(14) + grey(facts.join(' · ')));

  const s = suggestNext(report.level, installed);
  console.log('\n  ' + bold('What to do') + '\n  ' + (s.urgent ? red(s.text) : s.text));
  if (s.command) console.log('  ' + dim('exact command: ') + rose(s.command));

  console.log('\n  ' + bold('Other tools on this machine'));
  for (const [key, t] of Object.entries(TOOLS)) {
    if (key === 'claude') continue;
    const mark = installed[key] ? sage('● installed') : grey('○ not found');
    console.log('  ' + t.name.padEnd(14) + mark + grey('   praxis switch ' + key));
  }
  console.log(
    '\n  ' + dim('Numbers come from the session transcript Claude Code itself writes — real usage, not a guess.') + '\n',
  );

  // leave the breadcrumb so the tray companion can see what we saw
  writeHealthFile(projectPaths().praxisDir, report, 'health');
}

function agoFromIso(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
