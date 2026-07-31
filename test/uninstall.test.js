// Taking PRAXIS out has to be as careful as putting it in.
//
// Everything here is about what uninstall must NOT take: hooks that belong to
// other tools, MCP servers that belong to other tools, a CLAUDE.md holding the
// project's real instructions, and an Obsidian vault where PRAXIS wrote into
// one subfolder and the human wrote everything else. Removing PRAXIS should
// cost a user none of that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
} from '../src/lib/uninstall.js';
import { patchSettings, setTrayHook } from '../src/lib/settings.js';
import { patchMcpConfig } from '../src/lib/mcp/config.js';
import { patchClaudeMd } from '../src/lib/claudemd.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-uninstall-'));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('uninstall is the exact inverse of install, and removes the file it created', () => {
  const file = path.join(tmp(), 'settings.local.json');
  patchSettings(file, { tray: true });
  const r = removePraxisHooks(file);
  assert.equal(r.removed, 3, 'Stop, PreCompact and SessionStart');
  assert.equal(r.deleted, true, 'PRAXIS made this file, so PRAXIS takes it away');
  assert.equal(fs.existsSync(file), false);
});

test('hooks belonging to other tools survive, and so does the file', () => {
  const file = path.join(tmp(), 'settings.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      permissions: { allow: ['Bash(npm test)'] },
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'npx -y praxis-memory capture' }] },
          { hooks: [{ type: 'command', command: './scripts/my-own-hook.sh' }] },
        ],
        PreToolUse: [{ hooks: [{ type: 'command', command: 'echo mine' }] }],
      },
    }),
  );
  const r = removePraxisHooks(file);
  assert.equal(r.removed, 1);
  assert.equal(r.deleted, false, 'this file has the user\'s own settings in it');
  const s = readJson(file);
  assert.deepEqual(s.permissions.allow, ['Bash(npm test)'], 'untouched');
  assert.equal(s.hooks.Stop.length, 1);
  assert.match(JSON.stringify(s.hooks.Stop), /my-own-hook/);
  assert.doesNotMatch(JSON.stringify(s), /praxis/);
  assert.ok(s.hooks.PreToolUse, 'an event we never wrote to is not ours to prune');
});

test('a legacy bare-praxis hook is recognised and removed', () => {
  // shipped until 0.9.1; an install that never upgraded still has it, and
  // leaving it behind means "praxis: command not found" every session forever
  const file = path.join(tmp(), 'settings.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'praxis capture' }] }] } }),
  );
  assert.equal(removePraxisHooks(file).removed, 1);
  assert.equal(fs.existsSync(file), false);
});

test('a command that merely contains the word praxis is not ours to delete', () => {
  const file = path.join(tmp(), 'settings.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: './tools/praxis-report.sh --all' }] }] } }),
  );
  const r = removePraxisHooks(file);
  assert.equal(r.removed, 0, 'the user wrote this, whatever it is called');
  assert.equal(r.changed, false);
  assert.ok(fs.existsSync(file));
});

test('the MCP server goes, other servers stay', () => {
  const dir = tmp();
  const solo = path.join(dir, 'a.mcp.json');
  patchMcpConfig(solo);
  const r1 = removeMcpServer(solo);
  assert.equal(r1.deleted, true, 'praxis was the only server, so the file goes too');

  const shared = path.join(dir, 'b.mcp.json');
  fs.writeFileSync(shared, JSON.stringify({ mcpServers: { supabase: { command: 'npx', args: ['x'] } } }));
  patchMcpConfig(shared);
  const r2 = removeMcpServer(shared);
  assert.equal(r2.deleted, false);
  const cfg = readJson(shared);
  assert.ok(cfg.mcpServers.supabase, 'somebody else lives here');
  assert.equal(cfg.mcpServers.praxis, undefined);
});

test('a CLAUDE.md PRAXIS created is removed; one with real content is only edited', () => {
  const dir = tmp();
  const mine = path.join(dir, 'CLAUDE.md');
  patchClaudeMd(mine);
  assert.equal(removeClaudeMdBlock(mine).deleted, true, 'every word of it was ours');
  assert.equal(fs.existsSync(mine), false);

  const theirs = path.join(dir, 'THEIRS.md');
  fs.writeFileSync(theirs, '# Build notes\n\nRun `make test` before pushing.\n');
  patchClaudeMd(theirs);
  const r = removeClaudeMdBlock(theirs);
  assert.equal(r.deleted, false, 'this file is the project, not PRAXIS');
  const left = fs.readFileSync(theirs, 'utf8');
  assert.match(left, /make test/);
  assert.doesNotMatch(left, /PRAXIS/);
  assert.doesNotMatch(left, /@\.praxis/);
});

test('no claim that the project uses PRAXIS is left behind in CLAUDE.md', () => {
  // The managed block is the obvious half. The other half is the sentence
  // patchClaudeMd writes above it — leaving that means Claude reads "This
  // project uses PRAXIS" at the start of every session in a project that does
  // not. A stale instruction is worse than none.
  const dir = tmp();
  const f = path.join(dir, 'CLAUDE.md');
  patchClaudeMd(f);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8') + '\n## House rules\n\nRun `make test` before pushing.\n');

  const r = removeClaudeMdBlock(f);
  assert.equal(r.deleted, false, 'the house rules are the project, not PRAXIS');
  const left = fs.readFileSync(f, 'utf8');
  assert.match(left, /House rules/);
  assert.match(left, /make test/);
  assert.doesNotMatch(left, /uses PRAXIS/, 'the claim goes with the block');
  assert.doesNotMatch(left, /PRAXIS/);
  assert.doesNotMatch(left, /\n\n\n/, 'and no crater where it used to be');
});

