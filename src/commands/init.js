import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPaths } from '../lib/paths.js';
import { ensureMemory } from '../lib/memory.js';
import { patchClaudeMd } from '../lib/claudemd.js';
import { patchSettings } from '../lib/settings.js';
import { bigBanner, miniHeader, sage, rose, bold, grey, dim, dailyQuote } from '../lib/ui.js';
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

  // slash commands
  fs.mkdirSync(p.commandsDir, { recursive: true });
  const slashCmds = [
    'praxis-save.md',
    'praxis-status.md',
    'praxis-remember.md',
    'praxis-forget.md',
    'praxis-recap.md',
  ];
  for (const name of slashCmds) {
    fs.copyFileSync(path.join(TEMPLATES, name), path.join(p.commandsDir, name));
  }
  done.push('.claude/commands — /praxis-save · /praxis-status · /praxis-remember · /praxis-forget · /praxis-recap');

  // user-scope commands: make /praxis-* visible in EVERY project, not just this one
  try {
    const userCmds = path.join(os.homedir(), '.claude', 'commands');
    fs.mkdirSync(userCmds, { recursive: true });
    for (const name of slashCmds) {
      fs.copyFileSync(path.join(TEMPLATES, name), path.join(userCmds, name));
    }
    done.push('~/.claude/commands — the same five, available in every project');
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
  if (!firstRun) {
    console.log('\n  ' + dim('All commands: ') + rose('praxis help') + '\n');
    return;
  }
  console.log(`
  ${bold('Next steps')}
  ${grey('1.')} Open this project in Claude Code — your memory loads automatically.
  ${grey('2.')} End a session and PRAXIS logs it. Type ${rose('/praxis-save')} for a rich summary.
  ${grey('3.')} ${bold('praxis status')} — see what it remembers, any time.
  ${grey('4.')} ${bold('praxis hud')} in a second terminal — watch the session live, in plain English.

  ${dim('If a Claude Code session is already open, restart it (or start a new')}
  ${dim('session) so the / menu picks up the new commands.')}

  ${dim('important: the hooks (auto-capture, snapshots, tray auto-start) call')}
  ${dim('`praxis` by name — install it for real: ')}${bold('npm install -g praxis-memory')}
  ${dim('Without that, /praxis-save still covers you.')}

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
