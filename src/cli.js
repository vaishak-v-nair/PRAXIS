#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
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
import { record, flush } from './lib/telemetry.js';
import { projectPaths } from './lib/paths.js';
import { miniHeader, bold, grey } from './lib/ui.js';

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
  console.log('\n  ' + miniHeader(version()) + '\n');
  console.log(`  ${bold('Usage')}
  ${bold('npx praxis-memory')}     set up PRAXIS here ${grey('(or show status if already set up)')}
  ${bold('praxis init')}           set up PRAXIS in the current project
  ${bold('praxis status')}         what PRAXIS remembers, and session health
  ${bold('praxis health')}         how full is this Claude session, really — and where to go next
  ${bold('praxis hud')}            live view of your Claude session, in plain English ${grey('(second terminal)')}
  ${bold('praxis switch <tool>')}  pack a handoff brief and move to gemini · codex · claude · cursor
  ${bold('praxis trace')}          the AI context behind a commit ${grey('· on / off / log / <hash>')}
  ${bold('praxis vault <path>')}   write sessions, commits & memory into your Obsidian vault
  ${bold('praxis tray')}           the axolotl in your system tray ${grey('(Windows · --stop to quit)')}
  ${bold('praxis feedback')}       the two questions that shape what gets built next
  ${bold('praxis telemetry')}      what leaves your machine (spoiler: counts, never content) ${grey('· show / on / off')}
  ${grey('praxis capture        (internal) called by the Claude Code Stop hook')}

  ${grey('Local-first. No server. No account. Nothing leaves your machine.')}
`);
}

const cmd = process.argv[2];

// tier-2 telemetry: one counter per command, opt-in only, counts-and-enums only
record('cmd_' + (cmd || 'default'));

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
  case '-v':
  case '--version':
    console.log(version());
    break;
  case undefined:
    // Smart default: first run sets up, later runs give the full welcome.
    if (existsSync(projectPaths().praxisDir)) {
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

// fire-and-forget; inert until an endpoint exists and the user has opted in
void flush(version());
