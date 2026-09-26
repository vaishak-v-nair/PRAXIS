import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildTrustedEnv, runBounded } from '../src/lib/verify/runner.js';
import { TRUST_SCHEMA, validateTrustPolicy } from '../src/lib/verify/trust.js';

const CLI = path.resolve('src', 'cli.js');
function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); }
function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-verify-runner-'));
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 'verify@example.test'); git(root, 'config', 'user.name', 'Verify Fixture');
  fs.writeFileSync(path.join(root, 'app.js'), 'export default 1;\n'); git(root, 'add', 'app.js'); git(root, 'commit', '-qm', 'app');
  return root;
}

test('trust policy accepts argv arrays and rejects shell strings', () => {
  const policy = validateTrustPolicy({ schema: TRUST_SCHEMA, commands: [{ id: 'tests', argv: ['node', '--version'], evidence: 'test-result' }] });
  assert.deepEqual(policy.commands[0].argv, ['node', '--version']);
  assert.throws(() => validateTrustPolicy({ schema: TRUST_SCHEMA, commands: [{ argv: 'node --version' }] }), /argv array/);
});

test('trusted environment strips secrets unless a reviewed policy names them', () => {
  const base = { PATH: 'bin', SECRET_TOKEN: 'never', SAFE_FLAG: 'yes' };
  const env = buildTrustedEnv({ allowedEnv: ['SAFE_FLAG'] }, base);
  assert.equal(env.SECRET_TOKEN, undefined);
  assert.equal(env.SAFE_FLAG, 'yes');
  assert.equal(env.CI, '1');
});

test('bounded runner records success and kills work on timeout', async () => {
  const ok = await runBounded([process.execPath, '-e', 'process.stdout.write("ok")'], { cwd: process.cwd(), env: process.env, timeoutMs: 2000, maxOutputBytes: 1024 });
  assert.equal(ok.code, 0);
  assert.equal(ok.timedOut, false);
  const timeout = await runBounded([process.execPath, '-e', 'setInterval(()=>{},1000)'], { cwd: process.cwd(), env: process.env, timeoutMs: 100, maxOutputBytes: 1024 });
  assert.equal(timeout.timedOut, true);
  assert.notEqual(timeout.code, 0);
});

test('trusted CLI runs only a committed reviewed policy in a separate worktree', () => {
  const root = repo();
  const policy = { schema: TRUST_SCHEMA, commands: [{ id: 'tests', argv: [process.execPath, '-e', 'process.exit(0)'], evidence: 'test-result', timeoutMs: 5000 }] };
  fs.writeFileSync(path.join(root, 'trust.json'), JSON.stringify(policy)); git(root, 'add', 'trust.json'); git(root, 'commit', '-qm', 'trust');
  const run = spawnSync(process.execPath, [CLI, 'verify', '--mode', 'trusted', '--trust-policy', 'trust.json', '--claim', 'All tests passed', '--json'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000, env: { ...process.env, PRAXIS_KEY_DIR: path.join(os.tmpdir(), `praxis-key-${process.pid}`) } });
  assert.equal(run.status, 3, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.mode, 'trusted');
  assert.equal(result.decision.decisions[0].verdict, 'UNSUPPORTED');
  assert.equal(result.observations.some((o) => o.observer === 'trusted-command'), true);
  assert.equal(fs.existsSync(path.join(root, '.git', 'worktrees')), false, 'temporary worktree metadata is cleaned');
});

test('timeout terminates a descendant before it can keep working', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-verify-descendant-'));
  const marker = path.join(root, 'survived.txt');
  const childCode = `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'survived'),800); setInterval(()=>{},1000);`;
  const parentCode = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'}); setInterval(()=>{},1000);`;
  const result = await runBounded([process.execPath, '-e', parentCode], { cwd: root, env: process.env, timeoutMs: 100, maxOutputBytes: 1024 });
  assert.equal(result.timedOut, true);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(fs.existsSync(marker), false, 'descendant did not survive the timed-out command');
});
