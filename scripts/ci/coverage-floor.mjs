#!/usr/bin/env node
// The coverage ratchet.
//
//   node scripts/ci/coverage-floor.mjs           # check against the floor
//   node scripts/ci/coverage-floor.mjs --update  # raise the floor to today
//
// Coverage was never measured in CI, which meant it could only drift one way
// and nobody would know. It had: fifteen of twenty-seven commands sat at 0%
// FUNCTION coverage — their entry points had never been called by a test even
// once — while the libraries underneath were at 90-100%. The libraries were
// well tested; the layer the user actually types was not.
//
// A floor, not a target. It fails the build when coverage drops below the last
// agreed number, and `--update` is a deliberate commit that says "we raised
// it". Nobody has to remember to care, which is the only kind of standard that
// survives a solo project.
//
// Exit 0 at or above the floor, 1 below it, naming every metric either way.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { testConcurrency } from './run-tests.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FLOOR_FILE = path.join(HERE, 'coverage-floor.json');

/**
 * Pull the totals out of a node --test coverage report.
 *
 * The summary row is the one labelled "all files". Parsing that rather than
 * summing per-file rows keeps this honest if node changes how it groups them.
 */
export function parseCoverage(stdout) {
  const clean = String(stdout).replace(/\[[0-9;]*m/g, '');
  const row = clean.split('\n').find((l) => /^\s*(ℹ\s*)?all files\s*\|/.test(l));
  if (!row) throw new Error('no "all files" summary row in the coverage output');
  const nums = row.split('|').slice(1, 4).map((c) => Number(c.trim()));
  if (nums.length !== 3 || nums.some((n) => !Number.isFinite(n))) {
    throw new Error(`could not read three percentages from: ${row.trim()}`);
  }
  return { line: nums[0], branch: nums[1], funcs: nums[2] };
}

/** Pure: is this run at or above the floor? Reported per metric, never as one number. */
export function checkFloor(actual, floor) {
  const metrics = ['line', 'branch', 'funcs'];
  const results = metrics.map((k) => ({
    metric: k,
    actual: actual[k],
    floor: floor[k],
    ok: actual[k] + 1e-9 >= floor[k],
  }));
  return { ok: results.every((r) => r.ok), results };
}

export function readFloor(file = FLOOR_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const update = process.argv.includes('--update');

  // The SAME concurrency cap run-tests.mjs uses. This job runs the suite a
  // second time, and without the cap it hit exactly the contention flake the
  // cap exists to prevent: all nine test legs green, and this one red with "the
  // test run itself failed". Two runners of one suite must not disagree about
  // how to run it.
  const args = ['--test', '--experimental-test-coverage'];
  const concurrency = testConcurrency();
  if (concurrency) args.push(`--test-concurrency=${concurrency}`);
  args.push('test/*.test.js');

  const r = spawnSync(process.execPath, args, {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 900000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PRAXIS_SKIP_TRAY: '1' },
  });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) {
    console.error('the test run itself failed — fix that before the coverage floor means anything\n');
    // Name the failing tests. The previous version dumped the last 25 lines,
    // which is the summary block — it says how many failed and never which.
    const failed = out.split('\n').filter((l) => /^\s*(not ok \d+|✖)/.test(l));
    if (failed.length) for (const f of failed.slice(0, 20)) console.error('  ' + f.trim());
    else console.error(out.split('\n').slice(-25).join('\n'));
    process.exit(1);
  }

  let actual;
  try {
    actual = parseCoverage(out);
  } catch (e) {
    console.error('could not read coverage: ' + e.message);
    process.exit(1);
  }

  if (update) {
    const prev = ifReadable(FLOOR_FILE);
    const next = {
      ...actual,
      updated: new Date().toISOString().slice(0, 10),
      platform: process.platform,
      why: (prev && prev.why) || 'Raised with --update.',
    };
    fs.writeFileSync(FLOOR_FILE, JSON.stringify(next, null, 2) + '\n');
    console.log(`floor raised to line ${next.line} / branch ${next.branch} / funcs ${next.funcs} (measured on ${next.platform})`);
    console.log('commit scripts/ci/coverage-floor.json so the new standard is the agreed one');
    return;
  }

  const floor = readFloor();
  const res = checkFloor(actual, floor);
  console.log(`  measured on ${process.platform}; floor calibrated on ${floor.platform || 'unrecorded'}\n`);
  for (const m of res.results) {
    const mark = m.ok ? 'ok  ' : 'FAIL';
    console.log(`  ${mark} ${m.metric.padEnd(7)} ${m.actual.toFixed(2).padStart(6)}%  floor ${m.floor.toFixed(2)}%`);
  }
  if (!res.ok) {
    // Coverage is platform-dependent — src/commands/tray.js alone has win32-only
    // branches — so a floor calibrated on one OS and enforced on another fails
    // for reasons that have nothing to do with anybody's tests. Say so here,
    // because the first version of this gate did exactly that.
    if (floor.platform && floor.platform !== process.platform) {
      console.error(
        `\nNote: this floor was calibrated on ${floor.platform} and you are on ${process.platform}. ` +
          'Platform-specific branches make those numbers differ by about a point. ' +
          'Compare like with like before concluding coverage dropped.',
      );
    }
    console.error(
      '\nCoverage fell below the floor. Either add the tests, or raise the floor on purpose:\n' +
        '    node scripts/ci/coverage-floor.mjs --update\n' +
        'Lowering it silently is the thing this exists to prevent.',
    );
    process.exit(1);
  }
  console.log(`\nPASS  at or above the floor set ${floor.updated}`);
}

function ifReadable(f) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('coverage-floor.mjs')) main();
