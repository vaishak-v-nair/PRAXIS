#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from './commands/init.js';
import { status } from './commands/status.js';
import { capture } from './commands/capture.js';
import { feedback } from './commands/feedback.js';

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
  console.log(`
PRAXIS — give Claude Code a memory. Never re-explain your project again.

Usage:
  praxis init        Set up PRAXIS in the current project
  praxis status      Show what PRAXIS remembers here
  praxis feedback    The two questions that shape PRAXIS's future
  praxis capture     (internal) called by the Claude Code Stop hook
  praxis --version

Local-first. No server. No account. Nothing leaves your machine.
`);
}

const cmd = process.argv[2];

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
  case '-v':
  case '--version':
    console.log(version());
    break;
  case undefined:
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
