// praxis forget "<text>" — remove outdated or wrong lines from project memory,
// from the terminal. Shows every matching line first and asks before deleting;
// non-interactive runs need --yes, because deleting memory silently is exactly
// the kind of thing PRAXIS exists to prevent.

import fs from 'node:fs';
import readline from 'node:readline';
import { projectPaths } from '../lib/paths.js';
import { readMemory } from '../lib/memory.js';
import { amber, sage, bold, grey, rose } from '../lib/ui.js';

export async function forget(args = []) {
  const yes = args.includes('--yes') || args.includes('-y');
  const needle = args.filter((a) => !a.startsWith('-')).join(' ').trim();
  const p = projectPaths();

  if (!fs.existsSync(p.memoryFile)) {
    console.log(`\n  No PRAXIS memory here yet — nothing to forget.\n`);
    process.exitCode = 1;
    return;
  }
  if (!needle) {
    console.log(`\n  ${bold('praxis forget "<text>"')} — remove memory lines containing that text.\n
  Shows every match and asks before deleting. ${grey('Add --yes to skip the question.')}\n`);
    process.exitCode = 1;
    return;
  }

  const content = readMemory(p.memoryFile);
  const lines = content.split('\n');
  const hay = needle.toLowerCase();
  const hits = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => line.toLowerCase().includes(hay) && !line.startsWith('#') && !line.startsWith('<!--'));

  if (!hits.length) {
    console.log(`\n  Nothing in memory matches ${bold('"' + needle + '"')}. Nothing was changed.\n`);
    return;
  }

  console.log(`\n  ${amber('!')} ${bold(`${hits.length} matching line${hits.length === 1 ? '' : 's'} in .praxis/memory.md:`)}\n`);
  for (const { line } of hits) console.log('    ' + rose('−') + ' ' + line.trim().slice(0, 100));

  let go = yes;
  if (!go && process.stdin.isTTY && process.stdout.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise((r) => rl.question(`\n  Delete ${hits.length === 1 ? 'this line' : 'these lines'}? [y/N] `, r));
    rl.close();
    go = /^y(es)?$/i.test(String(ans).trim());
  } else if (!go) {
    console.log(`\n  Not a terminal — re-run with ${bold('--yes')} to confirm the delete. Nothing was changed.\n`);
    process.exitCode = 1;
    return;
  }

  if (!go) {
    console.log('\n  Kept everything. Nothing was changed.\n');
    return;
  }

  const drop = new Set(hits.map((h) => h.i));
  fs.writeFileSync(p.memoryFile, lines.filter((_, i) => !drop.has(i)).join('\n'));
  console.log(`\n  ${sage('✓')} Forgotten — ${hits.length} line${hits.length === 1 ? '' : 's'} removed from project memory.\n`);
}
