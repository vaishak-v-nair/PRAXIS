import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPaths } from '../lib/paths.js';
import { ensureMemory } from '../lib/memory.js';
import { patchClaudeMd } from '../lib/claudemd.js';
import { patchSettings } from '../lib/settings.js';

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
  for (const name of ['praxis-save.md', 'praxis-status.md']) {
    fs.copyFileSync(path.join(TEMPLATES, name), path.join(p.commandsDir, name));
  }
  done.push('.claude/commands/praxis-save.md + praxis-status.md');

  ensureGitignore(p.root);

  console.log('\n  PRAXIS initialized.\n');
  for (const d of done) console.log('   + ' + d);
  console.log(`
  Next:
   - Open this project in Claude Code — your memory loads automatically.
   - End a session and PRAXIS logs it. Run  /praxis-save  for a rich summary.
   - Check it anytime:  praxis status

  Auto-capture needs \`praxis\` on your PATH. If it is not, use /praxis-save.
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
