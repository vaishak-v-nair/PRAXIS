import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectPaths } from '../lib/paths.js';
import { praxisCmd } from '../lib/runner.js';
import { parsePidFile, isHostCommandLine, shouldRestage } from '../lib/tray-host.js';
import { resolveHookScope, setTrayHook } from '../lib/settings.js';
import { sage, amber, red, blue, gold, rose, bold, grey, dim } from '../lib/ui.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRAY_SRC = path.join(__dirname, '..', 'tray');
const STATES = ['idle', 'warning', 'limit', 'switching', 'restored', 'happy'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pkgVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(pidFile) {
  try {
    return parsePidFile(fs.readFileSync(pidFile, 'utf8'));
  } catch {
    return 0;
  }
}

/**
 * The command line of a live process, or '' when it cannot be read.
 *
 * On Windows this is deliberately two stages. `tasklist` is a native binary and
 * answers in tens of milliseconds, and a recycled pid is almost never
 * powershell.exe, so the cheap check rejects nearly every impostor. Only a pid
 * that really is a PowerShell process costs the slower CIM query — and that
 * query is the only thing that can tell OUR host from any other PowerShell on
 * the machine.
 */
function commandLineOf(pid) {
  if (process.platform === 'win32') {
    try {
      const row = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { windowsHide: true,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      if (!/^"powershell\.exe"/i.test(row.trim())) return '';
    } catch {
      return ''; // cannot tell -> caller treats it as not ours
    }
    try {
      return execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
        { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
    } catch {
      return '';
    }
  }
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Is this pid actually THIS project's tray host?
 *
 * Everything downstream of a `true` here is destructive, so the answer is false
 * whenever it cannot be proven. A pidfile survives the host that wrote it, and
 * Windows reuses pids, so "the number in the file is alive" was never evidence
 * of anything — acting on it force-killed unrelated process trees.
 */
function isOurHost(pid, root) {
  return isHostCommandLine(commandLineOf(pid), root);
}

/**
 * Remember, past the end of this terminal, whether this project wants a tray.
 *
 * The tray is opt-in per project as of 0.11.1, and an opt-in that expires when
 * the session ends is not one: `praxis tray` has to still be true tomorrow, and
 * `--stop` has to mean stopped rather than stopped-until-SessionStart. So both
 * write the config flag AND add or remove the hook that restarts it.
 */
function setTrayPreference(p, on) {
  try {
    const cfg = JSON.parse(fs.readFileSync(p.configFile, 'utf8'));
    if (cfg.tray !== on) {
      cfg.tray = on;
      fs.writeFileSync(p.configFile, JSON.stringify(cfg, null, 2) + '\n');
    }
  } catch {
    /* no config here yet — nothing to remember against */
  }
  try {
    setTrayHook(resolveHookScope(p.root, { interactive: false }).file, on);
  } catch {
    /* unwritable settings; the config flag still holds for explicit runs */
  }
}

/** Has this project actually asked for a tray? Silence means no, since 0.11.1. */
function trayOptedIn(configFile) {
  try {
    return JSON.parse(fs.readFileSync(configFile, 'utf8')).tray === true;
  } catch {
    return false;
  }
}

function readStagedMeta(trayDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(trayDir, 'staged.json'), 'utf8'));
    return m && typeof m === 'object' ? m : null;
  } catch {
    return null;
  }
}

function writeStagedMeta(trayDir, meta) {
  try {
    fs.writeFileSync(path.join(trayDir, 'staged.json'), JSON.stringify(meta, null, 2) + '\n');
  } catch {
    /* the tray still works without its stamp; the next run restages once */
  }
}

/**
 * Ask a Windows host to retire itself, and only force it if it will not.
 *
 * The host's ONE cleanup path is $doQuit — Visible=false, Dispose(), Exit —
 * and `taskkill /F` delivers no WM_CLOSE, so that path never ran and
 * Shell_NotifyIcon(NIM_DELETE) was never sent. The shell then keeps the icon
 * registered against a dead owner, which is where the extra axolotls came
 * from: one orphan per restart. The host watches for this sentinel file and
 * quits properly when it appears.
 */
async function stopWindowsHost(trayDir, pid, { timeoutMs = 6000 } = {}) {
  const stopFile = path.join(trayDir, 'stop.request');
  let graceful = false;
  try {
    fs.writeFileSync(stopFile, String(Date.now()));
    for (let waited = 0; waited < timeoutMs; waited += 150) {
      await sleep(150);
      if (!pidAlive(pid)) {
        graceful = true;
        break;
      }
    }
  } catch {
    /* fall through to the hard stop */
  }
  if (!graceful) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  }
  try {
    fs.rmSync(stopFile, { force: true });
  } catch {
    /* fine */
  }
  return graceful;
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

  if (args.includes('--stop')) {
    const pid = readPid(pidFile);
    if (pid && pidAlive(pid)) {
      if (isOurHost(pid, p.root)) {
        // SIGTERM, never SIGKILL: AppKit tears the status item down on the way
        // out, which is the macOS equivalent of the NIM_DELETE the Windows host
        // owes the shell.
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          /* already gone */
        }
        console.log('\n  ' + sage('✓') + ' tray companion stopped.\n');
      } else {
        console.log('\n  ' + amber('!') + ' the pid on file belongs to something else — leaving it alone.');
        console.log('    ' + dim('a stale pidfile plus a reused pid; clearing the file.') + '\n');
      }
    } else {
      console.log('\n  tray companion is not running here.\n');
    }
    // Stopped means stopped. Without this the next SessionStart hook would put
    // it straight back and the command would have accomplished nothing.
    setTrayPreference(p, false);
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
  // Opt-in, and silence means no. This used to be "start unless explicitly
  // disabled", which handed an axolotl to every project anyone ever ran `init`
  // in — five projects, five icons, none of them asked for. Nothing starts
  // automatically now until somebody types `praxis tray` once.
  if (ensure && !trayOptedIn(p.configFile)) return;

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

  const shipped = fs.readFileSync(path.join(TRAY_SRC, 'tray-mac.js'));
  const incoming = { version: pkgVersion(), sha256: sha256(shipped) };
  const staged = fs.existsSync(path.join(trayDir, 'tray-mac.js')) ? readStagedMeta(trayDir) : null;
  const restage = shouldRestage({ staged, incoming, explicit: !ensure });

  const pid = readPid(pidFile);
  if (pid && pidAlive(pid)) {
    if (!isOurHost(pid, p.root)) {
      // a stale pidfile pointing at a recycled pid. It is emphatically not
      // ours, so it is not killed — but it must not be mistaken for a running
      // tray either, or the tray silently never starts again in this project.
      try {
        fs.rmSync(pidFile, { force: true });
      } catch {
        /* fine */
      }
    } else if (!restage) {
      if (!ensure) {
        console.log('\n  tray companion is already running ' + grey(`(${praxisCmd()} tray --stop to stop it)`) + '\n');
      }
      return;
    } else {
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
      await sleep(300);
    }
  }

  // stage host + state bridge + icons
  const iconSrc = path.join(TRAY_SRC, 'icons-mac');
  if (!fs.existsSync(iconSrc)) {
    if (ensure) return;
    console.log('\n  ' + amber('!') + ' the macOS tray icons are missing from this install.\n');
    return;
  }
  fs.mkdirSync(path.join(trayDir, 'icons-mac'), { recursive: true });
  if (restage) {
    fs.copyFileSync(path.join(TRAY_SRC, 'tray-mac.js'), path.join(trayDir, 'tray-mac.js'));
    writeStagedMeta(trayDir, { ...incoming, stagedAt: new Date().toISOString() });
  }
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
    { windowsHide: true, detached: true, stdio: 'ignore' },
  );
  child.unref();

  let confirmed = false;
  for (let i = 0; i < 24; i++) {
    await sleep(150);
    const started = readPid(pidFile);
    if (started && pidAlive(started)) {
      confirmed = true;
      break;
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

  // Typing the command IS the opt-in, and it has to outlive this terminal.
  setTrayPreference(p, true);
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
  console.log('    ' + dim('it comes back on its own each session, in this project only.'));
  console.log('    ' + rose(`${praxisCmd()} tray --stop`) + dim('  turns that off again.') + '\n');
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
    const pid = readPid(pidFile);
    if (pid && pidAlive(pid)) {
      if (isOurHost(pid, p.root)) {
        const graceful = await stopWindowsHost(trayDir, pid);
        console.log('\n  ' + sage('✓') + ' tray companion stopped.' + (graceful ? '' : dim('  (it had to be forced)')) + '\n');
      } else {
        // The pidfile outlived its host and Windows handed the number to
        // something else. Killing it would have taken that process and its
        // whole tree down.
        console.log('\n  ' + amber('!') + ' the pid on file is not a PRAXIS tray — leaving it alone.');
        console.log('    ' + dim('stale pidfile plus a reused pid; clearing the file instead.') + '\n');
      }
    } else {
      console.log('\n  tray companion is not running here.\n');
    }
    // Stopped means stopped. Without this the next SessionStart hook would put
    // it straight back and the command would have accomplished nothing.
    setTrayPreference(p, false);
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
  // Opt-in, and silence means no. This used to be "start unless explicitly
  // disabled", which handed an axolotl to every project anyone ever ran `init`
  // in — five projects, five icons, none of them asked for. Nothing starts
  // automatically now until somebody types `praxis tray` once.
  if (ensure && !trayOptedIn(p.configFile)) return;

  // A running host keeps executing the STAGED copy of tray.ps1 forever, so
  // upgrades have to be able to replace it. What they must NOT do is replace it
  // on every invocation: comparing bytes alone meant a global `praxis` and an
  // `npx -y praxis-memory` took turns overwriting each other, one kill and one
  // orphaned tray icon per session start. The stamp on disk records WHICH
  // version staged the script, so an automatic run only ever moves forward.
  const shipped = fs.readFileSync(path.join(TRAY_SRC, 'tray.ps1'));
  const incoming = { version: pkgVersion(), sha256: sha256(shipped) };
  const staged = fs.existsSync(path.join(trayDir, 'tray.ps1')) ? readStagedMeta(trayDir) : null;
  const restage = shouldRestage({ staged, incoming, explicit: !ensure });

  if (!args.includes('--once')) {
    const pid = readPid(pidFile);
    if (pid && pidAlive(pid)) {
      if (!isOurHost(pid, p.root)) {
        if (!ensure) {
          console.log('\n  ' + amber('!') + ' the pid on file is not a PRAXIS tray — leaving that process alone.');
          console.log('    ' + dim('starting a fresh host for this project.'));
        }
        try {
          fs.rmSync(pidFile, { force: true });
        } catch {
          /* fine */
        }
      } else if (!restage) {
        if (!ensure) {
          console.log('\n  tray companion is already running ' + grey(`(${praxisCmd()} tray --stop to stop it)`) + '\n');
        }
        return;
      } else {
        if (!ensure) console.log('\n  tray companion was running an older version — restarting it fresh.');
        await stopWindowsHost(trayDir, pid);
        try {
          fs.rmSync(pidFile, { force: true });
        } catch {
          /* fine */
        }
        // give the dying host a beat to release its file handles before restaging
        await sleep(400);
      }
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
  if (restage) {
    safeCopy(path.join(TRAY_SRC, 'tray.ps1'), path.join(trayDir, 'tray.ps1'));
    writeStagedMeta(trayDir, { ...incoming, stagedAt: new Date().toISOString() });
  }
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
    const out = execFileSync('powershell.exe', [...psArgs, '-Once'], { windowsHide: true, encoding: 'utf8' });
    process.stdout.write(out);
    return;
  }

  try {
    fs.rmSync(pidFile, { force: true });
  } catch {
    /* fine */
  }
  try {
    // a stop request left by a crash would retire the host we are about to start
    fs.rmSync(path.join(trayDir, 'stop.request'), { force: true });
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
    { windowsHide: true, stdio: 'ignore' },
  );

  // the host writes its own real pid; wait briefly to confirm liftoff
  let confirmed = false;
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    const started = readPid(pidFile);
    if (started && pidAlive(started)) {
      confirmed = true;
      break;
    }
  }
  if (!confirmed) {
    console.log('\n  ' + amber('!') + ' tray companion did not report back — try ' + bold(`${praxisCmd()} tray --once`) + ' to debug.\n');
    return;
  }

  // Typing the command IS the opt-in, and it has to outlive this terminal.
  setTrayPreference(p, true);
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
  console.log('    ' + dim('it comes back on its own each session, in this project only.'));
  console.log('    ' + rose(`${praxisCmd()} tray --stop`) + dim('  turns that off again.') + '\n');
}
