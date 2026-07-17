// praxis recap — catch me up on this project, in the terminal. The same brief
// /praxis-recap gives inside Claude: the durable project facts plus the most
// recent session notes, newest first.

import fs from 'node:fs';
import { projectPaths } from '../lib/paths.js';
import { readMemory } from '../lib/memory.js';
import { extractBrief, extractRecentEntries } from '../lib/handoff.js';
import { miniHeader, bold, grey, rose, sage } from '../lib/ui.js';

export function recap() {
  const p = projectPaths();
  if (!fs.existsSync(p.memoryFile)) {
    console.log(`\n  No PRAXIS memory here yet — nothing to recap.\n  Run ${bold('npx praxis-memory')} first; after a session or two there will be a story to tell.\n`);
    process.exitCode = 1;
    return;
  }

  const memory = readMemory(p.memoryFile);
  const brief = extractBrief(memory);
  const entries = extractRecentEntries(memory, 3);

  console.log('\n  ' + miniHeader('', 'recap') + '\n');
  console.log('  ' + bold('The project, as PRAXIS remembers it'));
  if (brief) {
    for (const line of brief.split('\n')) console.log('  ' + line);
  } else {
    console.log('  ' + grey('(No project summary saved yet — run /praxis-save inside Claude Code once.)'));
  }

  console.log('\n  ' + bold('Recent sessions') + grey('  (newest first)'));
  if (entries.length) {
    for (const e of entries) {
      const [head, ...rest] = e.split('\n');
      console.log('\n  ' + sage('●') + ' ' + head.replace(/^### /, ''));
      for (const line of rest) console.log('    ' + line);
    }
  } else {
    console.log('  ' + grey('(No sessions logged yet.)'));
  }
  console.log('\n  ' + grey('Full memory: ') + rose('.praxis/memory.md') + '\n');
}
