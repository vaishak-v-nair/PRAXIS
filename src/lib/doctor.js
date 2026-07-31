// The diagnosis library. Every check is a pure-ish function returning the same
// shape — { id, label, ok, detail, fix } — so three callers can share one truth:
//
//   1. `praxis doctor`      — the human-facing report
//   2. the demo's preflight — decides whether live mode can be offered
//   3. `praxis health`      — tool detection, delegated here
//
// A check NEVER throws and NEVER spawns the agent: doctor must work on a broken
// machine, which is the only machine that runs it. `ok:false` always carries a
// `fix` the reader can actually type.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { TOOLS, isInstalled, onPath } from './tools.js';
import { projectPaths } from './paths.js';
import { praxisCmd } from './runner.js';

// The Node line PRAXIS advertises in package.json engines. Kept here as one
// constant so the doctor, the CI matrix and the engines field can be checked
// against each other instead of drifting (D22: advertised == tested).
export const MIN_NODE = 22;

/** Shape helper — keeps every check honest about carrying a fix. */
function check(id, label, ok, detail, fix) {
  return { id, label, ok, detail, fix: ok ? null : fix };
}

/**
 * Which AI tools exist on this machine. Single source of truth — `praxis
 * health` imports this rather than detecting separately (D42).
 */
export function detectTools() {
  const installed = {};
  for (const [key, t] of Object.entries(TOOLS)) installed[key] = isInstalled(t);
  return installed;
}

/** Node major version, honest about the one-release grace. */
export function checkNode(version = process.version) {
  const major = Number(String(version).replace(/^v/, '').split('.')[0]) || 0;
  if (major >= MIN_NODE) {
    return check('node', 'Node.js', true, `${version} — supported`);
  }
  return check(
    'node',
    'Node.js',
    false,
    `${version} — PRAXIS supports Node ${MIN_NODE}+. This release still RUNS here, but that grace ends next minor.`,
    `Upgrade Node to ${MIN_NODE} or newer: https://nodejs.org`,
  );
}

/** git — receipts record git activity; without it that evidence is simply absent. */
export function checkGit(probe = () => onPath('git')) {
  const found = probe();
  return check(
    'git',
    'git',
    found,
    found ? 'on PATH' : 'not found',
    'Install git (https://git-scm.com) — receipts record commits and branches when it is present.',
  );
}

/**
 * An agent CLI to do real work. Presence only — we never spawn it to test auth,
 * because a doctor that costs a model call is not a doctor.
 */
export function checkAgentCli(probe = (bin) => onPath(bin)) {
  const found = ['claude', 'codex', 'gemini'].filter(probe);
  return check(
    'agent-cli',
    'Agent CLI',
    found.length > 0,
    found.length ? `${found.join(', ')} on PATH` : 'none found (claude, codex, gemini)',
    'Install Claude Code: npm install -g @anthropic-ai/claude-code — needed for live jobs and the judge.',
  );
}

/** The Stop / PreCompact hooks that make capture automatic. (The SessionStart
 *  tray hook is opt-in since 0.11.1, so its absence is never a fault.) */
export function checkHooks(cwd = process.cwd()) {
  const p = projectPaths(cwd);
  // Hooks live in the personal file by default and the shared one by choice
  // (D85). A doctor that only knew about one would call a perfectly good
  // install broken — and this is the command people run precisely when they
  // are already unsure whether anything is working.
  const read = (f) => {
    try {
      return fs.readFileSync(f, 'utf8');
    } catch {
      return '';
    }
  };
  const local = read(p.settingsLocalFile);
  const shared = read(p.settingsFile);
  if (!local && !shared) {
    return check(
      'hooks',
      'Capture hooks',
      false,
      'no .claude/settings.json or settings.local.json in this project',
      `Run ${praxisCmd()} init here.`,
    );
  }
  const raw = local + shared;
  const wired = raw.includes('praxis-memory capture');
  const legacy = /"command"\s*:\s*"praxis\s/.test(raw);
  const scope = local.includes('praxis-memory capture') ? 'just you' : 'whole project';
  if (wired && !legacy) return check('hooks', 'Capture hooks', true, `Stop + PreCompact wired through npx (${scope})`);
  return check(
    'hooks',
    'Capture hooks',
    false,
    legacy ? 'hooks call bare `praxis` — breaks on npx-only installs' : 'hooks not installed',
    `Run ${praxisCmd()} init — it rewrites hooks to the npx form.`,
  );
}

