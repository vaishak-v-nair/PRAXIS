import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { vaultDirFor, vaultPathAllowed, mirrorMemory, writeSessionNote, writeCommitNote } from '../src/lib/vault.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-vault-'));

test('vault notes: hub, memory mirror, session, commit — linked and redacted', () => {
  const root = tmp();
  const dir = vaultDirFor({ vault: root }, 'MyApp');
  assert.equal(dir, path.join(root, 'Praxis', 'MyApp'));

  assert.ok(mirrorMemory(dir, 'MyApp', '# Memory\n- decided X\n'));
  const mirror = fs.readFileSync(path.join(dir, 'MyApp - Memory.md'), 'utf8');
  assert.match(mirror, /Auto-mirrored/);
  assert.match(mirror, /decided X/);
  assert.ok(fs.existsSync(path.join(dir, 'MyApp.md')), 'hub note created');

  assert.ok(
    writeSessionNote(dir, 'MyApp', {
      asks: ['fix login', 'add tests'],
      files: ['src/a.js'],
      turns: 42,
      tokens: 120000,
      snapshot: false,
    }),
  );
  const sessions = fs.readdirSync(path.join(dir, 'Sessions'));
  assert.equal(sessions.length, 1);
  const note = fs.readFileSync(path.join(dir, 'Sessions', sessions[0]), 'utf8');
  assert.match(note, /fix login/);
  assert.match(note, /120k context tokens/);
  assert.match(note, /\[\[MyApp - Memory\]\]/, 'wikilinked to memory');

  assert.ok(
    writeCommitNote(dir, 'MyApp', {
      hash: 'abc1234',
      subject: 'feat: thing',
      block: 'Asked:\n  · do thing\ntoken sk-ant-SECRETSECRETSECRET123',
    }),
  );
  const commit = fs.readFileSync(path.join(dir, 'Commits', 'abc1234.md'), 'utf8');
  assert.match(commit, /feat: thing/);
  assert.doesNotMatch(commit, /SECRETSECRETSECRET/, 'commit note redacted');
});

test('vault: no config = no-op, never throws', () => {
  assert.equal(vaultDirFor({}, 'X'), null);
  assert.equal(mirrorMemory(null, 'X', 'y'), false);
  assert.equal(writeSessionNote(null, 'X', {}), false);
  assert.equal(writeCommitNote(null, 'X', {}), false);
});

test('vault path is confined to home OR repo tree (hostile-repo defense)', () => {
  const home = path.join(os.tmpdir(), 'praxis-home');
  const repo = path.join(os.tmpdir(), 'praxis-repo');
  assert.ok(vaultPathAllowed(path.join(home, 'Obsidian', 'vault'), home, repo), 'inside home ok');
  assert.ok(vaultPathAllowed(home, home, repo), 'home root ok');
  assert.ok(vaultPathAllowed(path.join(repo, 'Personal Intelligence'), home, repo), 'inside repo ok (any drive)');
  assert.ok(!vaultPathAllowed('/etc/cron.d', home, repo), 'system path rejected');
  assert.ok(!vaultPathAllowed(path.join(home, '..', '..', 'etc'), home, repo), 'traversal rejected');
  assert.ok(!vaultPathAllowed(path.join(os.tmpdir(), 'other-project'), home, repo), 'sibling project rejected');
  // a hostile config pointing outside both yields no vault dir at all
  assert.equal(vaultDirFor({ vault: '/etc' }, 'X', home, repo), null);
  assert.equal(
    vaultDirFor({ vault: path.join(repo, 'v') }, 'X', home, repo),
    path.join(repo, 'v', 'Praxis', 'X'),
  );
});
