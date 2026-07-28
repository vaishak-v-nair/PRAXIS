#!/usr/bin/env node
// The tarball budget (D21). Every install pays this download before it sees a
// single receipt, so the size is a product decision, not a build detail —
// and it gets caught in CI, not on the front page of Hacker News.
//
//   node scripts/ci/tarball-budget.mjs            # check the real package
//   node scripts/ci/tarball-budget.mjs --budget 4 # override, in MB
//
// Exit 0 under budget, 1 over — naming the size either way.

import { spawnSync } from 'node:child_process';

export const BUDGET_MB = 3.5;
const MB = 1024 * 1024;

/** Pure: is this size within budget? Separated so the rule is testable. */
export function checkBudget(unpackedSize, budgetMb = BUDGET_MB) {
  const budget = budgetMb * MB;
  const mb = (n) => (n / MB).toFixed(2) + 'MB';
  return {
    ok: unpackedSize <= budget,
    unpackedSize,
    budget,
    message:
      unpackedSize <= budget
        ? `tarball ${mb(unpackedSize)} of ${mb(budget)} budget — ok`
        : `tarball ${mb(unpackedSize)} EXCEEDS the ${mb(budget)} budget by ${mb(unpackedSize - budget)}`,
  };
}

/** Pure: pull the unpacked size out of `npm pack --json` output. */
export function parsePackJson(stdout) {
  const data = JSON.parse(stdout);
  const entry = Array.isArray(data) ? data[0] : data;
  if (!entry || typeof entry.unpackedSize !== 'number') {
    throw new Error('npm pack --json did not report unpackedSize');
  }
  return { unpackedSize: entry.unpackedSize, files: entry.entryCount, name: entry.name, version: entry.version };
}

function main() {
  const i = process.argv.indexOf('--budget');
  const budgetMb = i > -1 ? Number(process.argv[i + 1]) : BUDGET_MB;

  const r = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32', // npm is npm.cmd on Windows
    timeout: 120000,
  });
  if (r.status !== 0) {
    console.error('npm pack failed:\n' + (r.stderr || r.stdout || 'no output'));
    process.exit(1);
  }
  let info;
  try {
    info = parsePackJson(r.stdout);
  } catch (e) {
    console.error('could not read npm pack output: ' + e.message);
    process.exit(1);
  }
  const res = checkBudget(info.unpackedSize, budgetMb);
  console.log(`${info.name}@${info.version} — ${info.files} files`);
  console.log(res.ok ? 'PASS  ' + res.message : 'FAIL  ' + res.message);
  if (!res.ok) {
    console.error(
      '\nThe budget exists because npx cold-download is minute one of the demo.\n' +
        'Either trim what ships (package.json "files"), or raise the budget deliberately.',
    );
  }
  process.exit(res.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('tarball-budget.mjs')) main();
