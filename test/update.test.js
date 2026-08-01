// `praxis update` — for people who installed PRAXIS a while ago.
//
// The interesting thing about updating PRAXIS is how little of it needs
// updating. Hooks and the MCP server are wired as `npx -y praxis-memory`, so
// they resolve the newest release every session and nobody has to do anything.
// Saying that plainly is most of this command's job: the wrong outcome is a
// user being told to run something they did not need to run.
//
// What genuinely goes stale is narrow and specific:
//   - a global `praxis` shim, pinned on PATH the day it was installed
//   - slash commands, COPIED into a project at init time — so a release that
//     adds one never reaches projects that already exist
//   - commands retired in a later release, which init never deleted
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { updatePlan, compareVersions } from '../src/lib/update.js';
import { shippedTemplates, installedCommands } from '../src/commands/update.js';

const CLI = path.resolve('src', 'cli.js');

test('nothing to do is a real answer, and the common one', () => {
  const plan = updatePlan({ running: '0.12.0', latest: '0.12.0', global: '0.12.0' });
  assert.equal(plan.upToDate, true);
  assert.deepEqual(plan.actions, []);
  assert.ok(
    plan.notes.some((n) => /automatically, every session/.test(n.text)),
    'and it says WHY nothing is needed, rather than just going quiet',
  );
});

test('a stale global shim is named, with the exact command', () => {
  const plan = updatePlan({ running: '0.12.0', latest: '0.12.0', global: '0.10.0' });
  assert.equal(plan.upToDate, false);
  const a = plan.actions.find((x) => x.id === 'global');
  assert.match(a.why, /0\.10\.0/, 'says what is installed');
  assert.match(a.why, /0\.12\.0/, 'and what is out');
  assert.equal(a.run, 'npm install -g praxis-memory');
});

test('no global install means nothing global to be stale', () => {
  // npx-only users are the majority and must never be told to run npm -g.
  const plan = updatePlan({ running: '0.12.0', latest: '0.12.0', global: null });
  assert.equal(plan.actions.find((a) => a.id === 'global'), undefined);
  assert.equal(plan.upToDate, true);
});

test('a release that ADDS a command reaches old projects only through this', () => {
  const plan = updatePlan({
    running: '0.12.0',
    latest: '0.12.0',
    global: null,
    missingCommands: ['/praxis-update', '/praxis-doctor'],
  });
  const a = plan.actions.find((x) => x.id === 'commands-missing');
  assert.match(a.why, /2 slash commands/);
  assert.match(a.why, /praxis-update/);
  assert.equal(a.run, null, 'this command does it — no homework for the user');
});

test('retired commands are reported as leftovers, not as missing', () => {
  const plan = updatePlan({
    running: '0.12.0',
    latest: '0.12.0',
    global: null,
    retiredCommands: ['/praxis-cost', '/praxis-roi', '/praxis-hud'],
  });
  const a = plan.actions.find((x) => x.id === 'commands-retired');
  assert.match(a.why, /no longer shipped/);
  assert.match(a.why, /praxis-cost/);
});

test('an unreachable registry degrades, it does not fail', () => {
  // Someone on a train still gets the local half of the work done.
  const plan = updatePlan({ running: '0.12.0', latest: null, global: '0.10.0', missingCommands: ['/praxis-update'] });
  assert.equal(plan.offline, true);
  assert.equal(plan.behind, false, 'unknown is not "behind" — we do not guess');
  assert.ok(plan.notes.some((n) => n.id === 'offline'));
  assert.equal(plan.actions.find((a) => a.id === 'global'), undefined, 'cannot claim staleness without a number');
  assert.ok(plan.actions.find((a) => a.id === 'commands-missing'), 'but local work still happens');
});

test('running something NEWER than the registry is not an error', () => {
  // Exactly what a maintainer sees between tagging and publishing.
  const plan = updatePlan({ running: '0.12.0', latest: '0.11.1', global: null });
  assert.equal(plan.ahead, true);
  assert.equal(plan.behind, false);
  assert.equal(plan.upToDate, true, 'nothing is asked of someone who is ahead');
});

