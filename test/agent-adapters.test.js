import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { customAdapter, agentEnvironment, selectedTool } from '../src/lib/jobs/adapters.js';
import { agentSpawn } from '../src/lib/jobs/spawn.js';
import { buildAgentArgv } from '../src/commands/run.js';
import { parseEnvelope } from '../src/lib/jobs/receipt-link.js';

test('custom agents require explicit commands for each mode and do not inherit permission flags', () => {
  const env = { PRAXIS_AGENT_ADAPTERS: JSON.stringify({ aider: { plan: ['node', 'read-only.mjs'], acceptEdits: ['node', 'edit.mjs', '{taskFile}'] } }) };
  assert.deepEqual(customAdapter('aider', 'plan', env), ['node', 'read-only.mjs']);
  assert.deepEqual(buildAgentArgv(customAdapter('aider', 'plan', env), { injected: true }), ['node', 'read-only.mjs']);
  assert.throws(() => customAdapter('aider', 'bypassPermissions', env), /explicit argv/);
  assert.throws(() => customAdapter('aider', 'plan', { PRAXIS_AGENT_ADAPTERS: '{broken' }), /JSON object/);
  assert.equal(selectedTool(['--tool', 'aider', 'task']), 'aider');
  assert.throws(() => selectedTool(['--tool']), /requires/);
});

test('Gemini and OpenCode map permission modes; OpenCode draft denies commands and edits', () => {
  assert.ok(buildAgentArgv(['gemini'], { mode: 'plan' }).includes('plan'));
  assert.ok(buildAgentArgv(['gemini'], { mode: 'acceptEdits' }).includes('auto_edit'));
  assert.deepEqual(JSON.parse(agentEnvironment('opencode', 'plan').OPENCODE_PERMISSION), { '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow', list: 'allow' });
  assert.equal(JSON.parse(agentEnvironment('opencode', 'acceptEdits').OPENCODE_PERMISSION).edit, 'allow');
});

test('generic agent receives exact stdin and task file; real nonzero exit is preserved', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-custom-agent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const task = 'Inspect this literally: $(whoami) & "quoted"\nsecond line';
  const entry = path.join(root, 'fixture.mjs');
  fs.writeFileSync(entry, "import fs from 'node:fs'; let input=''; process.stdin.on('data', c=>input+=c); process.stdin.on('end',()=>{ console.log(JSON.stringify({stdin:input,file:fs.readFileSync(process.argv[2],'utf8')})); process.exit(7); });");
  fs.writeFileSync(path.join(root, 'task.txt'), task);
  fs.writeFileSync(path.join(root, 'meta.json'), JSON.stringify({ task, argv: [process.execPath, entry, '{taskFile}'], cwd: root }));
  const result = spawnSync(process.execPath, [path.resolve('src/lib/jobs/runner.mjs'), root], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'out.log'), 'utf8')), { stdin: task, file: task });
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'meta.json'), 'utf8')).exitCode, 7);
});

test('run --tool selects a custom agent without adding its name to the task', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-agent-select-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entry = path.join(root, 'fixture.mjs');
  fs.writeFileSync(entry, "let input=''; process.stdin.on('data', c=>input+=c); process.stdin.on('end',()=>console.log(input));");
  const env = { ...process.env, PRAXIS_SKIP_TRAY: '1', PRAXIS_RUN_CMD: '',
    PRAXIS_AGENT_ADAPTERS: JSON.stringify({ other: { plan: [process.execPath, entry] } }) };
  const cli = path.resolve('src/cli.js');
  const result = spawnSync(process.execPath, [cli, 'run', '--tool', 'other', 'Exact task'], { cwd: root, env, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  const jobs = path.join(root, '.praxis', 'jobs');
  const job = path.join(jobs, fs.readdirSync(jobs).find(name => name.startsWith('j-')));
  const deadline = Date.now() + 15000;
  let meta;
  while (Date.now() < deadline) {
    try { meta = JSON.parse(fs.readFileSync(path.join(job, 'meta.json'), 'utf8')); } catch { /* Concurrent writer. */ }
    if (meta?.receiptLinkedAt) break;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.equal(meta.tool, 'other');
  assert.equal(meta.task, 'Exact task');
  assert.equal(meta.mode, 'plan');
  assert.equal(meta.exitCode, 0);
  assert.equal(fs.readFileSync(path.join(job, 'out.log'), 'utf8').trim(), 'Exact task');
  const execution = spawnSync(process.execPath, [cli, 'run', '--tool', 'other', '--allow-edits', 'Not supported'], { cwd: root, env, encoding: 'utf8', timeout: 15000 });
  assert.equal(execution.status, 1);
  assert.match(execution.stdout, /explicit argv/);
  assert.equal(fs.readdirSync(jobs).filter(name => name.startsWith('j-')).length, 1);
});

test('Windows npm shim runs Node directly; unknown cmd refuses metacharacters', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-shim-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const shim = path.join(root, 'agent.cmd'), entry = path.join(root, 'agent.js');
  fs.writeFileSync(entry, '');
  fs.writeFileSync(shim, '"%dp0%\\agent.js" %*');
  assert.deepEqual(agentSpawn([shim, '& literal'], { platform: 'win32' }), { file: process.execPath, args: [entry, '& literal'] });
  fs.writeFileSync(shim, 'custom launcher');
  assert.throws(() => agentSpawn([shim, '& danger'], { platform: 'win32' }), /Unsafe/);
  assert.throws(() => agentSpawn(['missing-coding-agent'], { platform: 'win32', env: { PATH: root } }), /executable unavailable/);
});

test('Gemini/OpenCode final text is display evidence; no verdict is invented', () => {
  assert.equal(parseEnvelope(JSON.stringify({ response: 'Reviewed', stats: {} })).resultText, 'Reviewed');
  const parsed = parseEnvelope(JSON.stringify({ type: 'text', sessionID: 'opaque-session', part: { text: 'Review only' } }));
  assert.equal(parsed.resultText, 'Review only');
  assert.equal(parsed.sessionId, 'opaque-session');
  assert.equal(parsed.verdict, undefined);
});
