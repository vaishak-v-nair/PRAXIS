import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { projectPaths } from '../lib/paths.js';
import { praxisCmd } from '../lib/runner.js';
import { vaultRoot } from '../lib/vault.js';
import {
  removePraxisHooks,
  removeMcpServer,
  removeClaudeMdBlock,
  removeGitignoreRule,
  praxisCommandFiles,
  vaultPraxisDirs,
  fileHasPraxisHooks,
  mcpHasPraxis,
  claudeMdHasBlock,
} from '../lib/uninstall.js';
import { tray } from './tray.js';
import { miniHeader, sage, amber, rose, bold, grey, dim } from '../lib/ui.js';

function pkgVersion() {
  try {
    return JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

const countFiles = (dir) => {
  let n = 0;
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) (e.isDirectory() ? walk : () => n++)(path.join(d, e.name));
  };
  walk(dir);
  return n;
};

/**
 * Take PRAXIS out of this project.
 *
 * The whole design premise is that a person who wants PRAXIS gone should not
 * have to know where it put things. It put them in six places, one of which is
 * inside an Obsidian vault next to notes the user wrote themselves — and the
 * obvious move, `rm -rf .praxis`, leaves hooks running `npx -y praxis-memory`
 * at the end of every session against a directory that no longer exists.
 *
 * Nothing is deleted before it is copied. The memory, the receipts, the archive
 * and the vault notes go to ~/.praxis/removed/<project>-<date>/ first, because
 * "I changed my mind" and "I typed this in the wrong project" are both extremely
 * ordinary, and neither should cost somebody their history.
 */
