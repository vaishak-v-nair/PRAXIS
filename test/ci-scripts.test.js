import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

import { checkBudget, parsePackJson, BUDGET_MB } from '../scripts/ci/tarball-budget.mjs';
import { checkTrackedPaths, RULES } from '../scripts/ci/leak-guard.mjs';
import { parseCoverage, checkFloor, readFloor } from '../scripts/ci/coverage-floor.mjs';
import { runWithConcurrency, summarize, DEFAULT_CONCURRENCY } from '../scripts/ci/run-live-evals.mjs';
import { sections, notesFor } from '../scripts/ci/changelog.mjs';
import { testConcurrency } from '../scripts/ci/run-tests.mjs';

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

// ── the leak guard ───────────────────────────────────────────────────────────
// A personal Obsidian vault sits inside this working tree. The .gitignore that
// keeps it out has failed twice, both times on a rename — so these tests are
// about the rename case specifically: the guard has to catch a vault it has
// never seen the name of.

test('the guard catches every private shape, whatever it got renamed to', () => {
  const r = checkTrackedPaths(
    [
      'Praxis Intelligence/01 Identity/me.md', // today's name
      'Personal Intelligence/notes.md', // the name before that
      'PraxisIntelligence/x.md', // no space
      'Praxis iIntelligence/.obsidian/app.json', // the typo'd one
      'some/nested/.obsidian/workspace.json', // a vault anywhere at all
      'assets/source/mascot.mov',
      'DESIGN.md',
      '.praxis/memory.md',
      '.claude/settings.local.json',
      'CLAUDE.md',
    ],
    { branch: 'main' },
  );
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 10, 'every one of them, not just the ones we thought of');
  const rules = new Set(r.violations.map((v) => v.rule));
  for (const id of ['vault', 'obsidian', 'brand-vault', 'internal-docs', 'local-memory', 'personal-config']) {
    assert.ok(rules.has(id), `${id} fired`);
  }
  for (const v of r.violations) assert.ok(v.why.length > 20, 'and each one says WHY, not just "blocked"');
});

test('the guard does not cry wolf on ordinary source', () => {
  const r = checkTrackedPaths(
    [
      'src/cli.js',
      'src/lib/intelligence-helper.js', // the word, but not a vault
      'docs/mascot.gif',
      'README.md',
      'test/smoke.test.js',
      'web/index.html',
      '.github/workflows/ci.yml',
    ],
    { branch: 'main' },
  );
  assert.equal(r.ok, true, `false positives: ${r.violations.map((v) => v.path).join(', ')}`);
});

test('on the confidential branch the brand vault is allowed — the personal one never is', () => {
  // assets/ and DESIGN.md are tracked on `confidential` on purpose. A guard
  // that failed there would get switched off, and a switched-off guard protects
  // nothing. The personal vault is private on EVERY branch.
  const r = checkTrackedPaths(['assets/source/x.mov', 'DESIGN.md', 'Praxis Intelligence/a.md'], {
    branch: 'confidential',
  });
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].rule, 'vault');
  assert.ok(r.skipped > 0, 'and it says how many rules it stood down');

  const onMain = checkTrackedPaths(['assets/source/x.mov'], { branch: 'main' });
  assert.equal(onMain.ok, false, 'the same file on main is a leak');
});

test('this repo is clean right now', () => {
  // Not a unit test — a fact about the working tree, checked on every run, which
  // is the whole point. If this ever fails, something private is in the index.
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean);
  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
  const r = checkTrackedPaths(tracked, { branch });
  assert.equal(r.ok, true, `private paths tracked: ${r.violations.map((v) => v.path).join(', ')}`);
  assert.ok(r.checked > 100, 'and it actually looked at the repo');
});

test('every rule carries a reason a human can act on', () => {
  assert.ok(RULES.length >= 6);
  for (const rule of RULES) {
    assert.ok(rule.id && rule.why && typeof rule.test === 'function');
    assert.equal(typeof rule.publicOnly, 'boolean', `${rule.id} states whether confidential tracks it`);
  }
});

test('nothing PRAXIS spawns may flash a console window', () => {
  // On Windows, spawning a console program without windowsHide pops a black
  // window on the user's desktop. PRAXIS spawns from the Stop hook (git log,
  // every session end), from the tray (tasklist, powershell, taskkill), from
  // tool detection, from the job runner, the judge and the governor — so a
  // person working with PRAXIS installed got shells opening at random all day
  // while they typed. 18 of 24 call sites were missing it.
  //
  // No unit test can see a console window, which is exactly why this is a
  // source check: the failure is on someone's screen, not in any assertion.
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(js|mjs)$/.test(p)) files.push(p);
    }
  };
  walk('src');

  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /(spawnSync|execFileSync|execSync|spawn)\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
      let i = re.lastIndex - 1;
      let depth = 0;
      let end = -1;
      for (; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') {
          depth--;
          if (!depth) { end = i; break; }
        }
      }
      if (end < 0) continue;
      const call = src.slice(m.index, end + 1);
      if (!/windowsHide/.test(call)) {
        offenders.push(`${f}:${src.slice(0, m.index).split('\n').length} ${m[1]}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'every spawn must pass windowsHide: true');
});

test('every workflow runs the suite through the same runner', () => {
  // This drifted three separate times in one day: coverage-floor.mjs ran the
  // suite itself uncapped, release.yml ran a bare `npm test`, and both went red
  // while ci.yml went green on identical code. A bare `npm test` skips the
  // concurrency cap, and 17 of 39 test files spawn node children — uncapped on
  // a two-core runner they compete to fork and one fails outright.
  //
  // The release job is the one that matters: it blocks a publish, so a flake
  // there fails a release AFTER the tag is pushed, and npm versions are
  // immutable.
  const workflows = fs.readdirSync('.github/workflows').filter((f) => f.endsWith('.yml'));
  const offenders = [];
  for (const w of workflows) {
    const src = fs.readFileSync(`.github/workflows/${w}`, 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      // a step that runs the suite must go through run-tests.mjs
      if (/^\s*(-\s*)?run:\s*(npm\s+test|node\s+--test)\b/.test(line)) {
        offenders.push(`${w}:${i + 1} ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'run the suite via scripts/ci/run-tests.mjs, not a bare npm test');
});

