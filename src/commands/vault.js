// praxis vault <path> | off | (show) — connect the project to an Obsidian
// vault. After that, every session and every traced commit writes itself
// into the vault as linked notes; the memory mirrors automatically.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { projectPaths } from '../lib/paths.js';
import { vaultDirFor, vaultPathAllowed, mirrorMemory } from '../lib/vault.js';
import { miniHeader, sage, rose, bold, grey, dim } from '../lib/ui.js';

export function vault(args = []) {
  const p = projectPaths();
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(p.configFile, 'utf8'));
  } catch {
    console.log('\n  Run ' + bold('npx praxis-memory') + ' here first.\n');
    process.exitCode = 1;
    return;
  }
  const sub = args[0];
  console.log('\n  ' + miniHeader('', 'vault').replace(' v', '') + '\n');

  if (!sub) {
    if (cfg.vault) {
      console.log('  connected  ' + bold(cfg.vault));
      console.log('  ' + dim('Sessions, commits and memory write into ') + grey(path.join('Praxis', path.basename(p.root))) + dim(' automatically.'));
      console.log('  ' + dim('Disconnect: ') + rose('praxis vault off') + '\n');
    } else {
      console.log('  Not connected. Point praxis at your Obsidian vault:');
      console.log('  ' + rose('praxis vault "E:\\path\\to\\your vault"') + '\n');
      console.log('  ' + dim('Then every session and traced commit becomes a linked note —'));
      console.log('  ' + dim('your vault graph shows the history of your AI work.') + '\n');
    }
    return;
  }

  if (sub === 'off') {
    delete cfg.vault;
    fs.writeFileSync(p.configFile, JSON.stringify(cfg, null, 2) + '\n');
    console.log('  ' + sage('✓') + ' vault disconnected — existing notes stay yours.\n');
    return;
  }

  const target = path.resolve(sub);
  if (!fs.existsSync(target)) {
    console.log('  That folder does not exist: ' + target + '\n');
    process.exitCode = 1;
    return;
  }
  if (!vaultPathAllowed(target, os.homedir(), p.root)) {
    console.log('  ' + bold('Vault must live under your home folder or this project.'));
    console.log('  ' + dim(`home: ${os.homedir()}  ·  project: ${p.root}`));
    console.log('  ' + dim('This keeps a cloned project from steering praxis writes elsewhere.') + '\n');
    process.exitCode = 1;
    return;
  }
  cfg.vault = target;
  fs.writeFileSync(p.configFile, JSON.stringify(cfg, null, 2) + '\n');

  // seed the vault right now so the user sees it working immediately
  const project = path.basename(p.root);
  let seeded = false;
  try {
    seeded = mirrorMemory(vaultDirFor(cfg, project), project, fs.readFileSync(p.memoryFile, 'utf8'));
  } catch {
    /* seeding is a bonus */
  }
  console.log('  ' + sage('✓') + ' connected to ' + bold(target));
  if (seeded) console.log('  ' + sage('✓') + ` memory mirrored — open ${grey(path.join('Praxis', project, project + ' - Memory'))} in Obsidian.`);
  console.log('  ' + dim('From now on every session and traced commit writes itself in.') + '\n');
}