test('version comparison is the one already used by the tray', () => {
  // Reused rather than rewritten — two version comparers that disagree is a
  // bug waiting for a release to trigger it.
  assert.equal(compareVersions('0.12.0', '0.11.1'), 1);
  assert.equal(compareVersions('0.11.1', '0.12.0'), -1);
  assert.equal(compareVersions('0.12.0', '0.12.0'), 0);
  assert.equal(compareVersions('0.12.0-rc.1', '0.12.0'), 0, 'prerelease tags are not a version difference');
});

test('the shipped template list is the templates directory, not a hardcoded list', () => {
  const shipped = shippedTemplates();
  assert.ok(shipped.length >= 15, `expected the real templates, got ${shipped.length}`);
  assert.ok(shipped.includes('praxis-update.md'), 'including this command own template');
  assert.ok(shipped.every((f) => f.startsWith('praxis-') && f.endsWith('.md')));
  assert.deepEqual(shipped, [...shipped].sort(), 'stable order');
  assert.deepEqual(installedCommands(path.join(os.tmpdir(), 'praxis-nope-' + Date.now())), [], 'a missing dir is not an error');
});

test('update actually installs what is missing and removes what is retired', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-upd-'));
  fs.mkdirSync(path.join(root, '.praxis'), { recursive: true });
  fs.writeFileSync(path.join(root, '.praxis', 'memory.md'), '# PRAXIS Memory\n');
  fs.writeFileSync(path.join(root, '.praxis', 'config.json'), '{"capture":true}');

  // a project as it looked several releases ago: one current command, and three
  // that 0.11.0 deleted but init never cleaned up
  const cmds = path.join(root, '.claude', 'commands');
  fs.mkdirSync(cmds, { recursive: true });
  fs.writeFileSync(path.join(cmds, 'praxis-status.md'), 'stale contents from an old release');
  for (const gone of ['praxis-cost.md', 'praxis-roi.md', 'praxis-hud.md']) {
    fs.writeFileSync(path.join(cmds, gone), 'x');
  }
  fs.writeFileSync(path.join(cmds, 'other-tool.md'), 'not ours');

  const out = execFileSync(process.execPath, [CLI, 'update'], { cwd: root, encoding: 'utf8', timeout: 120000 });

  const after = installedCommands(cmds);
  for (const gone of ['praxis-cost.md', 'praxis-roi.md', 'praxis-hud.md']) {
    assert.ok(!after.includes(gone), `${gone} was retired and should be gone`);
  }
  assert.ok(after.includes('praxis-update.md'), 'the new command arrived');
  assert.deepEqual(after, shippedTemplates(), 'the project now matches what this release ships, exactly');

  assert.ok(fs.existsSync(path.join(cmds, 'other-tool.md')), 'another tool’s command is not ours to touch');
  assert.notEqual(
    fs.readFileSync(path.join(cmds, 'praxis-status.md'), 'utf8'),
    'stale contents from an old release',
    'an existing command whose CONTENT changed is refreshed too, not just the missing ones',
  );
  assert.match(out, /Updated:/);

  fs.rmSync(root, { recursive: true, force: true });
});

test('--check changes nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-upd-chk-'));
  fs.mkdirSync(path.join(root, '.praxis'), { recursive: true });
  fs.writeFileSync(path.join(root, '.praxis', 'config.json'), '{}');
  const cmds = path.join(root, '.claude', 'commands');
  fs.mkdirSync(cmds, { recursive: true });
  fs.writeFileSync(path.join(cmds, 'praxis-cost.md'), 'retired');

  const out = execFileSync(process.execPath, [CLI, 'update', '--check'], { cwd: root, encoding: 'utf8', timeout: 120000 });
  assert.match(out, /nothing was changed/i);
  assert.deepEqual(installedCommands(cmds), ['praxis-cost.md'], 'still exactly as it was');

  fs.rmSync(root, { recursive: true, force: true });
});

test('outside a project it reports without inventing local work', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-upd-bare-'));
  const out = execFileSync(process.execPath, [CLI, 'update', '--check'], { cwd: root, encoding: 'utf8', timeout: 120000 });
  assert.doesNotMatch(out, /slash commands/, 'no project, so no slash-command claims either way');
  assert.match(out, /update/);
  fs.rmSync(root, { recursive: true, force: true });
});
