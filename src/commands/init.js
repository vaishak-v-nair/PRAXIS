import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { TELEMETRY_ENDPOINT, telemetryState, setTelemetry } from '../lib/telemetry.js';
import { projectPaths } from '../lib/paths.js';
import { ensureMemory } from '../lib/memory.js';
import { patchClaudeMd } from '../lib/claudemd.js';
import { patchSettings } from '../lib/settings.js';
import { patchMcpConfig } from '../lib/mcp/config.js';
import { bigBanner, miniHeader, sage, rose, bold, grey, dim, dailyQuote } from '../lib/ui.js';
import { praxisCmd } from '../lib/runner.js';
import { tray } from './tray.js';
import { readFileSync } from 'node:fs';

function pkgVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(__dirname, '..', 'templates');

export async function init() {
  const p = projectPaths();
  const firstRun = !fs.existsSync(p.memoryFile); // the big welcome is a one-time thing
  const done = [];

  // .praxis/ memory + config
  fs.mkdirSync(p.praxisDir, { recursive: true });
  ensureMemory(p.memoryFile);
  if (!fs.existsSync(p.configFile)) {
    fs.writeFileSync(
      p.configFile,
      JSON.stringify({ capture: true, maxLogBytes: 16384, redact: true, tray: true, overlay: true }, null, 2) + '\n',
    );
  }
  done.push('.praxis/memory.md + config.json');

  // the permanent archive: what rotates out of the working memory lands here,
  // organized and forever — the working file stays small, nothing is lost
  const archiveDir = path.join(p.praxisDir, 'archive');
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(path.join(archiveDir, 'sessions'), { recursive: true });
    fs.writeFileSync(
      path.join(archiveDir, 'README.md'),
      '# PRAXIS Archive\n\n' +
        'Nothing your sessions produce is ever deleted.\n\n' +
        '- `sessions/` — entries moved out of `memory.md` when it reaches its size cap, one file per month, oldest first.\n' +
        '- `../checkpoints/` — full conversation archives written by the checkpoint command.\n\n' +
        'The working memory (`.praxis/memory.md`) stays small so Claude loads fast;\n' +
        'this folder is the long-term record. Point an Obsidian vault at praxis\n' +
        '(`' + praxisCmd() + ' vault <path>`) and the archive is mirrored there too.\n',
    );
    done.push('.praxis/archive — long-term store, nothing ever deleted');
  }

  // CLAUDE.md managed block
  const cmd = patchClaudeMd(p.claudeMd);
  done.push(cmd.existed ? 'CLAUDE.md (PRAXIS block refreshed)' : 'CLAUDE.md (created)');

  // .claude/settings.json Stop hook
  fs.mkdirSync(p.claudeDir, { recursive: true });
  const set = patchSettings(p.settingsFile);
  done.push(
    set.already
      ? '.claude/settings.json (hooks already present)'
      : '.claude/settings.json — capture on Stop · snapshot before compact · tray on SessionStart',
  );

  // .mcp.json — the platform surface. With this, Claude Code hands the model the
  // praxis_* tools automatically: receipts, verify and recall need no command.
  try {
    const mc = patchMcpConfig(p.mcpFile);
    done.push(
      mc.already
        ? '.mcp.json (PRAXIS tools already registered)'
        : '.mcp.json — PRAXIS tools live in Claude Code, no command to type',
    );
  } catch {
    /* MCP registration is best-effort; the CLI + hooks still work without it */
  }

  // slash commands
  fs.mkdirSync(p.commandsDir, { recursive: true });
  const slashCmds = [
    'praxis-save.md',
    'praxis-status.md',
    'praxis-remember.md',
    'praxis-forget.md',
    'praxis-recap.md',
    'praxis-health.md',
    'praxis-switch.md',
    'praxis-feedback.md',
    'praxis-hud.md',
    'praxis-explain.md',
    'praxis-checkpoint.md',
    'praxis-trace.md',
    'praxis-cost.md',
    'praxis-gate.md',
    'praxis-roi.md',
    'praxis-receipt.md',
    'praxis-vault.md',
    'praxis-telemetry.md',
    'praxis-tray.md',
  ];
  for (const name of slashCmds) {
    fs.copyFileSync(path.join(TEMPLATES, name), path.join(p.commandsDir, name));
  }
  done.push(`.claude/commands — ${slashCmds.length} /praxis-* commands, one per praxis command`);

  // user-scope commands: make /praxis-* visible in EVERY project, not just this one
  try {
    const userCmds = path.join(os.homedir(), '.claude', 'commands');
    fs.mkdirSync(userCmds, { recursive: true });
    for (const name of slashCmds) {
      fs.copyFileSync(path.join(TEMPLATES, name), path.join(userCmds, name));
    }
    done.push('~/.claude/commands — the same commands, available in every project');
  } catch {
    /* user scope is best-effort */
  }

  ensureGitignore(p.root);

  if (firstRun) {
    console.log('\n' + bigBanner(pkgVersion()) + '\n');
    console.log('  ' + bold('Memory is set up.') + '\n');
  } else {
    console.log('\n  ' + miniHeader(pkgVersion(), 'init') + '\n');
    console.log('  ' + bold('Already set up — refreshed everything.') + '\n');
  }
  for (const d of done) console.log('  ' + sage('✓') + ' ' + d);

  // the tray companion starts with the very first install — no second command
  let trayWanted = process.platform === 'win32';
  try {
    const cfg = JSON.parse(fs.readFileSync(p.configFile, 'utf8'));
    if (cfg.tray === false) trayWanted = false;
  } catch {
    /* default on */
  }
  if (trayWanted) {
    try {
      await tray([]);
    } catch {
      /* the tray is a bonus, never a blocker */
    }
  }
  // tier-2 consent: one honest question, once, and only when a receiver
  // actually exists — asking consent for a send that can't happen is noise
  if (TELEMETRY_ENDPOINT && process.stdin.isTTY && process.stdout.isTTY && !telemetryState().decided) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise((resolve) =>
      rl.question(
        '\n  Share anonymous usage counts to improve PRAXIS? Never your code,\n' +
          '  never your words — see exactly what with: praxis telemetry show  [y/N] ',
        resolve,
      ),
    );
    rl.close();
    setTelemetry(/^y(es)?$/i.test(String(ans).trim()));
  }

  const c = praxisCmd();
  if (!firstRun) {
    console.log('\n  ' + dim('All commands: ') + rose(`${c} help`) + '\n');
    return;
  }
  console.log(`
  ${bold('Next steps')}
  ${grey('1.')} Open this project in Claude Code — your memory loads automatically.
  ${grey('2.')} End a session and PRAXIS logs it — and seals a signed receipt of what
     the AI actually did. ${bold(`${c} receipt`)} shows the proof.
  ${grey('3.')} ${bold(`${c} status`)} — see what it remembers, any time.
  ${grey('4.')} ${bold(`${c} hud`)} in a second terminal — watch the session live, in plain English.

  ${dim('If a Claude Code session is already open, restart it (or start a new')}
  ${dim('session) so the / menu picks up the new commands.')}

  ${dim('The hooks (auto-capture, snapshots, tray auto-start) run through npx,')}
  ${dim('so they work with no global install. Want the short `praxis` command?')}
  ${dim('Optional: ')}${bold('npm install -g praxis-memory')}

  ${dim('“' + dailyQuote() + '”')}
`);
}

function ensureGitignore(root) {
  const gi = path.join(root, '.gitignore');
  let content = '';
  try {
    content = fs.readFileSync(gi, 'utf8');
  } catch {
    /* none yet */
  }
  if (content.includes('.praxis/')) return;
  const add =
    '# PRAXIS local memory (may contain project details — commit only after review)\n.praxis/\n';
  const next = content.trim() ? content.trimEnd() + '\n\n' + add : add;
  fs.writeFileSync(gi, next);
}
