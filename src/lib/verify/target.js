import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { VerifyInputError } from './schema.js';

function git(cwd, args, { allowFailure = false, raw = false } = {}) {
  try {
    const output = execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
    return raw ? output : output.trim();
  } catch (error) {
    if (allowFailure) return null;
    const detail = String(error.stderr || error.message || '').trim().split('\n')[0];
    throw new VerifyInputError('git-failed', `Git could not resolve the verification target${detail ? `: ${detail}` : '.'}`);
  }
}

function resolveCommit(cwd, value, label) {
  if (typeof value !== 'string' || !value || value.length > 256 || value.startsWith('-') || /[\u0000\r\n]/.test(value)) {
    throw new VerifyInputError('invalid-range', `Invalid ${label} revision.`);
  }
  const resolved = git(cwd, ['rev-parse', '--verify', `${value}^{commit}`], { allowFailure: true });
  if (!resolved || !/^[a-f0-9]{40,64}$/i.test(resolved)) throw new VerifyInputError('invalid-range', `Cannot resolve ${label} revision: ${value}`);
  return resolved;
}

export function resolveTarget(cwd = process.cwd(), options = {}) {
  const root = git(cwd, ['rev-parse', '--show-toplevel'], { allowFailure: true });
  if (!root) throw new VerifyInputError('not-a-git-repository', 'PRAXIS Verify must run inside a Git repository.');
  const head = resolveCommit(root, options.head || 'HEAD', 'head');
  let base;
  if (options.base) base = resolveCommit(root, options.base, 'base');
  else {
    const ancestry = (git(root, ['rev-list', '--parents', '-n', '1', head]) || '').split(/\s+/).filter(Boolean);
    if (ancestry.length > 2) {
      throw new VerifyInputError('ambiguous-range', `HEAD is a merge commit with ${ancestry.length - 1} parents. Select the intended base with --base <ref>.`, `praxis verify --base ${ancestry[1]} --head ${head} ...`);
    }
    base = ancestry[1] || null;
  }
  const headTree = git(root, ['rev-parse', `${head}^{tree}`]);
  const baseTree = base ? git(root, ['rev-parse', `${base}^{tree}`]) : null;
  const dirtyLines = (git(root, ['status', '--porcelain=v1', '--untracked-files=all']) || '').split(/\r?\n/).filter((line) => line && !/^\?\? \.praxis(?:[\\\\/]|$)/.test(line));
  const changedRaw = base
    ? git(root, ['diff', '--name-only', '-z', base, head], { raw: true })
    : git(root, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', head], { raw: true });
  const changedPaths = changedRaw ? changedRaw.split('\0').filter(Boolean).map((p) => p.replace(/\\/g, '/')) : [];
  const submodulesRaw = git(root, ['submodule', 'status', '--recursive'], { allowFailure: true }) || '';
  const submodules = submodulesRaw.split(/\r?\n/).filter(Boolean).map((line) => line.trim());
  return Object.freeze({
    schema: 'praxis.verify.target/v1', root: path.resolve(root), base, head, baseTree, headTree,
    clean: dirtyLines.length === 0, dirtyEntries: dirtyLines.slice(0, 200), changedPaths: Object.freeze(changedPaths),
    submodules: Object.freeze(submodules), selectedBy: options.selectedBy || (options.base || options.head ? 'explicit' : 'head-parent'),
  });
}

export function confirmTargetUnchanged(target) {
  const currentHead = git(target.root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const currentTree = git(target.root, ['rev-parse', 'HEAD^{tree}']);
  const dirty = (git(target.root, ['status', '--porcelain=v1', '--untracked-files=all']) || '').split(/\r?\n/).filter((line) => line && !/^\?\? \.praxis(?:[\\\\/]|$)/.test(line));
  return Object.freeze({ unchanged: currentHead === target.head && currentTree === target.headTree && dirty.join('\n') === target.dirtyEntries.join('\n'), head: currentHead, headTree: currentTree, clean: dirty.length === 0 });
}
