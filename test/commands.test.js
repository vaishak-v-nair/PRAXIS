// Every command, actually invoked.
//
// Fifteen of the twenty-seven things a person can type had 0% FUNCTION coverage
// — their exported entry point had never been called by a test, not once. The
// small line percentages next to them in the coverage report were import
// statements executing, nothing more. The libraries underneath were at 90-100%,
// so the logic was well tested; what was untested was the layer the user
// touches, which is where argument handling, output and exit codes live.
//
// These are deliberately shallow. Depth belongs in the library tests that
// already exist. What each one proves is that the command runs, does the
// observable thing it claims, and does not throw on the paths a real person
// hits — including the ones with no arguments at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { health } from '../src/commands/health.js';
import { checkpoint } from '../src/commands/checkpoint.js';
import { trace } from '../src/commands/trace.js';
import { vault } from '../src/commands/vault.js';
import { switchTool } from '../src/commands/switch.js';
import { forget } from '../src/commands/forget.js';
import { save } from '../src/commands/save.js';
import { gate } from '../src/commands/gate.js';
import { recap } from '../src/commands/recap.js';
import { telemetry } from '../src/commands/telemetry.js';
import { remember } from '../src/commands/remember.js';
import { deck } from '../src/commands/deck.js';
import { uninstall } from '../src/commands/uninstall.js';
import { status } from '../src/commands/status.js';
import { doctor } from '../src/commands/doctor.js';

const CLI = path.resolve('src', 'cli.js');

/**
 * Run a command inside a throwaway PRAXIS project.
 *
 * Almost every command resolves its paths from process.cwd(), so the cwd IS the
 * argument. Output is captured rather than printed: a test run should not be
 * three hundred lines of axolotl.
 */
