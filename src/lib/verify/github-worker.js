import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { extractClaims, logExtraction } from './extract.js';
import { verifyStatic } from './index.js';

function git(cwd, args, env = process.env) {
  try {
    return execFileSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 }).trim();
  } catch (error) {
    const detail = String(error.stderr || error.message || '').replace(/ghs_[A-Za-z0-9_]+/g, '[REDACTED]').trim().split(/\r?\n/)[0];
    throw new Error(`Git checkout failed${detail ? `: ${detail}` : '.'}`);
  }
}

function authEnv(token) {
  return {
    ...process.env,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
    GIT_CONFIG_KEY_1: 'credential.interactive',
    GIT_CONFIG_VALUE_1: 'never',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function fetchExact(root, delivery, env) {
  git(root, ['init', '-q']);
  git(root, ['remote', 'add', 'origin', delivery.cloneUrl]);
  git(root, ['fetch', '--no-tags', '--depth=1', 'origin', delivery.base], env);
  git(root, ['update-ref', 'refs/praxis/base', 'FETCH_HEAD']);
  git(root, ['fetch', '--no-tags', '--depth=1', 'origin', `+refs/pull/${delivery.number}/head:refs/praxis/head`], env);
  const base = git(root, ['rev-parse', 'refs/praxis/base']);
  const head = git(root, ['rev-parse', 'refs/praxis/head']);
  if (base !== delivery.base || head !== delivery.head) throw new Error('Fetched commits do not match the signed webhook payload.');
  git(root, ['checkout', '-q', '--detach', 'refs/praxis/head']);
}

export async function verifyGitHubPullRequest(delivery, { token, env = process.env, stateRoot = path.join(os.homedir(), '.praxis', 'github-app'), checkout = fetchExact, extractor = extractClaims } = {}) {
  if (!token) throw new Error('A GitHub installation token is required.');
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-github-'));
  const root = path.join(parent, 'source'); fs.mkdirSync(root);
  try {
    await checkout(root, delivery, authEnv(token));
    const task = delivery.title.trim() || `Verify pull request #${delivery.number}`;
    const report = delivery.body.trim() || delivery.title.trim();
    if (!report) throw new Error('The pull request needs a concrete agent completion report in its title or body.');
    const manifest = await extractor(report, { task, env });
    if (!manifest.claims.length) throw new Error('The completion report contained no atomic, checkable claims.');
    const scope = path.join(stateRoot, delivery.owner, delivery.repo);
    fs.mkdirSync(scope, { recursive: true, mode: 0o700 });
    logExtraction(scope, { task, report, manifest, extractor: 'github-app' });
    const result = verifyStatic({
      cwd: root, taskText: task, taskSource: { kind: 'github-pull-request', number: delivery.number },
      manifestObject: manifest, base: delivery.base, head: delivery.head, selectedBy: 'github-pull-request',
      keyDir: path.join(stateRoot, 'signing'), receiptDir: path.join(scope, 'receipts'),
    });
    const receipt = JSON.parse(fs.readFileSync(result.artifact.file, 'utf8'));
    return Object.freeze({ ...result, receipt });
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
}
