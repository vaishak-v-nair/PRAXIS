import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('a fresh CLI install never installs or probes optional runtimes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-postinstall-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'apps', 'workbench', 'backend'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(root, 'apps', 'workbench', 'package.json'), '{}');
  fs.writeFileSync(path.join(root, 'apps', 'workbench', 'backend', 'requirements.txt'), '');
  fs.copyFileSync('scripts/postinstall.js', path.join(root, 'scripts', 'postinstall.js'));
  // Intercept process launches before importing the REAL lifecycle script.
  // A regression fails without installing anything or contacting the network.
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const calls = [];
    for (const name of ['execSync', 'execFileSync', 'spawnSync', 'exec', 'execFile', 'spawn']) {
      cp[name] = (...args) => { calls.push({ name, command: args[0] }); throw new Error('unexpected runtime setup'); };
    }
    syncBuiltinESMExports();
    await import('./scripts/postinstall.js');
    console.log('CALLS=' + JSON.stringify(calls));
  `], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  const calls = JSON.parse(run.stdout.match(/^CALLS=(.*)$/m)[1]);
  assert.deepEqual(calls, [], 'npm install/npx must not implicitly run npm, pip, Python, or Docker');
  assert.equal(fs.existsSync(path.join(root, 'apps', 'workbench', '.venv')), false);
  assert.equal(fs.existsSync(path.join(root, 'apps', 'workbench', 'node_modules')), false);
});
