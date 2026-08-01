#!/usr/bin/env node
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from './commands/init.js';
import { status } from './commands/status.js';
import { capture } from './commands/capture.js';
import { feedback } from './commands/feedback.js';
import { tray } from './commands/tray.js';
import { switchTool } from './commands/switch.js';
import { health } from './commands/health.js';
import { telemetry } from './commands/telemetry.js';
import { trace } from './commands/trace.js';
import { vault } from './commands/vault.js';
import { checkpoint } from './commands/checkpoint.js';
import { remember } from './commands/remember.js';
import { recap } from './commands/recap.js';
import { forget } from './commands/forget.js';
import { save } from './commands/save.js';
import { gate } from './commands/gate.js';
import { receipt } from './commands/receipt.js';
import { run } from './commands/run.js';
import { jobs } from './commands/jobs.js';
import { approve } from './commands/approve.js';
import { gov } from './commands/gov.js';
import { deck } from './commands/deck.js';
import { mcp } from './commands/mcp.js';
import { doctor } from './commands/doctor.js';
import { uninstall } from './commands/uninstall.js';
import { demo } from './commands/demo.js';
import { warnDeprecated, removalNotice } from './lib/deprecate.js';
import { didYouMean } from './lib/suggest.js';
import { record, flush } from './lib/telemetry.js';
import { projectPaths } from './lib/paths.js';
import { praxisCmd } from './lib/runner.js';
import { patchSettings } from './lib/settings.js';
import { miniHeader, bold, grey, sage, dim } from './lib/ui.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function version() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

function help() {
  const c = praxisCmd();

  // The command rows are data, and the description column is MEASURED over
  // every name it has to clear — primaries share one column, sub-rows (a
  // command's variants, indented under it) share a deeper one. It used to be
  // hand-counted spaces per line, which is how `demo --live` sat two spaces
  // off every other row through three releases with nothing able to notice.
  // 'quiet' rows are de-emphasised but keep the primary column.
  const sections = [
    [bold('Start'), [
      ['npx praxis-memory', `set up PRAXIS here ${grey('(or show status if already set up)')}`],
      [`${c} demo`, `see the whole thing in one minute ${grey('— no setup, no network')}`],
      [`${c} demo --live`, grey('the same loop on real work: a sandbox agent, judged live (spends tokens)'), 'quiet'],
    ]],
    [bold('The daily four') + ' ' + grey('— most days you need nothing else (and the hooks run these for you)'), [
      [`${c} status`, 'memory, session health, latest receipt verdict'],
      [`${c} receipt`, `proof of what the AI did ${grey('· --html share card · --list')}`],
      [`${c} receipt verify <file>`, grey('offline proof — chain + signature, free'), 'sub'],
      [`${c} receipt --verify`, grey('judge this session — one paid model call'), 'sub'],
      [`${c} recap`, 'catch me up on this project, right in the terminal'],
      [`${c} save`, 'log the current session into memory, mid-flight'],
    ]],
    [bold('The deck') + ' ' + grey('— Mission Control (new): agents working for you in the background'), [
      [`${c} deck`, 'Mission Control in your BROWSER — goal bar, fleet, approve buttons'],
      [`${c} gov "<goal>"`, `the Governor staffs the deck from one goal ${grey('· gov alone = the report')}`],
      [`${c} run "<task>"`, `hand a task to an agent, keep your terminal ${grey('· safe draft by default')}`],
      [`${c} jobs`, `every background job, honest status, last words ${grey('· jobs <id>')}`],
      [`${c} approve`, `the inbox: drafts wait for you ${grey('· approve <id> executes · --deny closes')}`],
    ]],
    [bold('The memory underneath') + ' ' + grey('— context survives the session, so you never re-explain'), [
      [`${c} remember "<f>"`, `save a fact into memory now ${grey(`· ${c} forget "<t>" removes it`)}`],
      [`${c} health`, 'how full is this Claude session, really — and where to go next'],
      [`${c} doctor`, `what is set up, what broke, and the fix for each ${grey('(local read only)')}`],
      [`${c} uninstall`, `take PRAXIS out of this project ${grey('· your memory is archived, never deleted')}`],
    ]],
  ];

  const all = sections.flatMap(([, rows]) => rows);
  const col = Math.max(...all.filter((r) => r[2] !== 'sub').map((r) => r[0].length)) + 2;
  const subCol = Math.max(...all.filter((r) => r[2] === 'sub').map((r) => r[0].length)) + 2;
  const line = ([name, desc, kind]) =>
    '  ' + (kind ? grey : bold)(name.padEnd(kind === 'sub' ? subCol : col)) + desc;

  console.log('\n  ' + miniHeader(version()) + '\n');
  for (const [title, rows] of sections) {
    console.log('  ' + title);
    for (const r of rows) console.log(line(r));
    console.log('');
  }
  console.log(`  ${bold('Also included')}
  ${grey(`${c} switch <tool> · ${c} checkpoint · ${c} trace · ${c} gate · ${c} vault <path> · ${c} tray · ${c} telemetry · ${c} feedback`)}
  ${grey(`${c} init · ${c} capture — setup and the (internal) Stop-hook entry`)}
  ${grey(`--json on status · receipt · jobs · doctor — one document on stdout, stable keys, same exit codes`)}

  ${dim('Not our lane, and we will not pretend otherwise:')}
  ${dim('token costs → npx ccusage    ·    live session monitoring → npx cctop')}

  ${grey('Local-first. No server. No account. Nothing leaves your machine.')}${
    c === 'praxis'
      ? ''
      : '\n  ' + grey('Tip: `npm install -g praxis-memory` gives you the short `praxis` command.')
  }
`);
}

const cmd = process.argv[2];

