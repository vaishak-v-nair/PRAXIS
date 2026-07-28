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

function main() {
  const args = ['--test', '--test-reporter=tap', '--test-reporter-destination=stdout', 'test/*.test.js'];
  const child = spawn(process.execPath, args, { encoding: 'utf8' });

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
