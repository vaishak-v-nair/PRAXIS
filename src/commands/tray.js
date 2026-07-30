import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectPaths } from '../lib/paths.js';
import { praxisCmd } from '../lib/runner.js';
import { sage, amber, red, blue, gold, rose, bold, grey, dim } from '../lib/ui.js';

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

/**
 * The macOS companion. Same contract as the Windows host — stage into the
 * project, launch detached, host writes its own pid, --stop kills it, --once
 * prints the computed state and exits — but the host is JXA driving AppKit
 * instead of PowerShell driving WinForms, because both are the scripting
 * runtime their OS already ships and PRAXIS adds no runtime dependencies.
 */
async function trayMac(args, ensure) {
  const p = projectPaths();
  const trayDir = path.join(p.praxisDir, 'tray');
  const pidFile = path.join(trayDir, 'tray.pid');
  const stateScript = path.join(trayDir, 'tray-state.mjs');
  const libDir = path.join(__dirname, '..', 'lib');

  if (args.includes('--stop')) {
    let pid = 0;
    try {
      pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
    } catch {
      /* no pid file */
    }
    if (pid && pidAlive(pid)) {
      try {
        process.kill(pid, 'SIGTERM');
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
    if (ensure) return;
    console.log('\n  PRAXIS is not set up here yet. Run ' + bold('npx praxis-memory') + ' first.\n');
    return;
  }
  if (ensure) {
    try {
      const cfg = JSON.parse(fs.readFileSync(p.configFile, 'utf8'));
      if (cfg.tray === false) return;
    } catch {
      /* default on */
    }
  }

  // --once: compute the state in the foreground and print it. No AppKit, no
  // menu bar — this is the debug path, and it is the one thing that can be
  // verified on any machine.
  if (args.includes('--once')) {
    const { computeTrayState } = await import('../lib/tray-state.js');
    const s = computeTrayState(p.root, { uptimeMs: Infinity });
    console.log(
      `state=${s.name} label=${s.label} kb=${s.kb} entries=${s.entries} ` +
        `session=${s.sess ? s.sess.pct + '% (' + s.sess.level + ')' : 'none'} ` +
        `receipt=${s.receipt ? s.receipt.verdict : 'none'}`,
    );
    return;
  }

  // Already running the current version? Leave it alone.
  let stagedFresh = false;
  try {
    stagedFresh = fs
      .readFileSync(path.join(trayDir, 'tray-mac.js'))
      .equals(fs.readFileSync(path.join(TRAY_SRC, 'tray-mac.js')));
  } catch {
    /* nothing staged yet */
  }
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
    if (pid && pidAlive(pid)) {
      if (stagedFresh) {
        if (!ensure) {
          console.log('\n  tray companion is already running ' + grey(`(${praxisCmd()} tray --stop to stop it)`) + '\n');
        }
        return;
      }
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
      try {
        fs.rmSync(pidFile, { force: true });
      } catch {
        /* fine */
      }
      if (!ensure) console.log('\n  tray companion was running an older version — restarting it fresh.');
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch {
    /* not running */
  }

  // stage host + state bridge + icons
  const iconSrc = path.join(TRAY_SRC, 'icons-mac');
  if (!fs.existsSync(iconSrc)) {
    if (ensure) return;
    console.log('\n  ' + amber('!') + ' the macOS tray icons are missing from this install.\n');
    return;
  }
  fs.mkdirSync(path.join(trayDir, 'icons-mac'), { recursive: true });
  fs.copyFileSync(path.join(TRAY_SRC, 'tray-mac.js'), path.join(trayDir, 'tray-mac.js'));
  fs.copyFileSync(path.join(TRAY_SRC, 'tray-state.mjs'), stateScript);
  for (const f of fs.readdirSync(iconSrc)) {
    fs.copyFileSync(path.join(iconSrc, f), path.join(trayDir, 'icons-mac', f));
  }

  try {
    fs.rmSync(pidFile, { force: true });
  } catch {
    /* fine */
  }

  // Detach through nohup so the host outlives this process and this terminal.
  // execFileSync with a detached spawn is not enough: osascript inherits the
  // session and dies with it.
  const { spawn } = await import('node:child_process');
  const child = spawn(
    '/usr/bin/osascript',
    [
      '-l',
      'JavaScript',
      path.join(trayDir, 'tray-mac.js'),
      p.root,
      path.join(trayDir, 'icons-mac'),
      stateScript,
      process.execPath,
      pidFile,
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();

  let confirmed = false;
  for (let i = 0; i < 24; i++) {
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
    if (ensure) return;
    console.log(
      '\n  ' + amber('!') + ' tray companion did not report back — try ' + bold(`${praxisCmd()} tray --once`) + ' to see the state it would show.',
    );
    console.log('    macOS may also be asking for permission the first time; check System Settings → Privacy.\n');
    return;
  }

  console.log('\n  ' + rose('✦') + ' ' + bold('tray companion is live') + ' — look for the axolotl in the menu bar.');
  console.log(
    '    ' +
      grey('its emotion = your session: ') +
      sage('idle') + grey(' · ') +
      amber('warning') + grey(' · ') +
      red('limit') + grey(' · ') +
      blue('switching') + grey(' · ') +
      gold('restored'),
  );
  console.log('    ' + rose(`${praxisCmd()} tray --stop`) + dim('  when you want it gone.') + '\n');
}

export async function tray(args = []) {
  // Tests and CI set this expecting it to mean something — and until it did,
  // every `init` test on a Windows runner quietly spawned a real NotifyIcon
  // host into the CI session. An escape hatch that is documented but ignored
  // is worse than none.
  if (process.env.PRAXIS_SKIP_TRAY === '1') return;
  const ensure = args.includes('--ensure'); // quiet: start if absent, silent if present
  if (process.platform === 'darwin') return trayMac(args, ensure);
  if (process.platform !== 'win32') {
    if (ensure) return;
    console.log('\n  The tray companion ships for ' + bold('Windows') + ' and ' + bold('macOS') + ' today.');
    console.log('  Linux is next on the roadmap — until then, ' + bold(`${praxisCmd()} status`) + '');
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
    if (ensure) return;
    console.log('\n  PRAXIS is not set up here yet. Run ' + bold('npx praxis-memory') + ' first.\n');
    return;
  }
  if (ensure) {
    try {
      const cfg = JSON.parse(fs.readFileSync(p.configFile, 'utf8'));
      if (cfg.tray === false) return;
    } catch {
      /* default on */
    }
  }

  // A running host keeps executing the STAGED copy of tray.ps1 forever —
  // without this check, upgrades never reach the tray until someone happens
  // to run --stop. Compare shipped vs staged: same → leave the host alone;
  // different → restart it on the new version (silently under --ensure, so
  // upgrades ride the SessionStart hook into every project).
  let stagedFresh = false;
  try {
    stagedFresh = fs
      .readFileSync(path.join(trayDir, 'tray.ps1'))
      .equals(fs.readFileSync(path.join(TRAY_SRC, 'tray.ps1')));
  } catch {
    /* nothing staged yet */
  }

  if (!args.includes('--once')) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
      if (pid && pidAlive(pid)) {
        if (stagedFresh) {
          if (!ensure) {
            console.log('\n  tray companion is already running ' + grey(`(${praxisCmd()} tray --stop to stop it)`) + '\n');
          }
          return;
        }
        try {
          execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
        } catch {
          /* already gone */
        }
        try {
          fs.rmSync(pidFile, { force: true });
        } catch {
          /* fine */
        }
        if (!ensure) console.log('\n  tray companion was running an older version — restarting it fresh.');
        // give the dying host a beat to release its file handles before restaging
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch {
      /* not running */
    }
  }

  // stage the host script + icons + panel animations into the project.
  // A copy can hit EBUSY if a dying host still holds a file — if the file is
  // already there, that is fine; the next clean start restages it.
  const safeCopy = (src, dest) => {
    try {
      fs.copyFileSync(src, dest);
    } catch (e) {
      if (!fs.existsSync(dest)) throw e;
    }
  };
  fs.mkdirSync(path.join(trayDir, 'icons'), { recursive: true });
  fs.mkdirSync(path.join(trayDir, 'anim'), { recursive: true });
  safeCopy(path.join(TRAY_SRC, 'tray.ps1'), path.join(trayDir, 'tray.ps1'));
  for (const s of STATES) {
    for (const suffix of ['', '2']) {
      safeCopy(
        path.join(TRAY_SRC, 'icons', `${s}${suffix}.ico`),
        path.join(trayDir, 'icons', `${s}${suffix}.ico`),
      );
    }
    safeCopy(path.join(TRAY_SRC, 'anim', `${s}.gif`), path.join(trayDir, 'anim', `${s}.gif`));
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
    '-AnimDir',
    path.join(trayDir, 'anim'),
    '-PidFile',
    pidFile,
  ];

  if (args.includes('--once')) {
    // debug/verify mode: compute state once in the foreground and exit
    const out = execFileSync('powershell.exe', [...psArgs, '-Once'], { encoding: 'utf8' });
    process.stdout.write(out);
    return;
  }

  try {
    fs.rmSync(pidFile, { force: true });
  } catch {
    /* fine */
  }
  // Launch through a throwaway PowerShell + Start-Process: the host ends up
  // fully detached from this console (node's `detached` flag is unreliable
  // for hidden WinForms hosts).
  // Start-Process joins -ArgumentList items with spaces WITHOUT quoting them,
  // so any path containing a space (e.g. "E:\AI Coding\project") splits into
  // two arguments and the host dies before writing its pidfile. Args with
  // whitespace therefore carry their own embedded double quotes.
  const quoted = psArgs
    .map((a) => {
      const s = String(a).replace(/'/g, "''");
      return /\s/.test(s) ? `'"${s}"'` : `'${s}'`;
    })
    .join(',');
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
    console.log('\n  ' + amber('!') + ' tray companion did not report back — try ' + bold(`${praxisCmd()} tray --once`) + ' to debug.\n');
    return;
  }

  console.log('\n  ' + rose('✦') + ' ' + bold('tray companion is live') + ' — look for the axolotl by the clock.');
  console.log(
    '    ' +
      grey('its emotion = your session: ') +
      sage('idle') + grey(' · ') +
      amber('warning') + grey(' · ') +
      red('limit') + grey(' · ') +
      blue('switching') + grey(' · ') +
      gold('restored'),
  );
  console.log('    ' + rose(`${praxisCmd()} tray --stop`) + dim('  when you want it gone.') + '\n');
}
