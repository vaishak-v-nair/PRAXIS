import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectPaths } from '../lib/paths.js';
import { sage, amber, rose, bold, grey, dim } from '../lib/ui.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRAY_SRC = path.join(__dirname, '..', 'tray');
const STATES = ['idle', 'warning', 'limit', 'switching', 'restored', 'happy'];

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function tray(args = []) {
  if (process.platform !== 'win32') {
    console.log('\n  The tray companion ships for ' + bold('Windows') + ' today.');
    console.log('  macOS and Linux are next on the roadmap — until then, ' + bold('praxis status') + '');
    console.log('  gives you the same session health in the terminal.\n');
    return;
  }

  const p = projectPaths();
  const trayDir = path.join(p.praxisDir, 'tray');
  const pidFile = path.join(trayDir, 'tray.pid');

  if (args.includes('--stop')) {
    let pid = 0;
    try {
      pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
    } catch {
      /* no pid file */
    }
    if (pid && pidAlive(pid)) {
      try {
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        /* already gone */
      }
      console.log('\n  ' + sage('✓') + ' tray companion stopped.\n');
    } else {
      console.log('\n  tray companion is not running here.\n');
    }
    try {
      fs.rmSync(pidFile, { force: true });
    } catch {
      /* fine */
    }
    return;
  }

  if (!fs.existsSync(p.praxisDir)) {
    console.log('\n  PRAXIS is not set up here yet. Run ' + bold('npx praxis-memory') + ' first.\n');
    return;
  }

  // stage the host script + icons into the project
  fs.mkdirSync(path.join(trayDir, 'icons'), { recursive: true });
  fs.copyFileSync(path.join(TRAY_SRC, 'tray.ps1'), path.join(trayDir, 'tray.ps1'));
  for (const s of STATES) {
    fs.copyFileSync(
      path.join(TRAY_SRC, 'icons', `${s}.ico`),
      path.join(trayDir, 'icons', `${s}.ico`),
    );
  }

  const psArgs = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    path.join(trayDir, 'tray.ps1'),
    '-ProjectRoot',
    p.root,
    '-IconDir',
    path.join(trayDir, 'icons'),
    '-PidFile',
    pidFile,
  ];

  if (args.includes('--once')) {
    // debug/verify mode: compute state once in the foreground and exit
    const out = execFileSync('powershell.exe', [...psArgs, '-Once'], { encoding: 'utf8' });
    process.stdout.write(out);
    return;
  }

  // already running?
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
    if (pid && pidAlive(pid)) {
      console.log('\n  tray companion is already running ' + grey('(praxis tray --stop to stop it)') + '\n');
      return;
    }
  } catch {
    /* not running */
  }

  try {
    fs.rmSync(pidFile, { force: true });
  } catch {
    /* fine */
  }
  // Launch through a throwaway PowerShell + Start-Process: the host ends up
  // fully detached from this console (node's `detached` flag is unreliable
  // for hidden WinForms hosts).
  const quoted = psArgs.map((a) => `'${String(a).replace(/'/g, "''")}'`).join(',');
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `Start-Process powershell.exe -ArgumentList ${quoted} -WindowStyle Hidden`],
    { stdio: 'ignore' },
  );

  // the host writes its own real pid; wait briefly to confirm liftoff
  let confirmed = false;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
      if (pid && pidAlive(pid)) {
        confirmed = true;
        break;
      }
    } catch {
      /* not yet */
    }
  }
  if (!confirmed) {
    console.log('\n  ' + amber('!') + ' tray companion did not report back — try ' + bold('praxis tray --once') + ' to debug.\n');
    return;
  }

  console.log('\n  ' + rose('✦') + ' ' + bold('tray companion is live') + ' — look for the axolotl by the clock.');
  console.log('    ' + grey('its emotion = your session: ') + sage('idle') + grey(' · ') + amber('warning') + grey(' · limit · switching · restored'));
  console.log('    ' + dim('praxis tray --stop  when you want it gone.') + '\n');
}