// tier-2 telemetry: one counter per command, opt-in only, counts-and-enums only
record('cmd_' + (cmd || 'default'));

// Commands other people build better are on their way out — while they are
// deprecated they still run and just say where to go instead. Nothing is on
// notice today; cost, roi and hud completed the walk and were removed in
// 0.11.0. See lib/deprecate.js for why removal leaves a headstone.
warnDeprecated(cmd);

// Error boundary: a command must never dump a raw stack — especially the
// SessionStart hook (`praxis tray --ensure`) and post-commit trace, where a
// throw would surface as a hook error in the user's Claude session.
try {
  await dispatch(cmd);
} catch (e) {
  console.error('\n  ' + bold('praxis hit a problem') + grey(' — ' + (e && e.message ? e.message : String(e))) + '\n');
  process.exitCode = 1;
}

// fire-and-forget; inert until an endpoint exists and the user has opted in
void flush(version());

async function dispatch(cmd) {
// Every name the switch below answers to, kept adjacent so a new case lands
// here in the same diff. A stale list only costs a suggestion, never a command.
const COMMANDS = [
  'init', 'status', 'capture', 'feedback', 'tray', 'switch', 'health',
  'telemetry', 'trace', 'vault', 'checkpoint', 'remember', 'recap',
  'forget', 'save', 'explain', 'gate', 'receipt', 'run', 'jobs',
  'approve', 'gov', 'deck', 'mcp', 'doctor', 'uninstall', 'demo', 'help',
];
switch (cmd) {
  case 'init':
    await init();
    break;
  case 'status':
    status({ json: process.argv.slice(3).includes('--json') });
    break;
  case 'capture':
    await capture();
    break;
  case 'feedback':
    feedback();
    break;
  case 'tray':
    await tray(process.argv.slice(3));
    break;
  case 'switch':
    await switchTool(process.argv.slice(3));
    break;
  case 'health':
    await health(process.argv.slice(3));
    break;
  case 'telemetry':
    telemetry(process.argv.slice(3));
    break;
  case 'trace':
    await trace(process.argv.slice(3));
    break;
  case 'vault':
    vault(process.argv.slice(3));
    break;
  case 'checkpoint':
    await checkpoint(process.argv.slice(3));
    break;
  case 'remember':
    remember(process.argv.slice(3));
    break;
  case 'recap':
    recap();
    break;
  case 'forget':
    await forget(process.argv.slice(3));
    break;
  case 'save':
    save();
    break;
  case 'explain':
    // the one command that honestly needs the live conversation
    console.log('\n  Explaining the last answer needs the conversation itself — only Claude has it.\n  Inside Claude Code, type: /praxis-explain\n');
    break;
  case 'gate':
    gate(process.argv.slice(3));
    break;
  case 'receipt':
    await receipt(process.argv.slice(3));
    break;
  case 'run':
    await run(process.argv.slice(3));
    break;
  case 'jobs':
    await jobs(process.argv.slice(3));
    break;
  case 'approve':
    await approve(process.argv.slice(3));
    break;
  case 'gov':
    await gov(process.argv.slice(3));
    break;
  case 'deck':
    await deck(process.argv.slice(3));
    break;
  case 'mcp':
    await mcp();
    break;
  case 'doctor':
    process.exitCode = doctor(process.argv.slice(3));
    break;
  case 'uninstall':
    await uninstall(process.argv.slice(3));
    break;
  case 'demo':
    process.exitCode = await demo(process.argv.slice(3));
    break;
  case '-v':
  case '--version':
    console.log(version());
    break;
  case undefined:
    // Smart default: first run sets up, later runs give the full welcome.
    if (existsSync(projectPaths().praxisDir)) {
      // self-repair: versions before 0.9.1 wrote hooks as bare `praxis ...`,
      // which fail every session for npx-only installs ("command not found").
      // The front door fixes them without asking anyone to re-init.
      try {
        const p = projectPaths();
        mkdirSync(p.claudeDir, { recursive: true });
        // repairOnly, and BOTH files: the front door fixes what is broken and
        // installs nothing. Creating hooks here would silently re-scope an
        // install somebody already made a decision about.
        const res = patchSettings(p.settingsFile, { repairOnly: true });
        const resLocal = patchSettings(p.settingsLocalFile, { repairOnly: true });
        if (res.repaired || resLocal.repaired) {
          console.log('\n  ' + sage('✓') + ' repaired the Claude Code hooks — they now run through npx' + grey(' (no global install needed)'));
        }
      } catch {
        /* best-effort; init still covers it */
      }
      status({ welcome: true });
      await tray(['--ensure']); // the companion comes back with every run
    } else {
      await init();
    }
    break;
  case 'help':
  case '--help':
  case '-h':
    help();
    break;
  default: {
    // A command we removed is not a typo, and answering it with "did you mean
    // roi?" would be a joke at the user's expense. The fleet auto-upgrades, so
    // someone's script hits this the morning the release lands: name the
    // version that took it away and what to use instead.
    const gone = removalNotice(cmd);
    if (gone) {
      console.log('\n  ' + gone.split('\n').join('\n  ') + '\n');
      process.exitCode = 1;
      break;
    }
    // An answer sized to the mistake: one typo gets one suggestion, not the
    // entire help screen at scroll-destroying length. The full help stays one
    // named command away, and the miss still exits non-zero for scripts.
    const c = praxisCmd();
    const guess = didYouMean(cmd, COMMANDS);
    console.log(
      '\n  ' + bold(`Unknown command: ${cmd}`) +
        (guess ? grey(' — did you mean ') + bold(`${c} ${guess}`) + grey('?') : ''),
    );
    console.log('  ' + grey(`All commands: ${c} help`) + '\n');
    process.exitCode = 1;
  }
}
}
