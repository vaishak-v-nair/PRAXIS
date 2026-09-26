import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { workbenchStatus, launchWorkbench } from '../src/lib/workbench.js';

const CLI = path.resolve('src/cli.js');

test('workbench help and readiness are inert, JSON-only, and report missing optional dependencies', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-workbench-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (args) => spawnSync(process.execPath, [CLI, 'workbench', ...args], {
    cwd: root, encoding: 'utf8', timeout: 15000, env: { ...process.env, PRAXIS_SKIP_TRAY: '1' },
  });
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Project execution and applying changes require confirmation/);
  assert.deepEqual(fs.readdirSync(root), [], 'help does not create configuration, jobs, or install dependencies');
  const missing = run(['--path', root, '--check', '--json']);
  assert.equal(missing.status, 1);
  const status = JSON.parse(missing.stdout);
  assert.equal(status.ok, false);
  assert.ok(status.missing.includes('application'));
  assert.deepEqual(fs.readdirSync(root), []);
  const launch = run(['--path', root]);
  assert.equal(launch.status, 1);
  assert.match(launch.stderr, /No dependencies were installed automatically/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('workbench waits for its coordinator, uses the app cwd, and preserves a nonzero service exit', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-workbench-launch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let requested;
  const start = Date.now();
  const result = await launchWorkbench({ root }, { production: true,
    spawnImpl: (command, args, options) => {
      requested = { command, args, options };
      return spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(7), 100)'], { cwd: options.cwd, stdio: 'ignore' });
    },
  });
  assert.equal(result, 7);
  assert.ok(Date.now() - start >= 100);
  assert.equal(requested.options.cwd, root);
  assert.equal(requested.options.windowsHide, true);
  assert.equal(requested.args.at(-1), 'start');
});

test('workbench readiness never certifies provider access or replaces the core package dependencies', () => {
  const status = workbenchStatus({ appPath: 'apps/workbench' });
  assert.equal(status.root, path.resolve('apps/workbench'));
  assert.equal(status.frontendUrl, 'http://127.0.0.1:3000');
  const core = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(Object.keys(core.dependencies || {}).length, 0);
  assert.ok(!core.files.includes('apps'), 'the optional app is outside the core tarball');
  assert.ok(fs.existsSync('src/commands/demo.js'));
  assert.ok(fs.existsSync('src/commands/deck.js'));
});
