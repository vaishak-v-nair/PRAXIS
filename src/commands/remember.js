// praxis remember "<fact>" — save a fact or decision into project memory from
// the terminal, no Claude session needed. The slash-command twin
// (/praxis-remember) does the same from inside Claude. The fact lands in the
// `## Project` section — the durable half that never gets trimmed.

import fs from 'node:fs';
import { projectPaths } from '../lib/paths.js';
import { ensureMemory, readMemory } from '../lib/memory.js';
import { redact } from '../lib/redact.js';
import { rose, sage, bold, grey } from '../lib/ui.js';

const LOG_MARKER = '## Session Log';

export function remember(args = []) {
  const fact = args.join(' ').trim();
  const p = projectPaths();

  if (!fs.existsSync(p.praxisDir)) {
    console.log(`\n  No PRAXIS memory here yet. Run ${bold('npx praxis-memory')} first.\n`);
    process.exitCode = 1;
    return;
  }
  if (!fact) {
    console.log(`\n  ${bold('praxis remember "<fact>"')} — save a fact or decision into project memory.\n
  ${grey('Examples')}
  ${rose('praxis remember')} ${grey('"API rate limit is 100/min — batch the sync calls"')}
  ${rose('praxis remember')} ${grey('"we chose SQLite over Postgres: single-user tool, zero setup"')}\n`);
    process.exitCode = 1;
    return;
  }

  ensureMemory(p.memoryFile);
  let content = readMemory(p.memoryFile);
  const entry = `- ${redact(fact)} <!-- ${new Date().toISOString().slice(0, 10)} -->`;

  const idx = content.indexOf(LOG_MARKER);
  if (idx >= 0) {
    // insert at the end of the Project section, just above the Session Log
    content = content.slice(0, idx).trimEnd() + '\n' + entry + '\n\n' + content.slice(idx);
  } else {
    content = content.trimEnd() + '\n' + entry + '\n';
  }
  // a fresh memory file still carries the placeholder — the first real fact replaces it
  content = content.replace(/_\(No project summary yet[^\n]*\n?/, '');
  fs.writeFileSync(p.memoryFile, content);

  console.log(`\n  ${sage('✓')} ${bold('Remembered.')} ${grey('It now loads into every future Claude session here.')}\n  ${grey('“' + redact(fact).slice(0, 70) + (fact.length > 70 ? '…' : '') + '”')}\n`);
}
