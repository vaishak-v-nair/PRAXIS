// Whose machine do the hooks run on?
//
// PRAXIS's capture hooks run `npx -y praxis-memory` at the end of every session.
// Written into the COMMITTED settings file, that means every teammate fetches
// and executes a package from the network without ever having agreed to it —
// which, for a product whose entire pitch is that you can verify what software
// did on your machine, is the one contradiction it cannot afford.
//
// So: personal file by default, shared file only as an answer to a question.
// These tests exist because that is a consent boundary, and consent boundaries
// are the things that quietly regress.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  patchSettings,
  resolveHookScope,
  hasPraxisHooks,
  contributorCount,
  ignoreLocalSettings,
} from '../src/lib/settings.js';
import { checkHooks } from '../src/lib/doctor.js';
import { projectPaths } from '../src/lib/paths.js';

const CLI = path.resolve('src', 'cli.js');
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-scope-' + n + '-'));

/** A throwaway git repo with `n` distinct commit authors. */
function repoWith(n) {
  const dir = tmp('repo');
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', timeout: 15000, windowsHide: true });
  git('init', '-q');
  git('config', 'commit.gpgsign', 'false');
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(path.join(dir, `f${i}.txt`), String(i));
    git('add', '-A');
    git('-c', `user.name=Dev ${i}`, '-c', `user.email=dev${i}@example.com`, 'commit', '-q', '-m', `c${i}`);
  }
  return dir;
}

// ── the default ──────────────────────────────────────────────────────────────

test('a fresh install writes to the PERSONAL file, never the committed one', () => {
  const dir = tmp('fresh');
  const s = resolveHookScope(dir, { interactive: false });
  assert.equal(s.scope, 'local');
  assert.match(s.file, /settings\.local\.json$/, 'the default must never be the file git tracks');
});

test('a solo repo is never asked — there is nobody else to consult', () => {
  const dir = repoWith(1);
  const s = resolveHookScope(dir, { interactive: true });
  assert.equal(s.ask, false, 'asking a question with an audience of one is noise');
  assert.equal(s.scope, 'local');
  assert.equal(s.reason, 'solo repo');
});

test('a repo with other people IS asked, because they are affected', () => {
  const dir = repoWith(3);
  assert.ok(contributorCount(dir) >= 2, 'the detector sees the other authors');
  const s = resolveHookScope(dir, { interactive: true });
  assert.equal(s.ask, true);
  assert.equal(s.scope, 'local', 'and the pending default is still the private one');
});

test('no TTY takes the private default and never blocks', () => {
  const dir = repoWith(3);
  const s = resolveHookScope(dir, { interactive: false });
  assert.equal(s.ask, false, 'a prompt nobody can answer must not stop an install');
  assert.equal(s.scope, 'local', 'and must never resolve itself by picking the more public option');
});

// ── existing installs ────────────────────────────────────────────────────────

test('an existing project-scoped install is left exactly where it is', () => {
  const dir = tmp('existing-project');
  const p = projectPaths(dir);
  fs.mkdirSync(p.claudeDir, { recursive: true });
  patchSettings(p.settingsFile);

  const s = resolveHookScope(dir, { interactive: true });
  assert.equal(s.file, p.settingsFile, 'upgrades never move somebody’s hooks out from under them');
  assert.equal(s.ask, false, 'and never re-litigate a decision already made');
});

test('an existing personal install stays personal', () => {
  const dir = tmp('existing-local');
  const p = projectPaths(dir);
  fs.mkdirSync(p.claudeDir, { recursive: true });
  patchSettings(p.settingsLocalFile);

  const s = resolveHookScope(dir, { interactive: true });
  assert.equal(s.file, p.settingsLocalFile);
  assert.equal(s.ask, false);
});

// ── the front door must not quietly re-scope anyone ──────────────────────────

test('the front door repairs hooks but never creates a second copy of them', () => {
  const dir = tmp('repair');
  const p = projectPaths(dir);
  fs.mkdirSync(p.claudeDir, { recursive: true });

  // hooks live in the personal file, with one legacy bare-`praxis` command
  fs.writeFileSync(
    p.settingsLocalFile,
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'praxis capture' }] }] } }, null, 2),
  );

  const shared = patchSettings(p.settingsFile, { repairOnly: true });
  assert.equal(shared.skipped, true, 'the committed file had no hooks, so none were invented for it');
  assert.equal(fs.existsSync(p.settingsFile), false, 'and it was not created at all');

  const local = patchSettings(p.settingsLocalFile, { repairOnly: true });
  assert.equal(local.repaired, 1, 'the legacy command in the file that DOES have hooks was fixed');
  assert.match(fs.readFileSync(p.settingsLocalFile, 'utf8'), /npx -y praxis-memory capture/);

  // repairOnly never adds the missing events either
  const after = JSON.parse(fs.readFileSync(p.settingsLocalFile, 'utf8'));
  assert.equal(after.hooks.PreCompact, undefined, 'repair fixes what is there; it does not install');
});

// ── the readers all agree with the writer ────────────────────────────────────

test('doctor recognises a personal install rather than calling it broken', () => {
  const dir = tmp('doctor-local');
  const p = projectPaths(dir);
  fs.mkdirSync(p.claudeDir, { recursive: true });
  patchSettings(p.settingsLocalFile);

  const c = checkHooks(dir);
  assert.equal(c.ok, true, 'doctor is run BY people who are already unsure — it must not add doubt');
  assert.match(c.detail, /just you/);
});

test('doctor names the scope, so the blast radius is readable', () => {
  const dir = tmp('doctor-project');
  const p = projectPaths(dir);
  fs.mkdirSync(p.claudeDir, { recursive: true });
  patchSettings(p.settingsFile);

  const c = checkHooks(dir);
  assert.equal(c.ok, true);
  assert.match(c.detail, /whole project/, 'a shared install should say so out loud');
});

test('doctor still reports an install that is genuinely absent', () => {
  const c = checkHooks(tmp('doctor-none'));
  assert.equal(c.ok, false);
  assert.match(c.fix, /init/);
});

// ── the personal file must not become a committed file by accident ───────────

test('choosing "just me" also keeps the file out of git', () => {
  const dir = tmp('ignore');
  const r = ignoreLocalSettings(dir);
  assert.equal(r.already, false);
  const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(gi, /\.claude\/settings\.local\.json/);

  const again = ignoreLocalSettings(dir);
  assert.equal(again.already, true, 'idempotent — never a second rule');
});

test('an existing ignore rule is respected rather than duplicated', () => {
  const dir = tmp('ignore-existing');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n.claude/settings.local.json\n');
  assert.equal(ignoreLocalSettings(dir).already, true);

  const broad = tmp('ignore-broad');
  fs.writeFileSync(path.join(broad, '.gitignore'), '.claude/\n');
  assert.equal(ignoreLocalSettings(broad).already, true, 'a broader rule already covers it');
});

// ── end to end, through the real command ─────────────────────────────────────

test('`init` in a non-interactive shell installs privately and says so', () => {
  const dir = repoWith(3);
  const r = spawnSync(process.execPath, [CLI, 'init'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, PRAXIS_SKIP_TRAY: '1' },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);

  const p = projectPaths(dir);
  assert.equal(hasPraxisHooks(p.settingsLocalFile), true, 'hooks landed in the personal file');
  assert.equal(hasPraxisHooks(p.settingsFile), false, 'and nothing was written onto teammates');
  assert.match(r.stdout, /settings\.local\.json/, 'and the output states where they went');
});