export async function uninstall(args = []) {
  const dryRun = args.includes('--dry-run');
  const assumeYes = args.includes('--yes') || args.includes('-y');
  const global = args.includes('--global');
  const p = projectPaths();
  const project = path.basename(p.root);

  console.log('\n  ' + miniHeader(pkgVersion(), 'uninstall') + '\n');

  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(p.configFile, 'utf8'));
  } catch {
    /* no config — the rest of the plan still holds */
  }
  const vault = vaultPraxisDirs(vaultRoot(cfg), project);
  const commandFiles = praxisCommandFiles(p.commandsDir);
  const userCommandFiles = global ? praxisCommandFiles(path.join(os.homedir(), '.claude', 'commands')) : [];

  // ── what is actually here ────────────────────────────────────────────────
  const found = [];
  const add = (cond, text) => cond && found.push(text);
  // Each of these asks whether OUR thing is in there, never merely whether the
  // file exists — settings files, .mcp.json and CLAUDE.md all routinely belong
  // to other tools and to the project itself.
  add(fs.existsSync(p.praxisDir), `.praxis/  ${grey(`(${countFiles(p.praxisDir)} files — memory, receipts, archive)`)}`);
  add(fileHasPraxisHooks(p.settingsLocalFile), `.claude/settings.local.json  ${grey('(PRAXIS hooks only)')}`);
  add(fileHasPraxisHooks(p.settingsFile), `.claude/settings.json  ${grey('(PRAXIS hooks only)')}`);
  add(mcpHasPraxis(p.mcpFile), `.mcp.json  ${grey('(the praxis server only)')}`);
  add(claudeMdHasBlock(p.claudeMd), `CLAUDE.md  ${grey('(the managed block only)')}`);
  add(commandFiles.length, `.claude/commands/  ${grey(`(${commandFiles.length} praxis-* commands)`)}`);
  add(vault, vault ? `${path.relative(p.root, vault.projectDir) || vault.projectDir}  ${grey('(notes PRAXIS wrote into your vault)')}` : '');
  add(userCommandFiles.length, `~/.claude/commands/  ${grey(`(${userCommandFiles.length} praxis-* commands, ALL projects)`)}`);

  if (!found.length) {
    console.log('  PRAXIS is not installed in this project.\n');
    return;
  }

  console.log('  ' + bold('This removes PRAXIS from ') + rose(project) + bold(':') + '\n');
  for (const f of found) console.log('    ' + amber('−') + ' ' + f);

  const archiveDir = path.join(os.homedir(), '.praxis', 'removed', `${project}-${new Date().toISOString().slice(0, 10)}`);
  console.log('\n  ' + bold('Kept, not deleted:'));
  console.log('    ' + sage('✓') + ' your memory, receipts, archive and vault notes are copied to');
  console.log('      ' + rose(archiveDir));
  console.log('    ' + sage('✓') + ' everything else in your vault — PRAXIS only ever wrote inside ' + bold('Praxis/'));
  console.log('    ' + sage('✓') + ' hooks, MCP servers and CLAUDE.md content belonging to anything else');
  if (!global && praxisCommandFiles(path.join(os.homedir(), '.claude', 'commands')).length) {
    console.log(
      '    ' + sage('✓') + ' the user-wide /praxis-* commands ' + grey('(other projects may still use them — ') + rose('--global') + grey(' removes those too)'),
    );
  }

  if (dryRun) {
    console.log('\n  ' + dim('--dry-run: nothing was changed.') + '\n');
    return;
  }

  if (!assumeYes) {
    if (!(process.stdin.isTTY && process.stdout.isTTY)) {
      console.log('\n  ' + amber('!') + ' not a terminal, so nothing was changed.');
      console.log('    ' + dim(`re-run with `) + rose('--yes') + dim(' to go ahead, or ') + rose('--dry-run') + dim(' to just look.') + '\n');
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise((r) => rl.question('\n  Remove PRAXIS from ' + bold(project) + '? [y/N] ', r));
    rl.close();
    if (!/^y(es)?$/i.test(String(ans).trim())) {
      console.log('\n  Nothing was changed.\n');
      return;
    }
  }

  // ── the tray goes first, and politely ────────────────────────────────────
  // Its host holds files under .praxis/tray, and a forced kill leaves the icon
  // painted on a dead process. --stop is the cooperative path.
  try {
    await tray(['--stop']);
  } catch {
    /* no tray here, or it was already gone */
  }

  // ── copy before deleting ─────────────────────────────────────────────────
  const kept = [];
  const keep = (src, name) => {
    if (!fs.existsSync(src)) return;
    try {
      fs.mkdirSync(archiveDir, { recursive: true });
      fs.cpSync(src, path.join(archiveDir, name), { recursive: true });
      kept.push(name);
    } catch {
      /* best effort — reported below, and removal still stops on failure */
    }
  };
  keep(p.memoryFile, 'memory.md');
  keep(p.configFile, 'config.json');
  keep(path.join(p.praxisDir, 'archive'), 'archive');
  keep(p.receiptsDir, 'receipts');
  keep(path.join(p.praxisDir, 'checkpoints'), 'checkpoints');
  if (vault) keep(vault.projectDir, 'vault-notes');

  // ── remove ───────────────────────────────────────────────────────────────
  const done = [];
  const rm = (target, label) => {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      done.push(label);
    } catch {
      done.push(label + ' ' + amber('(could not remove)'));
    }
  };

  if (fs.existsSync(p.praxisDir)) rm(p.praxisDir, '.praxis/');
  for (const f of [p.settingsLocalFile, p.settingsFile]) {
    const r = removePraxisHooks(f);
    if (r.changed) done.push(path.relative(p.root, f) + (r.deleted ? ' (removed)' : ` (${r.removed} hook${r.removed === 1 ? '' : 's'} taken out)`));
  }
  const mcp = removeMcpServer(p.mcpFile);
  if (mcp.changed) done.push('.mcp.json' + (mcp.deleted ? ' (removed)' : ' (praxis server taken out)'));
  const cmd = removeClaudeMdBlock(p.claudeMd);
  if (cmd.changed) done.push('CLAUDE.md' + (cmd.deleted ? ' (removed)' : ' (managed block taken out)'));
  if (commandFiles.length) {
    for (const f of commandFiles) fs.rmSync(f, { force: true });
    done.push(`.claude/commands — ${commandFiles.length} praxis-* commands`);
  }
  if (userCommandFiles.length) {
    for (const f of userCommandFiles) fs.rmSync(f, { force: true });
    done.push(`~/.claude/commands — ${userCommandFiles.length} praxis-* commands (all projects)`);
  }
  if (removeGitignoreRule(p.root).changed) done.push('.gitignore — the .praxis/ rule');
  if (vault) {
    rm(vault.projectDir, path.basename(vault.projectDir) + ' (vault notes)');
    if (vault.wrapperDir) {
      try {
        fs.rmdirSync(vault.wrapperDir);
      } catch {
        /* not empty after all — leave it */
      }
    }
  }

  console.log('\n  ' + bold('Removed:'));
  for (const d of done) console.log('    ' + sage('✓') + ' ' + d);
  if (kept.length) {
    console.log('\n  ' + bold('Kept:') + ' ' + grey(kept.join(' · ')));
    console.log('  ' + rose(archiveDir));
    console.log('  ' + dim('delete that whenever you like — nothing reads it.'));
  }
  console.log('\n  ' + dim('Restart Claude Code to clear the loaded memory and commands.'));
  console.log('  ' + dim('Changed your mind? ') + rose(`npx -y praxis-memory init`) + dim(' sets it up again.') + '\n');
}