test('test files run capped on CI and uncapped locally', () => {
  // 17 of 39 test files spawn real child processes. node --test defaults to one
  // file per CPU, so on a two-core runner several spawn-heavy files competed for
  // process startup and a different leg went red on nearly every push — while a
  // rerun with no code change went green. A suite that needs a rerun to be
  // believed is one nobody reads, and this one gates the release workflow.
  assert.equal(testConcurrency({}), null, 'local keeps node’s default — full speed');
  assert.equal(testConcurrency({ CI: 'true' }), 1, 'fully serial: two cores, and every file spawns children');
  assert.equal(testConcurrency({ CI: '1', PRAXIS_TEST_CONCURRENCY: '4' }), 4, 'tunable without a code change');
  assert.equal(testConcurrency({ CI: '1', PRAXIS_TEST_CONCURRENCY: 'nope' }), 1, 'garbage falls back, never to NaN');
  assert.equal(testConcurrency({ CI: '1', PRAXIS_TEST_CONCURRENCY: '0' }), 1, 'zero would run nothing');
});

// ── the coverage ratchet ─────────────────────────────────────────────────────

test('the ratchet reads node coverage output, including the colour codes', () => {
  const real =
    'ℹ ------------------------------------------------\n' +
    'ℹ file        | line % | branch % | funcs % | uncovered\n' +
    'ℹ [32mall files[0m   |  82.04 |    73.54 |   86.21 |\n' +
    'ℹ end of coverage report\n';
  assert.deepEqual(parseCoverage(real), { line: 82.04, branch: 73.54, funcs: 86.21 });
  assert.throws(() => parseCoverage('no summary here'), /all files/);
  assert.throws(() => parseCoverage('ℹ all files | x | y | z |'), /three percentages/);
});

test('the ratchet fails on any metric, not on an average', () => {
  // Branch coverage is the one that slips when new code lands faster than its
  // tests. Averaging would let a good line number hide it.
  const floor = { line: 81, branch: 72, funcs: 85 };
  assert.equal(checkFloor({ line: 82.04, branch: 73.54, funcs: 86.21 }, floor).ok, true);
  assert.equal(checkFloor({ line: 81, branch: 72, funcs: 85 }, floor).ok, true, 'exactly at the floor is on the floor');

  const slipped = checkFloor({ line: 95, branch: 71.9, funcs: 99 }, floor);
  assert.equal(slipped.ok, false, 'excellent lines do not buy a branch regression');
  assert.deepEqual(slipped.results.filter((r) => !r.ok).map((r) => r.metric), ['branch']);
});

test('the committed floor is real, and below what the suite actually does', () => {
  const floor = readFloor();
  for (const k of ['line', 'branch', 'funcs']) {
    assert.ok(typeof floor[k] === 'number' && floor[k] > 50, `${k} floor is a real number`);
  }
  assert.match(floor.updated, /^\d{4}-\d{2}-\d{2}$/, 'and it records when it was agreed');
  assert.ok(floor.why && floor.why.length > 40, 'and why, so raising or lowering it is a decision');
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

  for (const name of Object.keys(DEPRECATED)) {
    const n = deprecationNotice(name);
    assert.match(n, new RegExp(`praxis ${name} is deprecated`));
    assert.match(n, new RegExp(REMOVAL_VERSION.replace('.', '\\.')), 'the removal version is stated, not vague');
    assert.match(n, /npx \w+/, 'and it names a command that replaces it');
  }
  assert.equal(isDeprecated('receipt'), false, 'the spine is not deprecated');
  assert.equal(deprecationNotice('receipt'), null);
});

test('a removed command leaves a headstone, not a typo guess', async () => {
  // The other half of the contract. Sixteen shipped files run unpinned
  // `npx -y praxis-memory`, so the release that deletes a command lands on
  // every install automatically and somebody's script calls it that morning.
  // "Unknown command: cost — did you mean gate?" would be a dead end.
  const { removalNotice, isRemoved, REMOVED } = await import('../src/lib/deprecate.js');
  const { spawnSync } = await import('node:child_process');
  const path = await import('node:path');

  for (const [name, r] of Object.entries(REMOVED)) {
    const n = removalNotice(name);
    assert.match(n, new RegExp(`praxis ${name} was removed in ${r.since.replace(/\./g, '\\.')}`));
    assert.match(n, new RegExp(r.instead), 'and names what replaced it');
    assert.match(n, /npx \w+/, 'with a command that can be pasted');
    assert.ok(CHANGELOG.includes(`praxis ${name}`), `${name}'s removal is announced, not silent`);
  }
  assert.equal(isRemoved('receipt'), false, 'the spine is not removed');
  assert.equal(removalNotice('receipt'), null);

  const r = spawnSync(process.execPath, [path.resolve('src', 'cli.js'), 'cost'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1, 'a gone command still fails, so scripts notice');
  assert.match(r.stdout, /was removed in/);
  assert.match(r.stdout, /ccusage/, 'and points somewhere useful');
  assert.doesNotMatch(r.stdout, /did you mean/, 'a removal is not a typo');
});
