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
    if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* the printed URL is the fallback */
  }
}

export async function deck(argv = []) {
  const p = projectPaths();
  const portArg = argv.indexOf('--port');
  const wantPort = portArg > -1 ? Number(argv[portArg + 1]) : 4517;

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