async function inProject(fn, { memory = '# PRAXIS Memory\n\n## Project\nA test project.\n\n## Session Log\n' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-cmd-'));
  fs.mkdirSync(path.join(root, '.praxis'), { recursive: true });
  fs.writeFileSync(path.join(root, '.praxis', 'memory.md'), memory);
  fs.writeFileSync(path.join(root, '.praxis', 'config.json'), JSON.stringify({ capture: true, maxLogBytes: 16384 }));

  const cwd = process.cwd();
  const out = [];
  const log = console.log;
  const err = console.error;
  // Only console is intercepted. process.stdout.write is deliberately left
  // alone: the test runner emits its own results through it, and swallowing
  // those turns a passing file into a corrupt one. Commands that write straight
  // to stdout (`--json`, via jsonout.js) are exercised by spawning instead.
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  // Commands report failure by setting process.exitCode rather than throwing.
  // In-process that lands on the TEST RUNNER's own exit code, so a file full of
  // passing tests exits 1 and is reported as failed. Capture it, reset it, and
  // hand it back — the exit code is part of the CLI's contract with scripts, so
  // it is worth asserting on rather than merely surviving.
  const priorExit = process.exitCode;
  process.exitCode = 0;
  try {
    process.chdir(root);
    const result = await fn(root);
    return { root, out: out.join('\n'), result, exitCode: process.exitCode || 0 };
  } finally {
    process.chdir(cwd);
    console.log = log;
    console.error = err;
    process.exitCode = priorExit;
  }
}

const strip = (s) => s.replace(/\[[0-9;]*m/g, '');

// ── memory commands ──────────────────────────────────────────────────────────

test('remember writes a fact, forget takes it back out', async () => {
  const { root, out } = await inProject(async () => {
    remember(['the deploy key lives in 1Password']);
    await forget(['1Password', '--yes']);
  });
  assert.match(strip(out), /1Password/, 'both halves report what they did');
  const mem = fs.readFileSync(path.join(root, '.praxis', 'memory.md'), 'utf8');
  assert.doesNotMatch(mem, /1Password/, 'and the fact is genuinely gone from the file');
});

test('remember with no argument explains itself instead of writing nothing quietly', async () => {
  const { out, root } = await inProject(async () => remember([]));
  assert.ok(strip(out).length > 10, 'says what it wanted');
  const mem = fs.readFileSync(path.join(root, '.praxis', 'memory.md'), 'utf8');
  assert.doesNotMatch(mem, /undefined/, 'and never writes the word undefined into memory');
});

test('forget that matches nothing says so and changes nothing', async () => {
  const before = '# PRAXIS Memory\n\n## Project\nA test project.\n';
  const { root, out } = await inProject(async () => forget(['nothing-matches-this-xyz', '--yes']), { memory: before });
  assert.equal(fs.readFileSync(path.join(root, '.praxis', 'memory.md'), 'utf8'), before, 'byte for byte untouched');
  assert.ok(strip(out).length > 0);
});

test('recap reads the project memory back', async () => {
  const { out } = await inProject(async () => recap(), {
    memory: '# PRAXIS Memory\n\n## Project\nShips receipts.\n\n## Session Log\n### 2026-08-01 - session\n- did a thing\n',
  });
  assert.match(strip(out), /Ships receipts|did a thing/, 'the memory is what it shows');
});

test('save survives a project with no session to save', async () => {
  // A temp dir has no Claude transcript. This is the ordinary case for anyone
  // running it in a fresh project, and it must not look like a crash.
  const { out } = await inProject(async () => save());
  assert.ok(strip(out).length > 0, 'it explains rather than failing silently');
});

// ── diagnosis and status ─────────────────────────────────────────────────────

test('health runs with no session and still reports', async () => {
  const { out } = await inProject(async () => health([]));
  assert.ok(strip(out).length > 0);
});

test('doctor returns an exit code and names the checks', async () => {
  const { out, result } = await inProject(async () => doctor([]));
  assert.equal(typeof result, 'number', 'doctor exit code is what the CLI passes to process.exitCode');
  assert.match(strip(out), /Capture/, 'the human report names the checks');
});

test('status renders for a human, and for a script it carries the capture claim', async () => {
  const human = await inProject(async () => status({}));
  assert.ok(strip(human.out).length > 0);

  // The machine shape goes through process.stdout.write, so it gets a real
  // process rather than an interception that would fight the test runner.
  const { root } = await inProject(async () => {});
  const parsed = JSON.parse(execFileSync(process.execPath, [CLI, 'status', '--json'], { cwd: root, encoding: 'utf8', timeout: 60000 }));
  assert.equal(parsed.initialized, true);
  assert.equal(typeof parsed.capture.ok, 'boolean', 'the machine shape carries "did it actually run"');
  assert.equal(typeof parsed.receipts.armed, 'boolean', 'alongside the older "is it installed"');
});

test('telemetry reports its state without sending anything', async () => {
  const { out } = await inProject(async () => telemetry([]));
  assert.match(strip(out), /telemetry|off|on/i);
});

// ── project wiring ───────────────────────────────────────────────────────────

test('vault with no argument reports rather than guessing a path', async () => {
  const { out, root } = await inProject(async () => vault([]));
  assert.ok(strip(out).length > 0);
  const cfg = JSON.parse(fs.readFileSync(path.join(root, '.praxis', 'config.json'), 'utf8'));
  assert.equal(cfg.vault, undefined, 'reading is not writing');
});

test('vault records a directory inside the project, and refuses one outside home', async () => {
  // Both halves of the confinement rule (vaultPathAllowed): a vault must live
  // under $HOME or inside the repo. Anything else is a typo or a hostile repo
  // pointing PRAXIS at somewhere it should not write.
  //
  // The first version of this test used os.tmpdir() and passed on Windows only
  // — there tmpdir is C:\Users\<you>\AppData\Local\Temp, which IS under home,
  // so the vault was accepted. On Linux and macOS /tmp is not, so it was
  // correctly refused and the assertion failed. The rule was right; the test
  // was reading one platform's filesystem layout as if it were universal.
  const inside = await inProject(async (root) => {
    const target = path.join(root, 'notes');
    fs.mkdirSync(target, { recursive: true });
    vault([target]);
  });
  const cfgIn = JSON.parse(fs.readFileSync(path.join(inside.root, '.praxis', 'config.json'), 'utf8'));
  assert.ok(cfgIn.vault, 'a vault inside the repo is persisted, not just printed');

  // Somewhere that is neither home nor this repo. On Windows tmpdir lives under
  // home, so build the outside path from the filesystem root instead — the
  // point is "outside", and that has to mean outside on every platform.
  const outside = path.join(path.parse(process.cwd()).root, 'praxis-not-my-vault');
  const refused = await inProject(async () => vault([outside]));
  const cfgOut = JSON.parse(fs.readFileSync(path.join(refused.root, '.praxis', 'config.json'), 'utf8'));
  assert.equal(cfgOut.vault, undefined, 'a path outside home and the repo is refused, not written');
  assert.ok(strip(refused.out).length > 0, 'and it says why rather than failing silently');
});

test('switch with no target lists what it could switch to', async () => {
  const { out } = await inProject(async () => switchTool([]));
  assert.ok(strip(out).length > 0);
});

test('checkpoint runs non-interactively — a hook shell is never a TTY', async () => {
  // checkpoint asks questions when it can. In a test (and in Claude's own
  // shell, and in a hook) stdin is not a TTY and it must take the safe default
  // instead of hanging forever waiting for an answer nobody will type.
  const { out } = await inProject(async () => checkpoint([]));
  assert.ok(strip(out).length > 0, 'it got to the end without waiting for input');
});

// ── git-facing ───────────────────────────────────────────────────────────────

test('gate and trace degrade honestly outside a git repo, and say so in the exit code', async () => {
  const g = await inProject(async () => gate([]));
  const t = await inProject(async () => trace([]));
  for (const r of [g, t]) {
    assert.ok(strip(r.out).length > 0, 'it explains itself');
    assert.doesNotMatch(strip(r.out), /ENOENT|Traceback|at Object\./, 'no raw stack ever reaches a user');
    assert.equal(r.exitCode, 1, 'and a script can tell it did not work without parsing prose');
  }
});

// ── removal ──────────────────────────────────────────────────────────────────

test('uninstall --dry-run shows the plan and touches nothing', async () => {
  const { root, out } = await inProject(async () => uninstall(['--dry-run']));
  assert.match(strip(out), /dry-run/i);
  assert.ok(fs.existsSync(path.join(root, '.praxis', 'memory.md')), 'the memory is still there afterwards');
});

test('uninstall refuses to act unprompted when nobody can answer', async () => {
  // Not a TTY, no --yes: removing a project's memory because a script called it
  // is exactly the accident this guard exists for.
  const { root, out } = await inProject(async () => uninstall([]));
  assert.match(strip(out), /not a terminal|--yes/i);
  assert.ok(fs.existsSync(path.join(root, '.praxis', 'memory.md')), 'nothing was removed');
});

// ── the deck and the MCP server ──────────────────────────────────────────────

test('deck --help does not start a server', async () => {
  const { out } = await inProject(async () => deck(['--help']));
  assert.ok(strip(out).length > 0);
});

test('praxis mcp speaks JSON-RPC on stdio and lists its tools', () => {
  // The one command that cannot be called in-process: it owns stdin/stdout for
  // the protocol and only returns when the stream closes. So it gets spawned,
  // asked one real question, and closed.
  const req =
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    }) +
    '\n' +
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) +
    '\n';

  const out = execFileSync(process.execPath, [CLI, 'mcp'], { input: req, encoding: 'utf8', timeout: 60000 });
  const replies = out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const init = replies.find((r) => r.id === 1);
  const tools = replies.find((r) => r.id === 2);
  assert.equal(init.result.serverInfo.name, 'praxis');
  assert.ok(tools.result.tools.length >= 3, 'the model is handed real tools');
  assert.ok(tools.result.tools.every((t) => t.name.startsWith('praxis_')), 'and they are all ours');
});
