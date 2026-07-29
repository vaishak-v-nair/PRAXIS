import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { checkBudget, parsePackJson, BUDGET_MB } from '../scripts/ci/tarball-budget.mjs';
import { runWithConcurrency, summarize, DEFAULT_CONCURRENCY } from '../scripts/ci/run-live-evals.mjs';
import { sections, notesFor } from '../scripts/ci/changelog.mjs';

const MB = 1024 * 1024;
const CHANGELOG = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

test('tarball budget: passes under, fails over, and always names the size', () => {
  const under = checkBudget(2.8 * MB);
  assert.equal(under.ok, true);
  assert.match(under.message, /2\.80MB/);
  assert.match(under.message, /3\.50MB/);

  const over = checkBudget(4 * MB);
  assert.equal(over.ok, false);
  assert.match(over.message, /EXCEEDS/);
  assert.match(over.message, /4\.00MB/, 'the failure names the actual size, not just "too big"');

  const exact = checkBudget(BUDGET_MB * MB);
  assert.equal(exact.ok, true, 'exactly at budget is within budget');
});

test('tarball budget: reads npm pack --json, refuses to guess when the field is missing', () => {
  const good = parsePackJson(
    JSON.stringify([{ name: 'praxis-memory', version: '0.10.0', entryCount: 71, unpackedSize: 2937000 }]),
  );
  assert.equal(good.unpackedSize, 2937000);
  assert.equal(good.files, 71);
  assert.equal(good.version, '0.10.0');

  assert.throws(() => parsePackJson('[{"name":"x"}]'), /unpackedSize/);
  assert.throws(() => parsePackJson('not json'), SyntaxError);
});

test('live-eval runner: bounded concurrency, order preserved', async () => {
  const items = Array.from({ length: 9 }, (_, i) => i);
  let inFlight = 0;
  let peak = 0;

  const out = await runWithConcurrency(
    items,
    async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    },
    3,
  );

  assert.deepEqual(out, items.map((n) => n * 2), 'results come back in input order');
  assert.ok(peak <= 3, `never exceeded the limit (peak ${peak})`);
  assert.ok(peak > 1, 'actually ran concurrently');
});

test('live-eval runner: a single false accusation fails the whole run', () => {
  const clean = summarize([
    { name: 'a', expectPass: true, forbidPass: true },
    { name: 'b', expectPass: true, forbidPass: true },
  ]);
  assert.equal(clean.ok, true);
  assert.match(clean.line, /2\/2/);

  const missed = summarize([
    { name: 'a', expectPass: true, forbidPass: true },
    { name: 'b', expectPass: false, forbidPass: true },
  ]);
  assert.equal(missed.ok, false, 'a missed rule blocks the release');
  assert.equal(missed.falseAccusations.length, 0);

  const accused = summarize([
    { name: 'a', expectPass: true, forbidPass: true },
    { name: 'b', expectPass: true, forbidPass: false },
  ]);
  assert.equal(accused.ok, false);
  assert.equal(accused.falseAccusations.length, 1, 'the false-accusation floor is zero, non-negotiable');
});

test('live-eval runner: default concurrency is sane', () => {
  assert.ok(DEFAULT_CONCURRENCY >= 1 && DEFAULT_CONCURRENCY <= 8);
});

// ── the changelog gate ───────────────────────────────────────────────────────
// CHANGELOG.md is the only notice an auto-upgrading fleet gets, so the release
// workflow refuses a version the file does not name. These tests hold both
// halves: the parser that extracts the notes, and the file itself — which is a
// shipped artifact with invariants, not prose.

test('the real changelog parses: every release has a date, a body, and descending versions', () => {
  const all = sections(CHANGELOG);
  assert.ok(all.length >= 15, 'the history is actually in the file');
  assert.match(all[0].version, /unreleased/i, 'the working section is at the top');

  const released = all.slice(1);
  for (const s of released) {
    assert.match(s.version, /^\d+\.\d+\.\d+$/, `"${s.version}" is a version, not a heading`);
    assert.match(s.date || '', /^\d{4}-\d{2}-\d{2}$/, `[${s.version}] carries its release date`);
    assert.ok(s.body.length > 10, `[${s.version}] says what changed — a heading is not a changelog`);
  }

  const nums = released.map((s) => s.version.split('.').map(Number));
  for (let i = 1; i < nums.length; i++) {
    const [a, b] = [nums[i - 1], nums[i]];
    const newer = a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])));
    assert.ok(newer, `${released[i - 1].version} sits above ${released[i].version} — newest first, no duplicates`);
  }

  // The file starts at the beginning: nothing shipped before it was versioned.
  assert.equal(released[released.length - 1].version, '0.1.0');
});

