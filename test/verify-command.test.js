import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { verifyVerifyReceipt } from '../src/lib/verify/verify-receipt.js';

const CLI = path.resolve('src', 'cli.js');
function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); }
function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-verify-command-'));
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 'verify@example.test'); git(root, 'config', 'user.name', 'Verify Fixture');
  fs.writeFileSync(path.join(root, 'README.md'), 'one\n'); git(root, 'add', 'README.md'); git(root, 'commit', '-qm', 'Initial README');
  fs.writeFileSync(path.join(root, 'README.md'), 'two\n'); git(root, 'add', 'README.md'); git(root, 'commit', '-qm', 'Updated README.md');
  return root;
}
function run(root, args) { return spawnSync(process.execPath, [CLI, 'verify', ...args, '--json'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000 }); }
function receipt(result) { return JSON.parse(fs.readFileSync(result.artifact.file, 'utf8')); }

test('correct file claim is commit-bound, VERIFIED, and has a public Ed25519 receipt', () => {
  const root = repo(), proc = run(root, ['--task', 'Update the README', '--claim', 'Updated README.md']);
  assert.equal(proc.status, 0, proc.stderr);
  const result = JSON.parse(proc.stdout);
  assert.equal(result.decision.decisions[0].verdict, 'VERIFIED');
  assert.equal(result.task.description, 'Update the README');
  assert.equal(result.claims[0].commitRange.head, result.target.head);
  assert.equal(result.claims[0].commitRange.base, result.target.base);
  assert.equal(result.artifact.receiptType, 'ed25519-public');
  assert.equal(verifyVerifyReceipt(receipt(result)), true);
  assert.equal(fs.existsSync(path.join(root, '.praxis', 'receipts')), false, 'legacy receipt store remains untouched');
});

test('deliberately false file claim is CONTRADICTED and still receives a verifiable receipt', () => {
  const root = repo(), proc = run(root, ['--task', 'Change a missing file', '--claim', 'Updated missing.txt']);
  assert.equal(proc.status, 1, proc.stderr);
  const result = JSON.parse(proc.stdout);
  assert.equal(result.decision.decisions[0].verdict, 'CONTRADICTED');
  assert.equal(verifyVerifyReceipt(receipt(result)), true);
});

test('static mode leaves a tests-passed claim UNSUPPORTED', () => {
  const root = repo(), proc = run(root, ['--task', 'Run tests', '--claim', 'All tests passed']);
  assert.equal(proc.status, 3);
  assert.equal(JSON.parse(proc.stdout).decision.decisions[0].verdict, 'UNSUPPORTED');
});

test('trusted mode fails closed without a reviewed policy', () => {
  const root = repo(), proc = run(root, ['--mode', 'trusted', '--task', 'Run tests', '--claim', 'All tests passed']);
  assert.equal(proc.status, 2);
  const result = JSON.parse(proc.stdout);
  assert.equal(result.error.code, 'trust-policy-required');
  assert.match(result.error.next_command, /--mode static/);
});

test('dirty worktree signs evidence but cannot claim complete scope', () => {
  const root = repo(); fs.writeFileSync(path.join(root, 'local.txt'), 'dirty\n');
  const proc = run(root, ['--task', 'Update README', '--claim', 'Updated README.md']);
  assert.equal(proc.status, 3);
  const result = JSON.parse(proc.stdout);
  assert.equal(result.complete, false);
  assert.equal(result.decision.decisions[0].verdict, 'VERIFIED');
  assert.equal(receipt(result).complete, false);
  assert.equal(verifyVerifyReceipt(receipt(result)), true);
});

test('PRAXIS state cannot be redirected through a symlink or junction', (t) => {
  const root = repo(), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-verify-outside-'));
  try { fs.symlinkSync(outside, path.join(root, '.praxis'), process.platform === 'win32' ? 'junction' : 'dir'); } catch (error) { t.skip(`symlink unavailable: ${error.code}`); return; }
  const proc = run(root, ['--task', 'Update README', '--claim', 'Updated README.md']);
  assert.equal(proc.status, 4);
  assert.equal(JSON.parse(proc.stdout).error.code, 'unsafe-state-path');
  assert.deepEqual(fs.readdirSync(outside), []);
});