/** The CLAUDE.md managed block — this is what auto-loads memory each session. */
export function checkMemoryBlock(cwd = process.cwd()) {
  const p = projectPaths(cwd);
  let raw = '';
  try {
    raw = fs.readFileSync(p.claudeMd, 'utf8');
  } catch {
    return check('claudemd', 'Memory auto-load', false, 'no CLAUDE.md', `Run ${praxisCmd()} init here.`);
  }
  const ok = raw.includes('PRAXIS:START');
  return check(
    'claudemd',
    'Memory auto-load',
    ok,
    ok ? 'CLAUDE.md includes the PRAXIS block' : 'CLAUDE.md has no PRAXIS block',
    `Run ${praxisCmd()} init — your own CLAUDE.md content is never touched.`,
  );
}

/** .mcp.json — what puts the praxis_* tools in the model's hands with no command. */
export function checkMcp(cwd = process.cwd()) {
  const p = projectPaths(cwd);
  let cfg = null;
  try {
    cfg = JSON.parse(fs.readFileSync(p.mcpFile, 'utf8'));
  } catch {
    return check('mcp', 'PRAXIS tools (MCP)', false, 'no .mcp.json', `Run ${praxisCmd()} init here.`);
  }
  const ok = Boolean(cfg && cfg.mcpServers && cfg.mcpServers.praxis);
  return check(
    'mcp',
    'PRAXIS tools (MCP)',
    ok,
    ok ? 'praxis server registered' : '.mcp.json exists but has no praxis server',
    `Run ${praxisCmd()} init — it adds praxis without disturbing servers you already registered.`,
  );
}

/** The signing key: receipts seal with it, so an unwritable key dir is fatal to proof. */
export function checkSigningKey(keyDir = process.env.PRAXIS_KEY_DIR || path.join(os.homedir(), '.praxis', 'keys')) {
  if (fs.existsSync(keyDir)) {
    const has = (() => {
      try {
        return fs.readdirSync(keyDir).some((f) => f.startsWith('ed25519'));
      } catch {
        return false;
      }
    })();
    return check(
      'key',
      'Signing key',
      true,
      has ? `present at ${keyDir}` : `${keyDir} ready — key is generated at the first seal`,
    );
  }
  const parent = path.dirname(keyDir);
  let writable = true;
  try {
    fs.accessSync(fs.existsSync(parent) ? parent : os.homedir(), fs.constants.W_OK);
  } catch {
    writable = false;
  }
  return check(
    'key',
    'Signing key',
    writable,
    writable ? 'not created yet — generated at the first seal' : `cannot write to ${parent}`,
    `Make ${parent} writable, or point PRAXIS_KEY_DIR somewhere you own.`,
  );
}

/** Can this project actually store memory and receipts? */
export function checkWritable(cwd = process.cwd()) {
  const p = projectPaths(cwd);
  const target = fs.existsSync(p.praxisDir) ? p.praxisDir : cwd;
  try {
    fs.accessSync(target, fs.constants.W_OK);
    return check('writable', 'Project writable', true, `${target} is writable`);
  } catch {
    return check(
      'writable',
      'Project writable',
      false,
      `cannot write to ${target}`,
      'Check folder permissions — PRAXIS writes memory and receipts here.',
    );
  }
}

/**
 * Every check, in report order. `cwd` scopes the project-local ones.
 * Never throws: a check that blows up is reported as a failed check.
 */
export function runChecks(cwd = process.cwd()) {
  const checks = [
    ['node', () => checkNode()],
    ['git', () => checkGit()],
    ['agent-cli', () => checkAgentCli()],
    ['writable', () => checkWritable(cwd)],
    ['hooks', () => checkHooks(cwd)],
    ['claudemd', () => checkMemoryBlock(cwd)],
    ['mcp', () => checkMcp(cwd)],
    ['key', () => checkSigningKey()],
  ];
  return checks.map(([id, run]) => {
    try {
      return run();
    } catch (e) {
      return check(
        id,
        id,
        false,
        `check failed: ${e.message}`,
        'Report this at https://github.com/vaishak-v-nair/PRAXIS/issues',
      );
    }
  });
}

/**
 * The subset the demo needs before it may offer live mode (D42/D43).
 * Returns { canLive, blockers } — never spends a token deciding.
 */
export function preflight(cwd = process.cwd()) {
  const agent = checkAgentCli();
  const writable = checkWritable(cwd);
  const blockers = [agent, writable].filter((c) => !c.ok);
  return { canLive: blockers.length === 0, blockers, checks: [agent, writable] };
}

/** Used by the doctor CLI to decide its exit code. */
export function summarize(results) {
  const failed = results.filter((r) => !r.ok);
  return { total: results.length, passed: results.length - failed.length, failed };
}

// Kept so callers that only want a version string do not import child_process.
export function nodeVersionOf(bin) {
  try {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 4000, windowsHide: true });
    return r.status === 0 ? String(r.stdout).trim() : null;
  } catch {
    return null;
  }
}
