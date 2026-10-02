import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Exercise the real PowerShell entry point with inert commands. No package
// downloads, hook writes, backend execution or provider calls are permitted.
function run(t, flags = [], env = {}) {
  const root = fs.mkdtempSync(path.resolve('.test-tmp-start-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const checkout = path.join(root, 'checkout with spaces');
  fs.mkdirSync(checkout);
  fs.copyFileSync('start.ps1', path.join(checkout, 'start.ps1'));
  const log = path.join(root, 'calls.jsonl');
  const harness = path.join(root, 'harness.ps1');
  fs.writeFileSync(harness, `
function Record-Call($command, $arguments) {
  @{ command=$command; arguments=@($arguments); cwd=(Get-Location).Path } |
    ConvertTo-Json -Compress | Add-Content -LiteralPath $env:LAUNCHER_TEST_LOG
}
function global:node {
  Record-Call 'node' $args
  $global:LASTEXITCODE = 0
  if ($args[0] -eq '--version') { $env:LAUNCHER_TEST_NODE_VERSION }
  elseif ($args -contains '--check') { '{"ok":true,"missing":[]}' }
  elseif ($args -contains 'init') { throw 'Unexpected memory/hook initialization' }
  else { $global:LASTEXITCODE = [int]$env:LAUNCHER_TEST_SERVICE_EXIT }
}
function global:npm {
  Record-Call 'npm' $args
  $global:LASTEXITCODE = [int]$env:LAUNCHER_TEST_INSTALL_EXIT
}
function global:python { throw 'Unexpected Python installation after a failed npm command' }
& $env:LAUNCHER_TEST_SCRIPT ${flags.join(' ')}
exit $LASTEXITCODE
`, 'utf8');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness], {
    encoding: 'utf8', timeout: 15000, windowsHide: true,
    env: { ...process.env, LAUNCHER_TEST_LOG: log, LAUNCHER_TEST_SCRIPT: path.join(checkout, 'start.ps1'),
      LAUNCHER_TEST_NODE_VERSION: 'v22.0.0', LAUNCHER_TEST_INSTALL_EXIT: '8', LAUNCHER_TEST_SERVICE_EXIT: '0', ...env },
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split(/\r?\n/).map(JSON.parse) : [];
  return { ...result, calls, checkout };
}

test('Windows launcher check is inert and resolves a checkout with spaces from another cwd', { skip: process.platform !== 'win32' }, t => {
  const result = run(t, ['-Check']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(result.calls.map(c => c.command), ['node', 'node']);
  assert.ok(result.calls.every(c => c.cwd === result.checkout));
  assert.ok(result.calls[1].arguments.includes('--check'));
  assert.ok(result.calls[1].arguments.includes('--json'));
});

test('Windows launcher stops on a dependency failure before touching hooks or starting services', { skip: process.platform !== 'win32' }, t => {
  const result = run(t);
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls.map(c => c.command), ['node', 'npm']);
  assert.equal(result.calls[1].arguments[0], 'ci');
  assert.match(result.stderr + result.stdout, /exit code 8/);
});

test('Windows launcher rejects unsupported Node before installing anything', { skip: process.platform !== 'win32' }, t => {
  const result = run(t, [], { LAUNCHER_TEST_NODE_VERSION: 'v20.11.0' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls.map(c => c.command), ['node']);
  assert.match(result.stderr + result.stdout, /Node.js 22/);
});

test('Windows prepared launch preserves the service failure without implicit memory initialization', { skip: process.platform !== 'win32' }, t => {
  const result = run(t, ['-SkipInstall'], { LAUNCHER_TEST_SERVICE_EXIT: '6' });
  assert.equal(result.status, 6, result.stderr + result.stdout);
  assert.deepEqual(result.calls.map(c => c.command), ['node', 'node', 'node']);
  assert.equal(result.calls.at(-1).arguments.at(-1), 'workbench');
});
