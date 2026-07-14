import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPaths } from '../lib/paths.js';
import { ensureMemory } from '../lib/memory.js';
import { patchClaudeMd } from '../lib/claudemd.js';
import { patchSettings } from '../lib/settings.js';
import { bigBanner, sage, rose, bold, grey, dim } from '../lib/ui.js';
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
  const done = [];

  // .praxis/ memory + config
  fs.mkdirSync(p.praxisDir, { recursive: true });
  ensureMemory(p.memoryFile);
  if (!fs.existsSync(p.configFile)) {
    fs.writeFileSync(
      p.configFile,
      JSON.stringify({ capture: true, maxLogBytes: 16384, redact: true }, null, 2) + '\n',
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
      ? '.claude/settings.json (Stop hook already present)'
      : '.claude/settings.json (Stop hook installed)',
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

  ensureGitignore(p.root);

  console.log('\n' + banner(pkgVersion(), slashHelp()) + '\n');
  console.log('  ' + bold('Memory is set up.') + '\n');
  for (const d of done) console.log('  ' + sage('✓') + ' ' + d);
  console.log(`
  ${bold('Next steps')}
  ${grey('1.')} Open this project in Claude Code — your memory loads automatically.
  ${grey('2.')} End a session and PRAXIS logs it. Type ${rose('/praxis-save')} for a rich summary.
  ${grey('3.')} ${bold('praxis status')} — see what it remembers, any time.

  ${dim('tip: auto-capture needs `praxis` on your PATH (npm i -g praxis-memory);')}
  ${dim('     without it, /praxis-save covers you.')}
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
