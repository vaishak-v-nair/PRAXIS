#!/usr/bin/env node
// The stranger's first minute, run on every push (D14).
//
// Packs the REAL tarball, installs it into an empty directory the way npx would,
// and runs it. This is the only test that exercises what actually ships — the
// test suite runs against the working tree, which is not the same thing. A file
// missing from package.json "files" is invisible to `npm test` and fatal to a
// stranger; this catches it before Hacker News does.
//
//   node scripts/ci/pack-smoke.mjs
//   node scripts/ci/pack-smoke.mjs --keep    # leave the temp install for poking
//
// Also enforces the tarball budget (D21), because download weight is minute one
// of the conversion and belongs in CI, not in a postmortem.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkBudget, parsePackJson } from './tarball-budget.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IS_WIN = process.platform === 'win32';

// The demo (E1) is the gate-blocking conversion asset. This flag was false
// while it was unbuilt, because a green that does not cover the gate is a lie.
const DEMO_SHIPPED = true;
export const DEMO_BUDGET_MS = 30000; // D51: the 60-second guarantee, metered with margin

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: IS_WIN && /^(npm|npx)$/.test(cmd), // npm is npm.cmd on Windows
    timeout: 300000,
    ...opts,
  });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), signal: r.signal };
}

const steps = [];
function step(name, fn) {
  process.stdout.write(`• ${name} ... `);
  try {
    const detail = fn() || 'ok';
    console.log(detail);
    steps.push({ name, ok: true, detail });
  } catch (e) {
    console.log('FAILED');
    console.error(`  ${e.message}`);
    steps.push({ name, ok: false, detail: e.message });
  }
}

function main() {
  console.log(`PACK SMOKE — ${process.platform} · node ${process.version}\n`);
  let tarball = null;
  let workdir = null;

  step('npm pack (the real tarball)', () => {
    const r = sh('npm', ['pack', '--json'], { cwd: REPO });
    if (r.status !== 0) throw new Error('npm pack failed:\n' + r.out);
    // npm prints the JSON array; tolerate leading notices on some npm versions
    const json = r.out.slice(r.out.indexOf('['));
    const info = parsePackJson(json);
    const entry = JSON.parse(json)[0];
    tarball = path.join(REPO, entry.filename);
    if (!fs.existsSync(tarball)) throw new Error(`tarball not found at ${tarball}`);
    const budget = checkBudget(info.unpackedSize);
    if (!budget.ok) throw new Error(budget.message);
    return `${info.name}@${info.version} · ${info.files} files · ${budget.message}`;
  });

  step('fresh install into an empty project', () => {
    if (!tarball) throw new Error('skipped — no tarball');
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-smoke-'));
    fs.writeFileSync(path.join(workdir, 'package.json'), JSON.stringify({ name: 'smoke', private: true }) + '\n');
    const r = sh('npm', ['install', '--no-audit', '--no-fund', tarball], { cwd: workdir });
    if (r.status !== 0) throw new Error('npm install failed:\n' + r.out);
    const bin = path.join(workdir, 'node_modules', '.bin', IS_WIN ? 'praxis-memory.cmd' : 'praxis-memory');
    if (!fs.existsSync(bin)) throw new Error('the praxis-memory bin was not installed');
    return 'installed';
  });

  const cli = (...args) => {
    const bin = path.join(workdir, 'node_modules', '.bin', IS_WIN ? 'praxis-memory.cmd' : 'praxis-memory');
    return sh(bin, args, { cwd: workdir, shell: IS_WIN });
  };

  step('it runs: --version matches the package', () => {
    if (!workdir) throw new Error('skipped — nothing installed');
    const expected = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
    const r = cli('--version');
    if (r.status !== 0) throw new Error(`exit ${r.status}:\n${r.out}`);
    const got = r.out.trim();
    if (got !== expected) throw new Error(`installed build reports ${got}, package.json says ${expected}`);
    return got;
  });

  step('it runs: help renders from the shipped files', () => {
    const r = cli('help');
    if (r.status !== 0) throw new Error(`exit ${r.status}:\n${r.out}`);
    if (!/PRAXIS/.test(r.out)) throw new Error('help output did not render');
    return `${r.out.split('\n').length} lines`;
  });

  if (DEMO_SHIPPED) {
    step(`demo replay end-to-end (< ${DEMO_BUDGET_MS / 1000}s)`, () => {
      const started = Date.now();
      const r = cli('demo', '--replay');
      const elapsed = Date.now() - started;
      if (r.status !== 0) throw new Error(`demo exited ${r.status}:\n${r.out}`);
      if (!/chain intact/i.test(r.out)) throw new Error('demo did not reach a sealed, verified receipt');
      // The recording must always be labelled as one. If this ever stops
      // appearing, the demo has started presenting a replay as live work.
      if (!/recorded verdict/i.test(r.out)) throw new Error('demo showed verdicts without labelling them as recorded');
      if (!/provenance: demo-replay/i.test(r.out)) throw new Error('demo receipt was not marked as a demo');
      if (elapsed > DEMO_BUDGET_MS) throw new Error(`demo took ${elapsed}ms, budget is ${DEMO_BUDGET_MS}ms`);
      return `sealed and verified in ${(elapsed / 1000).toFixed(1)}s`;
    });

    step('the sealed demo receipt verifies offline from the installed build', () => {
      const r = cli('receipt', '--list');
      if (r.status !== 0) throw new Error(`receipt --list exited ${r.status}`);
      return 'installed build can read receipts back';
    });
  }

  // cleanup
  if (!process.argv.includes('--keep')) {
    try {
      if (tarball) fs.rmSync(tarball, { force: true });
      if (workdir) fs.rmSync(workdir, { recursive: true, force: true });
    } catch {
      /* temp litter is not a test failure */
    }
  }

  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} steps passed`);
  if (!DEMO_SHIPPED) {
    console.log(
      '\nNOT YET COVERED: the demo replay stage is inert until E1 ships.\n' +
        'This run proves pack + install + launch. It does NOT yet prove the\n' +
        '90-second stranger conversion, which is a launch-gate condition.',
    );
  }
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1]?.endsWith('pack-smoke.mjs')) main();
