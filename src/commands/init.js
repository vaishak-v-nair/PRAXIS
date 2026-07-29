import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { TELEMETRY_ENDPOINT, telemetryState, setTelemetry } from '../lib/telemetry.js';
import { projectPaths } from '../lib/paths.js';
import { ensureMemory } from '../lib/memory.js';
import { patchClaudeMd } from '../lib/claudemd.js';
import { patchSettings, resolveHookScope, contributorCount, ignoreLocalSettings } from '../lib/settings.js';
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

  // ── the hooks, and WHOSE machine they run on ────────────────────────────
  // These hooks run `npx -y praxis-memory` at the end of every session. Written
  // into the committed settings file, that means every teammate fetches and
  // executes a package from the network without ever having agreed to it. So
  // the private file is the default and the shared one is a deliberate answer
  // to a question (D85). Existing installs keep whichever file they already use.
  fs.mkdirSync(p.claudeDir, { recursive: true });
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  let scope = resolveHookScope(p.root, { interactive });

  if (scope.ask) {
    const n = contributorCount(p.root);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise((resolve) =>
      rl.question(
        '\n  ' +
          bold('This repo has ' + n + ' contributors. Who are these hooks for?') +
          '\n' +
          grey('  PRAXIS captures each session by running `npx -y praxis-memory` when it ends.') +
          '\n\n' +
          '  ' +
          rose('[1] Just me') +
          grey('  (default) — .claude/settings.local.json, gitignored. Nobody else is affected.') +
          '\n' +
          '  ' +
          rose('[2] Whole project') +
          grey(' — .claude/settings.json, committed. Teammates then get memory and') +
          '\n' +
          grey('                       receipts automatically, and their sessions will run npx too.') +
          '\n\n  Choose [1/2]: ',
        resolve,
      ),
    );
    rl.close();
    if (String(ans).trim() === '2') {
      scope = { file: p.settingsFile, scope: 'project', ask: false, reason: 'you chose the whole project' };
    }
  }

  const set = patchSettings(scope.file);
  const where = scope.scope === 'local' ? '.claude/settings.local.json' : '.claude/settings.json';
  if (scope.scope === 'local') {
    // The ignore rule is part of choosing "just me" — a personal settings file
    // that gets committed is precisely the thing this split prevents.
    try {
      ignoreLocalSettings(p.root);
    } catch {
      /* no git, or an unwritable .gitignore — the hooks still work */
    }
  }
  done.push(
    set.already
      ? `${where} (hooks already present)`
      : scope.scope === 'local'
        ? `${where} — capture on Stop · snapshot before compact · tray on SessionStart ${grey('(just you — gitignored)')}`
        : `${where} — capture on Stop · snapshot before compact · tray on SessionStart ${grey('(whole project — teammates included)')}`,
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
    'praxis-doctor.md',
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
  // The conversion bridge (D77): someone who has never seen a receipt is one
  // command away from holding one. This line retires itself the moment a real
  // receipt exists, so it never nags an established install.
  let hasReceipt = false;
  try {
    hasReceipt = fs.existsSync(p.receiptsDir) && fs.readdirSync(p.receiptsDir).some((f) => f.endsWith('.jsonl'));
  } catch {
    /* no receipts dir yet */
  }
  if (!hasReceipt) {
    console.log(`
  ${bold('See what this actually produces — right now, in one minute:')}
  ${rose(`${c} demo`)}  ${grey('a real recorded session, sealed into a receipt on your disk.')}
  ${grey('No agent needed, no account, no network.')}`);
  }

  console.log(`
  ${bold('Next steps')}
  ${grey('1.')} Open this project in Claude Code ${bold('(restart it if it was already open)')} —
     your memory and the / commands load at session start, not mid-session.
  ${grey('2.')} ${bold('Claude Code will ask once')} whether to enable the ${bold('praxis')} tools (the
     .mcp.json this setup just wrote). Say yes — that's what lets the AI
     check its own receipt without you typing anything.
  ${grey('3.')} End a session and PRAXIS logs it — and seals a signed receipt of what
     the AI actually did. ${bold(`${c} receipt`)} shows the proof.
  ${grey('4.')} ${bold(`${c} status`)} any time — memory, session health, latest receipt verdict.

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
