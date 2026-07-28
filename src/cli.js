#!/usr/bin/env node
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from './commands/init.js';
import { status } from './commands/status.js';
import { capture } from './commands/capture.js';
import { feedback } from './commands/feedback.js';
import { tray } from './commands/tray.js';
import { hud } from './commands/hud.js';
import { switchTool } from './commands/switch.js';
import { health } from './commands/health.js';
import { telemetry } from './commands/telemetry.js';
import { trace } from './commands/trace.js';
import { vault } from './commands/vault.js';
import { cost } from './commands/cost.js';
import { checkpoint } from './commands/checkpoint.js';
import { remember } from './commands/remember.js';
import { recap } from './commands/recap.js';
import { forget } from './commands/forget.js';
import { save } from './commands/save.js';
import { gate } from './commands/gate.js';
import { roi } from './commands/roi.js';
import { receipt } from './commands/receipt.js';
import { run } from './commands/run.js';
import { jobs } from './commands/jobs.js';
import { approve } from './commands/approve.js';
import { gov } from './commands/gov.js';
import { deck } from './commands/deck.js';
import { mcp } from './commands/mcp.js';
import { doctor } from './commands/doctor.js';
import { demo } from './commands/demo.js';
import { warnDeprecated } from './lib/deprecate.js';
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
  const pad = ' '.repeat(Math.max(0, c.length - 'praxis'.length));
  console.log('\n  ' + miniHeader(version()) + '\n');
  console.log(`  ${bold('Start')}
  ${bold('npx praxis-memory')}${pad}     set up PRAXIS here ${grey('(or show status if already set up)')}
  ${bold(`${c} demo`)}           see the whole thing in one minute ${grey('— no setup, no network')}

  ${bold('The daily four')} ${grey('— most days you need nothing else (and the hooks run these for you)')}
  ${bold(`${c} status`)}         memory, session health, latest receipt verdict
  ${bold(`${c} receipt`)}        proof of what the AI did ${grey('· --html share card · --list')}
  ${grey(`${c} receipt verify <file>`)}  ${grey('offline proof — chain + signature, free')}
  ${grey(`${c} receipt --verify`)}       ${grey('judge this session — one paid model call')}
  ${bold(`${c} recap`)}          catch me up on this project, right in the terminal
  ${bold(`${c} save`)}           log the current session into memory, mid-flight

  ${bold('The deck')} ${grey('— Mission Control (new): agents working for you in the background')}
  ${bold(`${c} deck`)}           Mission Control in your BROWSER — goal bar, fleet, approve buttons
  ${bold(`${c} gov "<goal>"`)}   the Governor staffs the deck from one goal ${grey('· gov alone = the report')}
  ${bold(`${c} run "<task>"`)}   hand a task to an agent, keep your terminal ${grey('· safe draft by default')}
  ${bold(`${c} jobs`)}           every background job, honest status, last words ${grey('· jobs <id>')}
  ${bold(`${c} approve`)}        the inbox: drafts wait for you ${grey('· approve <id> executes · --deny closes')}

  ${bold('The memory underneath')} ${grey('— context survives the session, so you never re-explain')}
  ${bold(`${c} remember "<f>"`)} save a fact into memory now ${grey(`· ${c} forget "<t>" removes it`)}
  ${bold(`${c} health`)}         how full is this Claude session, really — and where to go next
  ${bold(`${c} doctor`)}         what is set up, what broke, and the fix for each ${grey('(local read only)')}

  ${bold('Also included')}
  ${grey(`${c} switch <tool> · ${c} checkpoint · ${c} trace · ${c} gate · ${c} vault <path> · ${c} tray · ${c} telemetry · ${c} feedback`)}
  ${grey(`${c} init · ${c} capture — setup and the (internal) Stop-hook entry`)}

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

// Commands other people build better are on their way out — they still run,
// they just say where to go instead. See lib/deprecate.js for why this is a
// notice and not a deletion.
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
switch (cmd) {
  case 'init':
    await init();
    break;
  case 'status':
    status();
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
  case 'hud':
    await hud(process.argv.slice(3));
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
  case 'cost':
    cost(process.argv.slice(3));
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
  case 'roi':
    roi(process.argv.slice(3));
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
        const res = patchSettings(p.settingsFile);
        if (res.repaired) {
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
  default:
    console.log(`Unknown command: ${cmd}\n`);
    help();
    process.exitCode = 1;
}
}
