import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  MIN_NODE,
  checkNode,
  checkGit,
  checkAgentCli,
  checkHooks,
  checkMemoryBlock,
  checkMcp,
  checkSigningKey,
  checkWritable,
  runChecks,
  preflight,
  summarize,
  detectTools,
} from '../src/lib/doctor.js';
import { detectTools as healthDetectTools } from '../src/lib/health.js';

function tmpProject(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-doctor-' + name + '-'));
  return dir;
}

// Every failing check must hand back something the reader can type. This is the
// whole contract of the library: a diagnosis with no fix is just bad news.
function assertFixShape(c) {
  assert.equal(typeof c.id, 'string');
  assert.equal(typeof c.label, 'string');
  assert.equal(typeof c.detail, 'string');
  if (c.ok) assert.equal(c.fix, null, `${c.id}: passing checks carry no fix`);
  else assert.ok(c.fix && c.fix.length > 5, `${c.id}: failing check must carry a real fix`);
}

test('checkNode: ok at or above the advertised line, honest grace below it', () => {
  const good = checkNode(`v${MIN_NODE}.3.1`);
  assert.equal(good.ok, true);
  assertFixShape(good);

  const old = checkNode('v20.11.0');
  assert.equal(old.ok, false);
  assert.match(old.detail, /still RUNS here/, 'the one-release grace is stated, not hidden');
  assert.match(old.fix, new RegExp(String(MIN_NODE)));
  assertFixShape(old);
});

test('checkGit / checkAgentCli: both states, injectable probes so tests never touch PATH', () => {
  const gitOk = checkGit(() => true);
  assert.equal(gitOk.ok, true);
  assertFixShape(gitOk);

  const gitBad = checkGit(() => false);
  assert.equal(gitBad.ok, false);
  assert.match(gitBad.fix, /git-scm\.com/);
  assertFixShape(gitBad);

  const agentOk = checkAgentCli((bin) => bin === 'claude');
  assert.equal(agentOk.ok, true);
  assert.match(agentOk.detail, /claude/);

  const agentNone = checkAgentCli(() => false);
  assert.equal(agentNone.ok, false);
  assert.match(agentNone.fix, /claude-code/);
  assertFixShape(agentNone);
});

test('checkHooks: missing, legacy bare-praxis, and correctly wired', () => {
  const dir = tmpProject('hooks');

  const none = checkHooks(dir);
  assert.equal(none.ok, false);
  assert.match(none.detail, /no \.claude\/settings\.json/);
  assertFixShape(none);

  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude', 'settings.json'),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'praxis capture' }] }] } }),
  );
  const legacy = checkHooks(dir);
  assert.equal(legacy.ok, false, 'bare `praxis` in a hook is the npx-only-install bug');
  assert.match(legacy.detail, /bare `praxis`/);

  fs.writeFileSync(
    path.join(dir, '.claude', 'settings.json'),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'npx -y praxis-memory capture' }] }] } }),
  );
  const wired = checkHooks(dir);
  assert.equal(wired.ok, true);
  assertFixShape(wired);
});

test('checkMemoryBlock: the CLAUDE.md block is what makes memory automatic', () => {
  const dir = tmpProject('claudemd');
  const missing = checkMemoryBlock(dir);
  assert.equal(missing.ok, false);
  assertFixShape(missing);

  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Mine\n');
  const noBlock = checkMemoryBlock(dir);
  assert.equal(noBlock.ok, false);
  assert.match(noBlock.detail, /no PRAXIS block/);

  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Mine\n<!-- PRAXIS:START -->\n@.praxis/memory.md\n');
  assert.equal(checkMemoryBlock(dir).ok, true);
});

test('checkMcp: absent file, present-but-unregistered, registered', () => {
  const dir = tmpProject('mcp');
  assert.equal(checkMcp(dir).ok, false);

  fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { supabase: { type: 'http' } } }));
  const other = checkMcp(dir);
  assert.equal(other.ok, false, 'someone else being registered is not us being registered');
  assert.match(other.detail, /no praxis server/);
  assertFixShape(other);

  fs.writeFileSync(
    path.join(dir, '.mcp.json'),
    JSON.stringify({ mcpServers: { supabase: {}, praxis: { command: 'npx', args: ['-y', 'praxis-memory', 'mcp'] } } }),
  );
  assert.equal(checkMcp(dir).ok, true);
});

test('checkSigningKey: reports ready before the first seal, present after', () => {
  const dir = tmpProject('keys');
  const keyDir = path.join(dir, 'keys');

  const notYet = checkSigningKey(keyDir);
  assert.equal(notYet.ok, true, 'no key yet is normal — it is generated lazily at the first seal');
  assert.match(notYet.detail, /first seal/);

  fs.mkdirSync(keyDir, { recursive: true });
  fs.writeFileSync(path.join(keyDir, 'ed25519.pkcs8.pem'), 'x');
  const present = checkSigningKey(keyDir);
  assert.equal(present.ok, true);
  assert.match(present.detail, /present at/);
});

test('checkWritable: passes on a real project dir', () => {
  const dir = tmpProject('writable');
  const c = checkWritable(dir);
  assert.equal(c.ok, true);
  assertFixShape(c);
});

test('runChecks returns every check, never throws, and summarize counts failures', () => {
  const dir = tmpProject('all');
  const results = runChecks(dir);
  assert.equal(results.length, 8);
  const ids = results.map((r) => r.id);
  assert.deepEqual(ids, ['node', 'git', 'agent-cli', 'writable', 'hooks', 'claudemd', 'mcp', 'key']);
  for (const r of results) assertFixShape(r);

  const s = summarize(results);
  assert.equal(s.total, 8);
  assert.equal(s.passed + s.failed.length, 8);
  // a bare temp dir has no hooks, no CLAUDE.md, no .mcp.json — three known failures
  assert.ok(s.failed.length >= 3, 'an uninitialized project reports its gaps');
});

test('preflight is the demo subset and never claims live is possible without an agent', () => {
  const dir = tmpProject('preflight');
  const p = preflight(dir);
  assert.equal(typeof p.canLive, 'boolean');
  assert.equal(p.checks.length, 2, 'preflight stays small — it runs before every demo');
  if (!p.canLive) assert.ok(p.blockers.length > 0, 'a false canLive must name its blockers');
});

test('the doctor CLI exists and renders the library (D89 — demo copy names it)', () => {
  const dir = tmpProject('cli');
  const cli = path.resolve('src', 'cli.js');
  const r = spawnSync(process.execPath, [cli, 'doctor'], { cwd: dir, encoding: 'utf8', timeout: 60000 });

  assert.equal(r.status, 1, 'an uninitialized project exits non-zero — the report is honest, not decorative');
  const out = String(r.stdout);
  for (const label of ['Node.js', 'git', 'Agent CLI', 'Capture hooks', 'Memory auto-load', 'PRAXIS tools']) {
    assert.ok(out.includes(label), `renders the "${label}" check`);
  }
  assert.match(out, /fix/, 'every failure shows its fix');
  assert.ok(!/at .*\.js:\d+/.test(out + r.stderr), 'never dumps a stack trace at the user');
});

test('health delegates tool detection to the doctor library (D42) — one source of truth', () => {
  assert.equal(healthDetectTools, detectTools, 'same function object, not a parallel implementation');
  const tools = detectTools();
  for (const key of ['claude', 'gemini', 'codex', 'cursor', 'antigravity']) {
    assert.equal(typeof tools[key], 'boolean', `${key} reported as a boolean`);
  }
});