test('the current package version is in the changelog, or staged in [Unreleased]', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const all = sections(CHANGELOG);
  const named = all.some((s) => s.version === pkg.version);
  const unreleased = all.find((s) => /unreleased/i.test(s.version));
  assert.ok(named || (unreleased && unreleased.body), `v${pkg.version} has nowhere to be announced from`);
});

test('notesFor extracts one version, verbatim, and only that version', () => {
  const r = notesFor(CHANGELOG, '0.9.2');
  assert.equal(r.ok, true);
  assert.match(r.body, /Receipts/, 'the entry that made 0.9.2 matter is in it');
  assert.ok(!r.body.includes('[0.9.1]'), 'and the next section is not');
  assert.equal(r.date, '2026-07-25');
});

test('the gate refuses what it must: a missing version, an empty section', () => {
  // Synthetic changelogs, not the live file: whether [Unreleased] has content
  // is a fact about where the repo is in its release cycle, and this test
  // learned that the day a release emptied it.
  const staged = '# x\n\n## [Unreleased]\n\nnew things waiting\n\n## [1.0.0] — 2026-01-01\n\ncontent\n';
  const missing = notesFor(staged, '99.0.0');
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'missing');
  assert.match(missing.hint, /rename it to \[99\.0\.0\]/, 'the fix is named — [Unreleased] has content waiting');

  const bare = notesFor('# x\n\n## [Unreleased]\n\n## [1.0.0] — 2026-01-01\n\ncontent\n', '2.0.0');
  assert.match(bare.hint, /\[Unreleased\] is empty/, 'and when nothing is staged, it says to write it');

  const empty = notesFor('## [1.0.0] — 2026-01-01\n\n## [0.9.0] — 2026-01-01\n\nx\n', '1.0.0');
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'empty', 'a heading with nothing under it is drift in disguise');
});

test('every deprecation is announced in the changelog, removal version included', async () => {
  // The deprecation contract (deprecate.js): keeps working, removed a minor
  // later, ANNOUNCED. This is the announcement being checked, not assumed.
  const { DEPRECATED, REMOVAL_VERSION } = await import('../src/lib/deprecate.js');
  for (const [name, d] of Object.entries(DEPRECATED)) {
    assert.ok(CHANGELOG.includes(`praxis ${name}`), `the fleet is told ${name} is going away`);
    assert.ok(CHANGELOG.includes(d.instead), `and where to go instead of ${name}`);
  }
  assert.ok(CHANGELOG.includes(REMOVAL_VERSION), 'the removal version is public, not a surprise');
});

test('deprecated commands still work, and say where to go instead', async () => {
  const { deprecationNotice, isDeprecated, DEPRECATED, REMOVAL_VERSION } = await import('../src/lib/deprecate.js');
  const { spawnSync } = await import('node:child_process');
  const path = await import('node:path');

  for (const name of Object.keys(DEPRECATED)) {
    const n = deprecationNotice(name);
    assert.match(n, new RegExp(`praxis ${name} is deprecated`));
    assert.match(n, new RegExp(REMOVAL_VERSION.replace('.', '\\.')), 'the removal version is stated, not vague');
    assert.match(n, /npx \w+/, 'and it names a command that replaces it');
  }
  assert.equal(isDeprecated('receipt'), false, 'the spine is not deprecated');
  assert.equal(deprecationNotice('receipt'), null);

  // The contract that matters: a deprecated command STILL RUNS. Every install
  // auto-upgrades through npx, so a removal without warning breaks scripts.
  const r = spawnSync(process.execPath, [path.resolve('src', 'cli.js'), 'cost'], { encoding: 'utf8', timeout: 60000 });
  assert.notEqual(r.status, 127);
  assert.match(r.stderr, /deprecated/, 'the notice goes to stderr so piped output stays clean');
  assert.match(r.stderr, /ccusage/);
  assert.ok(!/deprecated/.test(r.stdout), 'and never pollutes stdout');
});
