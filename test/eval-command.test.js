import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = path.resolve('src/cli.js');

test('eval waits for an actual agent exit, emits one JSON record, and cannot pass unsupported output', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-eval-command-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.praxis', 'evals'), { recursive: true });
  fs.writeFileSync(path.join(root, '.praxis', 'evals', 'slow.json'), JSON.stringify({ name: 'slow', cases: [{ id: 'unsupported', task: 'Check documentation' }] }));
  const agent = path.join(root, 'agent.cjs');
  fs.writeFileSync(agent, "process.stdin.resume(); process.stdin.on('end', () => setTimeout(() => { console.log('Done: everything works'); }, 700));");
  const started = Date.now();
  const run = spawnSync(process.execPath, [CLI, 'eval', 'slow', '--json'], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { ...process.env, PRAXIS_RUN_CMD: JSON.stringify([process.execPath, agent]), PRAXIS_NO_TRAY: '1' },
  });
  assert.equal(run.status, 1, run.stderr + run.stdout);
  const output = JSON.parse(run.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.metrics.passed, 0);
  assert.equal(output.results[0].receiptVerdict, 'NO_RECEIPT');
  assert.ok(Date.now() - started >= 700, 'scoring must wait for the detached agent, not just its launch');
  const meta = JSON.parse(fs.readFileSync(path.join(root, '.praxis', 'jobs', output.results[0].jobId, 'meta.json')));
  assert.equal(meta.exitCode, 0);
  assert.ok(meta.receiptLinkedAt, 'wait through the receipt linking phase even when no format is supported');
});