test('a CLAUDE.md left holding only our heading is removed, not left as litter', () => {
  const dir = tmp();
  const f = path.join(dir, 'CLAUDE.md');
  patchClaudeMd(f);
  assert.equal(removeClaudeMdBlock(f).deleted, true);
  assert.equal(fs.existsSync(f), false);
});

test('the .praxis ignore rule goes, the personal-settings rule stays', () => {
  const dir = tmp();
  fs.writeFileSync(
    path.join(dir, '.gitignore'),
    'node_modules/\n\n# PRAXIS local memory (may contain project details — commit only after review)\n.praxis/\n\n' +
      '# PRAXIS: your personal hooks — never commit these onto teammates\n.claude/settings.local.json\n',
  );
  assert.equal(removeGitignoreRule(dir).changed, true);
  const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(gi, /node_modules\//, "the user's own rules are untouched");
  assert.doesNotMatch(gi, /\.praxis\//, 'the dead rule is gone');
  assert.match(gi, /settings\.local\.json/, 'keeping personal settings out of git outlives PRAXIS');
});

test('retired slash commands are found too, not just the ones shipping today', () => {
  const dir = tmp();
  // praxis-cost / roi / hud were removed in 0.11.0, but init never deleted the
  // copies it had already written — matching on today's templates would strand
  // exactly these three
  for (const f of ['praxis-status.md', 'praxis-cost.md', 'praxis-roi.md', 'praxis-hud.md', 'other-tool.md']) {
    fs.writeFileSync(path.join(dir, f), 'x');
  }
  const found = praxisCommandFiles(dir).map((f) => path.basename(f));
  assert.deepEqual(found, ['praxis-cost.md', 'praxis-hud.md', 'praxis-roi.md', 'praxis-status.md']);
  assert.equal(praxisCommandFiles(path.join(dir, 'nope')).length, 0, 'a missing dir is not an error');
});

test('detection asks whether OUR thing is in the file, not whether the file exists', () => {
  // "the file is there" made a second uninstall offer to remove things it had
  // already removed. Settings files, .mcp.json and CLAUDE.md all outlive PRAXIS.
  const dir = tmp();
  const settings = path.join(dir, 'settings.json');
  const mcp = path.join(dir, '.mcp.json');
  const md = path.join(dir, 'CLAUDE.md');
  fs.writeFileSync(settings, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }));
  fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { supabase: { command: 'npx', args: ['x'] } } }));
  fs.writeFileSync(md, '# Build notes\n\nRun `make test`.\n');
  assert.equal(fileHasPraxisHooks(settings), false);
  assert.equal(mcpHasPraxis(mcp), false);
  assert.equal(claudeMdHasBlock(md), false);

  patchSettings(settings, { tray: true });
  patchMcpConfig(mcp);
  patchClaudeMd(md);
  assert.equal(fileHasPraxisHooks(settings), true);
  assert.equal(mcpHasPraxis(mcp), true);
  assert.equal(claudeMdHasBlock(md), true);

  // and after a removal, detection has to go quiet again — this is what makes
  // a second `praxis uninstall` say "not installed" instead of offering to
  // remove things that are already gone
  removePraxisHooks(settings);
  removeMcpServer(mcp);
  removeClaudeMdBlock(md);
  assert.equal(fileHasPraxisHooks(settings), false);
  assert.equal(mcpHasPraxis(mcp), false);
  assert.equal(claudeMdHasBlock(md), false, 'including the leftover sentence');
});

test('setTrayHook alone is enough to make a file look installed', () => {
  // a project that opted into the tray but whose capture hooks live in the
  // other settings file still has something of ours to remove
  const f = path.join(tmp(), 'settings.local.json');
  setTrayHook(f, true);
  assert.equal(fileHasPraxisHooks(f), true);
  removePraxisHooks(f);
  assert.equal(fileHasPraxisHooks(f), false);
});

test('only the vault subfolder PRAXIS wrote is a candidate, never the vault', () => {
  const vault = tmp();
  fs.mkdirSync(path.join(vault, '01 Identity'), { recursive: true });
  fs.writeFileSync(path.join(vault, '00 Start Here.md'), 'my own notes');
  fs.mkdirSync(path.join(vault, 'Praxis', 'my-project', 'Sessions'), { recursive: true });

  const r = vaultPraxisDirs(vault, 'my-project');
  assert.equal(r.projectDir, path.join(vault, 'Praxis', 'my-project'));
  assert.equal(r.wrapperDir, path.join(vault, 'Praxis'), 'sole project, so the wrapper goes too');
  assert.ok(!String(r.projectDir).endsWith(path.basename(vault)), 'never the vault root');

  // a second project shares the vault: the wrapper has to survive
  fs.mkdirSync(path.join(vault, 'Praxis', 'other-project'), { recursive: true });
  assert.equal(vaultPraxisDirs(vault, 'my-project').wrapperDir, null);

  assert.equal(vaultPraxisDirs(vault, 'never-installed'), null);
  assert.equal(vaultPraxisDirs(null, 'x'), null, 'no vault configured is not an error');
});
