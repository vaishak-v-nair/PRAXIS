import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { confirmTargetUnchanged, resolveTarget } from '../src/lib/verify/target.js';

function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); }
function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-verify-target-'));
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 'verify@example.test'); git(root, 'config', 'user.name', 'Verify Fixture');
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n'); git(root, 'add', 'a.txt'); git(root, 'commit', '-qm', 'one');
  fs.writeFileSync(path.join(root, 'a.txt'), 'two\n'); git(root, 'add', 'a.txt'); git(root, 'commit', '-qm', 'two');
  return root;
}

test('target binds parent/head trees and exact changed paths', () => {
  const root = repo();
  const target = resolveTarget(root);
  assert.match(target.head, /^[a-f0-9]{40}$/);
  assert.match(target.headTree, /^[a-f0-9]{40}$/);
  assert.deepEqual(target.changedPaths, ['a.txt']);
  assert.equal(target.clean, true);
  assert.equal(confirmTargetUnchanged(target).unchanged, true);
});

test('target notices dirty state and mutation after preflight', () => {
  const root = repo();
  const target = resolveTarget(root);
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'changed\n');
  assert.equal(confirmTargetUnchanged(target).unchanged, false);
  assert.equal(resolveTarget(root).clean, false);
});

test('merge commits require an explicit base instead of silently choosing a parent', () => {
  const root = repo();
  const primary = git(root, 'branch', '--show-current').trim();
  git(root, 'checkout', '-qb', 'side', 'HEAD~1');
  fs.writeFileSync(path.join(root, 'side.txt'), 'side\n'); git(root, 'add', 'side.txt'); git(root, 'commit', '-qm', 'side');
  git(root, 'checkout', '-q', primary);
  git(root, 'merge', '--no-ff', '-qm', 'merge', 'side');
  assert.throws(() => resolveTarget(root), (error) => error.code === 'ambiguous-range' && /--base/.test(error.nextCommand));
  assert.equal(resolveTarget(root, { base: 'HEAD^1' }).selectedBy, 'explicit');
});

test('revision arguments are canonicalized and option-shaped refs are rejected', () => {
  const root = repo();
  assert.throws(() => resolveTarget(root, { base: '--help' }), (error) => error.code === 'invalid-range');
  assert.match(resolveTarget(root, { base: 'HEAD^', head: 'HEAD' }).head, /^[a-f0-9]{40}$/);
});
