#!/usr/bin/env node
// Run the test suite and make CI say WHAT failed, not just THAT something did.
//
// This exists because of a real hour lost: a job went red on one runner out of
// nine, and the only machine-readable signal GitHub offered was an annotation
// reading "Process completed with exit code 1". The failing test names sat in a
// log that needs an authenticated download. A build that cannot tell you what
// broke is a build that costs a round-trip every time it breaks.
//
// So: run the suite, stream it through so humans still get the full log, and on
// failure emit a GitHub `::error::` annotation per failing test. Annotations are
// readable from the public API without credentials, which means the next
// failure explains itself.
//
//   node scripts/ci/run-tests.mjs

import { spawn } from 'node:child_process';

/**
 * Pull failing test names and their assertion detail out of TAP output.
 * Pure, so the parser is testable without failing a real test.
 */
export function parseTapFailures(tap) {
  const lines = String(tap).split(/\r?\n/);
  const failures = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^not ok \d+ - (.*)$/.exec(lines[i]);
    if (!m) continue;
    const name = m[1].trim();
    // The YAML block that follows carries the useful part.
    const detail = [];
    for (let j = i + 1; j < lines.length && detail.length < 12; j++) {
      if (/^(ok|not ok|1\.\.|#)/.test(lines[j])) break;
      const t = lines[j].trim();
      if (!t || t === '---' || t === '...') continue;
      if (/^(duration_ms|type|stack|\*|at )/.test(t)) continue;
      detail.push(t);
    }
    failures.push({ name, detail: detail.join(' | ').slice(0, 600) });
  }
  return failures;
}

/** GitHub swallows newlines in annotations unless they are escaped. */
export function escapeAnnotation(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function annotationsFor(failures) {
  return failures.map(
    (f) => `::error title=${escapeAnnotation(f.name)}::${escapeAnnotation(f.detail || 'assertion failed')}`,
  );
}

/**
 * How many test FILES to run at once.
 *
 * `node --test` defaults to one per CPU. Seventeen of this suite's thirty-nine
 * files spawn real child processes — fixture agents, judges, detached job
 * runners — so on a two-core CI runner several spawn-heavy files compete for
 * process startup at the same time. That contention, not any one test, is what
 * made a different leg go red on nearly every push while a rerun with no code
 * change went green. A suite that needs a rerun to be believed is a suite
 * nobody reads, and this one gates the release workflow.
 *
 * Capping it on CI trades a couple of minutes of wall clock for a result that
 * means something. Local runs are untouched.
 */
export function testConcurrency(env = process.env) {
  if (!env.CI) return null; // local: node's default, one per core
  const n = Number(env.PRAXIS_TEST_CONCURRENCY);
  // One at a time on CI. Two was not enough: the remaining failures were
  // `spawn-failed` in ~430ms — a child failing to fork outright, which is what
  // resource pressure looks like, not a timeout. A GitHub runner has two cores
  // and every one of those files starts node children of its own. Serialising
  // costs about a minute of wall clock and removes the entire class.
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function main() {
  const args = ['--test', '--test-reporter=tap', '--test-reporter-destination=stdout'];
  const concurrency = testConcurrency();
  if (concurrency) args.push(`--test-concurrency=${concurrency}`);
  args.push('test/*.test.js');
  // No test may spawn a tray host, whether or not it remembered the env var
  // itself. Learned the observable way: every full-suite run left one hidden
  // NotifyIcon host per throwaway init repo, and a day of runs left ten
  // axolotls squatting in the developer's actual system tray.
  const child = spawn(process.execPath, args, { encoding: 'utf8', env: { ...process.env, PRAXIS_SKIP_TRAY: '1' } });

  let tap = '';
  child.stdout.on('data', (d) => {
    const s = d.toString();
    tap += s;
    process.stdout.write(s); // humans still get the whole log
  });
  child.stderr.on('data', (d) => process.stderr.write(d));

  child.on('close', (code) => {
    if (code !== 0) {
      const failures = parseTapFailures(tap);
      if (failures.length) {
        process.stdout.write(`\n${failures.length} failing test(s):\n`);
        for (const a of annotationsFor(failures)) process.stdout.write(a + '\n');
      } else {
        process.stdout.write(
          '::error title=Test suite failed::the runner exited non-zero but emitted no TAP failure — see the log above\n',
        );
      }
    }
    process.exit(code ?? 1);
  });
}

if (process.argv[1]?.endsWith('run-tests.mjs')) main();
