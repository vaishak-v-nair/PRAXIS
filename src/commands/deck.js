// `praxis deck` — Mission Control, in your browser. For everyone who doesn't
// live in a terminal: give the Governor a goal, watch the fleet, approve or
// deny drafts with a click, open sealed receipts. Local only, always.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { projectPaths } from '../lib/paths.js';
import { createDeckServer, listenLocal } from '../lib/deck/server.js';
import { startJob } from './run.js';
import { executionTask } from './approve.js';
import { bold, grey, sage } from '../lib/ui.js';

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* the printed URL is the fallback */
  }
}

export async function deck(argv = []) {
  // Every other command answers --help. This one used to ignore it, bind a
  // port, open a browser window, and then block forever on a promise that never
  // settles — so asking what the deck does handed you a running server and a
  // terminal you had to Ctrl+C. Help must never be a side effect.
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
  ${bold('praxis deck')} ${grey('— Mission Control in your browser')}

  Give the Governor a goal, watch the fleet, approve or deny drafts, open
  sealed receipts. Binds 127.0.0.1 only, with a fresh token per launch.

  ${bold('--port <n>')}    ${grey('listen somewhere other than 4517')}
  ${bold('--no-open')}     ${grey('print the URL instead of opening a browser')}

  ${grey('Runs until you stop it with Ctrl+C. Nothing leaves this machine.')}
`);
    return;
  }

  const p = projectPaths();
  const portArg = argv.indexOf('--port');
  const parsedPort = Number(argv[argv.indexOf('--port') + 1]);
  const wantPort = portArg > -1 && Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535 ? parsedPort : 4517;

  const { server, token } = createDeckServer({
    cwd: p.root,
    praxisDir: p.praxisDir,
    memoryFile: p.memoryFile,
    project: path.basename(p.root),
    startJob,
    executionTask,
  });

  const port = await listenLocal(server, wantPort);
  const url = `http://127.0.0.1:${port}/?t=${token}`;

  console.log('\n  ' + sage('✓') + ' ' + bold('THE DECK is up') + grey('  — Mission Control, in your browser'));
  console.log('  ' + grey('url      ') + url);
  console.log('  ' + grey('scope    ') + 'this machine only (127.0.0.1) · per-launch token · nothing leaves');
  console.log('  ' + grey('stop     ') + 'Ctrl+C\n');
  if (!argv.includes('--no-open')) openBrowser(url);

  // stay alive until the human closes it
  await new Promise(() => {});
}
