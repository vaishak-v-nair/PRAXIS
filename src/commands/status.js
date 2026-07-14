import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPaths } from '../lib/paths.js';
import { readMemory } from '../lib/memory.js';
import { banner, bigBanner, sage, amber, red, rose, bold, grey, dim, timeAgo } from '../lib/ui.js';

function pkgVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

export function status() {
  const p = projectPaths();
  if (!fs.existsSync(p.memoryFile)) {
    console.log('\n' + banner(pkgVersion()) + '\n');
    console.log('  PRAXIS is not set up in this directory yet.');
    console.log('  Run ' + bold('npx praxis-memory') + ' to set it up.\n');
    return;
  }
  const content = readMemory(p.memoryFile);
  const bytes = Buffer.byteLength(content);
  const entries = (content.match(/^### /gm) || []).length;
  const stat = fs.statSync(p.memoryFile);

  let cap = 16384;
  try {
    cap = JSON.parse(fs.readFileSync(p.configFile, 'utf8')).maxLogBytes || cap;
  } catch {
    /* default */
  }
  const fill = bytes / cap;
  const health =
    fill < 0.6
      ? sage('●') + ' healthy'
      : fill < 0.9
        ? amber('●') + ' filling up'
        : red('●') + ' near the cap';

  console.log('\n' + bigBanner(pkgVersion(), [grey((bytes / 1024).toFixed(1) + ' KB · ' + health)]) + '\n');
  console.log('  ' + grey('memory   ') + path.relative(p.root, p.memoryFile));
  console.log(
    '  ' +
      grey('size     ') +
      `${(bytes / 1024).toFixed(1)} KB · ${entries} session entr${entries === 1 ? 'y' : 'ies'}`,
  );
  console.log('  ' + grey('updated  ') + timeAgo(stat.mtime));
  console.log('  ' + grey('state    ') + health);
  console.log('\n  ' + dim('Loaded into Claude Code automatically via the PRAXIS block in CLAUDE.md.'));
  console.log('  ' + dim('Inside a session, type ') + rose('/praxis-status') + dim(' or ') + rose('/praxis-save') + dim('.') + '\n');
}
