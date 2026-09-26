import { spawn } from 'node:child_process';
import { createLiveServer, listenLiveLocal } from '../lib/live/server.js';
import { bold, grey, sage } from '../lib/ui.js';

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  } catch { /* printed URL remains the fallback */ }
}

export async function live(argv = []) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
  ${bold('praxis live')} ${grey('— interactive claim-verification pipeline')}

  Run one of two rehearsed scenarios and watch the existing PRAXIS Verify
  engine extract claims, retrieve evidence, verify them, judge each claim,
  and issue a browser-verified Ed25519 receipt.

  ${bold('--port <n>')}    ${grey('listen somewhere other than 4527')}
  ${bold('--no-open')}     ${grey('print the URL instead of opening a browser')}

  ${grey('Runs on 127.0.0.1 until you stop it with Ctrl+C.')}
`);
    return 0;
  }
  const portIndex = argv.indexOf('--port');
  const parsed = Number(argv[portIndex + 1]);
  const wanted = portIndex >= 0 && Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : 4527;
  const { server, token } = createLiveServer();
  const port = await listenLiveLocal(server, wanted);
  const url = `http://127.0.0.1:${port}/?t=${token}`;
  console.log(`\n  ${sage('✓')} ${bold('PRAXIS Live is ready')}`);
  console.log(`  ${grey('url      ')}${url}`);
  console.log(`  ${grey('scope    ')}two rehearsed local scenarios · LangGraph.js four-node runner · existing Verify engine`);
  console.log(`  ${grey('stop     ')}Ctrl+C\n`);
  if (!argv.includes('--no-open')) openBrowser(url);
  await new Promise(() => {});
}
