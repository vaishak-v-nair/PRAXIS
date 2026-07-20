import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPaths } from '../lib/paths.js';
import { readMemory } from '../lib/memory.js';
import { miniHeader, bigBanner, sage, amber, red, rose, bold, grey, dim, timeAgo, dailyQuote } from '../lib/ui.js';
import { praxisCmd } from '../lib/runner.js';
import { healthReport } from '../lib/health.js';

function pkgVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

export function status(opts = {}) {
  const p = projectPaths();
  if (!fs.existsSync(p.memoryFile)) {
    console.log('\n  ' + miniHeader(pkgVersion()) + '\n');
    console.log('  PRAXIS is not set up in this directory yet.');
    console.log('  Run ' + bold('npx praxis-memory') + ' to set it up.\n');
    return;
  }
  const content = readMemory(p.memoryFile);
  const bytes = Buffer.byteLength(content);
  const entries = (content.match(/^### /gm) || []).length;
  const stat = fs.statSync(p.memoryFile);

  let cap = 16384;
  try {
    cap = JSON.parse(fs.readFileSync(p.configFile, 'utf8')).maxLogBytes || cap;
  } catch {
    /* default */
  }
  const fill = bytes / cap;
  const health =
    fill < 0.6
      ? sage('●') + ' healthy'
      : fill < 0.9
        ? amber('●') + ' filling up'
        : red('●') + ' near the cap';
  const healthPlain =
    fill < 0.6
      ? 'Plenty of room. Nothing to do.'
      : fill < 0.9
        ? 'Getting full — the oldest session notes will be trimmed automatically. Nothing to do.'
        : 'At the cap — oldest notes are trimmed as new ones arrive. Put anything precious in the Project section; it is never trimmed.';

  // the front door (`npx praxis-memory`, bare `praxis`) keeps the full
  // welcome — mascot, box, slash menu. Plain `praxis status` stays clean.
  if (opts.welcome) {
    console.log('\n' + bigBanner(pkgVersion(), [grey((bytes / 1024).toFixed(1) + ' KB · ' + health)]) + '\n');
  } else {
    console.log('\n  ' + miniHeader(pkgVersion(), 'status') + '\n');
  }
  console.log('  ' + grey('memory   ') + path.relative(p.root, p.memoryFile));
  console.log(
    '  ' +
      grey('size     ') +
      `${(bytes / 1024).toFixed(1)} KB · ${entries} session entr${entries === 1 ? 'y' : 'ies'}`,
  );
  console.log('  ' + grey('updated  ') + timeAgo(stat.mtime));
  console.log('  ' + grey('state    ') + health + grey(' — ' + healthPlain));

  // is Claude actually here right now? say so in one honest line
  const hr = healthReport();
  if (!hr) {
    console.log('  ' + grey('claude   ') + grey('○ not connected — start ') + bold('claude') + grey(' here and PRAXIS comes alive'));
  } else if (hr.live) {
    const dot = hr.level === 'critical' ? red('●') : hr.level === 'fresh' ? sage('●') : amber('●');
    console.log('  ' + grey('claude   ') + dot + ` active now — ${hr.pct}% full` + grey(` · ${praxisCmd()} health for detail`));
  } else if (hr.idle) {
    console.log('  ' + grey('claude   ') + amber('◐') + ` idle ${hr.pct}% full` + grey(` — open but paused, ${hr.idleMinutes}m since the last message`));
  } else {
    console.log('  ' + grey('claude   ') + grey(`○ no recent session — last one reached ${hr.pct}% full`));
  }

  console.log('\n  ' + dim('Loaded into Claude Code automatically via the PRAXIS block in CLAUDE.md.'));
  console.log('  ' + dim('Inside a session, type ') + rose('/praxis-status') + dim(' or ') + rose('/praxis-save') + dim('.'));
  console.log('  ' + dim('Watching a live session? ') + rose(`${praxisCmd()} hud`) + dim(' in a second terminal shows it in plain English.'));
  console.log('  ' + dim('All commands: ') + rose(`${praxisCmd()} help`) + '\n');
  if (opts.welcome) console.log('  ' + dim('“' + dailyQuote() + '”') + '\n');
}
