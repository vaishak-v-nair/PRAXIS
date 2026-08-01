#!/usr/bin/env node
// The leak guard. Nothing private has ever been pushed to the public repo —
// and this exists so that stays true by construction rather than by luck.
//
//   node scripts/ci/leak-guard.mjs        # check what git is actually tracking
//
// The problem it solves is written into .gitignore's own comments: the personal
// Obsidian vault sat untracked-but-not-ignored in this repo TWICE, both times
// because the folder was renamed and the pattern quietly stopped matching. 387
// files, one `git add -A` from public. A .gitignore is a filter, and a filter
// can only ever fail open — it protects nothing it does not happen to match.
//
// So this asks the opposite question. Instead of "did we remember to ignore
// it", it asks "is anything we KNOW is private in the index right now". That
// question has one answer, it is checkable in CI, and it does not care what
// anybody renamed.
//
// Exit 0 clean, 1 with the offending paths named.

import { spawnSync } from 'node:child_process';

/**
 * Everything gitignored on `main` whose presence in the index means something
 * went wrong. `publicOnly` marks the ones the `confidential` branch tracks on
 * purpose — the brand vault and the internal design docs live there by design,
 * so the guard must not cry wolf when it runs in the private worktree.
 */
export const RULES = [
  {
    id: 'obsidian',
    why: 'an Obsidian vault — personal notes, never public',
    publicOnly: false,
    test: (p) => p.split('/').includes('.obsidian'),
  },
  {
    id: 'vault',
    why: 'a personal-intelligence vault (matched by shape, so a rename cannot dodge it)',
    publicOnly: false,
    test: (p) => /(^|\/)[^/]*\s*Intelligence\//i.test(p),
  },
  {
    id: 'brand-vault',
    why: 'assets/ is the company-confidential brand vault; public renders belong in docs/',
    publicOnly: true,
    test: (p) => p === 'assets' || p.startsWith('assets/'),
  },
  {
    id: 'internal-docs',
    why: 'an internal design document, tracked only on the confidential branch',
    publicOnly: true,
    test: (p) => p === 'DESIGN.md' || p === 'TRAY-VISION.md',
  },
  {
    id: 'local-memory',
    why: '.praxis/ is this machine’s own memory and receipts — project details, not source',
    publicOnly: false,
    test: (p) => p === '.praxis' || p.startsWith('.praxis/'),
  },
  {
    id: 'personal-config',
    why: 'machine-local agent config — committing it runs hooks on teammates who never agreed',
    publicOnly: false,
    test: (p) => p.startsWith('.claude/') || p.startsWith('.agents/') || p === '.mcp.json' || p === 'CLAUDE.md',
  },
];

/**
 * Pure: given the tracked paths, which rules do they break?
 * Separated from git so the rule set is testable without a repo.
 *
 * @param {string[]} paths  forward-slash paths, as `git ls-files` reports them
 * @param {{branch?: string}} [opts]
 */
export function checkTrackedPaths(paths, opts = {}) {
  const branch = String(opts.branch || '');
  const confidential = branch === 'confidential';
  const active = RULES.filter((r) => !(confidential && r.publicOnly));
  const violations = [];
  for (const raw of paths) {
    const p = String(raw).replace(/\\/g, '/').trim();
    if (!p) continue;
    const rule = active.find((r) => r.test(p));
    if (rule) violations.push({ path: p, rule: rule.id, why: rule.why });
  }
  return { ok: violations.length === 0, violations, checked: paths.length, skipped: RULES.length - active.length };
}

/** Every path git currently tracks on this branch. */
export function trackedPaths() {
  const r = spawnSync('git', ['ls-files'], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('git ls-files failed: ' + (r.stderr || 'no output'));
  return r.stdout.split('\n').filter(Boolean);
}

function currentBranch() {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', timeout: 30000 });
  return r.status === 0 ? r.stdout.trim() : '';
}

function main() {
  let paths;
  try {
    paths = trackedPaths();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const branch = currentBranch();
  const res = checkTrackedPaths(paths, { branch });

  if (res.ok) {
    console.log(
      `PASS  ${res.checked} tracked paths, nothing private` +
        (res.skipped ? ` (${res.skipped} confidential-branch rules skipped on ${branch})` : ''),
    );
    process.exit(0);
  }

  console.error(`FAIL  ${res.violations.length} private path(s) are being tracked by git:\n`);
  const byRule = new Map();
  for (const v of res.violations) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, { why: v.why, paths: [] });
    byRule.get(v.rule).paths.push(v.path);
  }
  for (const [id, g] of byRule) {
    console.error(`  [${id}] ${g.why}`);
    for (const p of g.paths.slice(0, 10)) console.error(`      ${p}`);
    if (g.paths.length > 10) console.error(`      … and ${g.paths.length - 10} more`);
    console.error('');
  }
  console.error(
    'Do NOT just add a .gitignore rule — the file is already in the index, so ignoring it\n' +
      'changes nothing. Remove it from tracking first:\n\n' +
      '    git rm -r --cached <path>\n\n' +
      'and if it was ever pushed, treat the contents as public and rotate anything secret.',
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('leak-guard.mjs')) main();
