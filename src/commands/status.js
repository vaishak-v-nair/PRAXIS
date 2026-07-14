import fs from 'node:fs';
import { projectPaths } from '../lib/paths.js';
import { readMemory } from '../lib/memory.js';

export function status() {
  const p = projectPaths();
  if (!fs.existsSync(p.memoryFile)) {
    console.log('PRAXIS is not initialized in this directory.\nRun:  praxis init');
    return;
  }
  const content = readMemory(p.memoryFile);
  const bytes = Buffer.byteLength(content);
  const entries = (content.match(/^### /gm) || []).length;
  const stat = fs.statSync(p.memoryFile);

  console.log('PRAXIS memory');
  console.log(`  file:          ${p.memoryFile}`);
  console.log(`  size:          ${(bytes / 1024).toFixed(1)} KB`);
  console.log(`  session log:   ${entries} entr${entries === 1 ? 'y' : 'ies'}`);
  console.log(`  last updated:  ${stat.mtime.toISOString()}`);
  console.log('\nLoaded into Claude Code automatically via the PRAXIS block in CLAUDE.md.');
}
