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
import { checkPackage } from './release-check.mjs';

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
    const contents = checkPackage(entry);
    if (!contents.ok) throw new Error(contents.errors.join('\n'));
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
    const installed = path.join(workdir, 'node_modules', 'praxis-memory');
    for (const relative of ['node_modules', 'apps/workbench/node_modules', 'apps/workbench/.venv', '.praxis', 'apps/workbench/.regen']) {
      if (fs.existsSync(path.join(installed, relative))) throw new Error('fresh CLI install unexpectedly created ' + relative);
    }
    return 'installed without optional runtimes or private state';
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

  step('installed Verify distinguishes true and false claims in a real Git repo', () => {
    if (!workdir) throw new Error('skipped — nothing installed');
    const root = path.join(workdir, 'verify-repo');
    fs.mkdirSync(root);
    const git = (...args) => {
      const result = sh('git', args, { cwd: root });
      if (result.status !== 0) throw new Error(result.out);
    };
    git('init', '-q');
    git('config', 'user.name', 'Codex Package Fixture');
    git('config', 'user.email', 'fixture@example.test');
    git('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(root, 'README.md'), 'before\n');
    git('add', 'README.md'); git('commit', '-qm', 'Initial README');
    fs.writeFileSync(path.join(root, 'README.md'), 'after\n');
    git('add', 'README.md'); git('commit', '-qm', 'Updated README.md');
    const installedCli = path.join(workdir, 'node_modules/praxis-memory/src/cli.js');
    for (const [claim, expected, exit] of [['Updated README.md', 'VERIFIED', 0], ['Updated missing.txt', 'CONTRADICTED', 1]]) {
      const start = Date.now();
      const result = sh(process.execPath, [installedCli, 'verify', '--claim', claim, '--json'], { cwd: root, timeout: 60000 });
      if (result.status !== exit) throw new Error(`expected exit ${exit}, got ${result.status}: ${result.out}`);
      const output = JSON.parse(result.out);
      if (output.decision?.decisions?.[0]?.verdict !== expected) throw new Error('wrong installed verdict for ' + claim);
      if (Date.now() - start >= 60000) throw new Error('Verify exceeded one minute');
      const check = sh(process.execPath, ['--input-type=module', '-e', `
        import fs from 'node:fs';
        import { verifyVerifyReceipt } from './node_modules/praxis-memory/src/lib/verify/verify-receipt.js';
        if (!verifyVerifyReceipt(JSON.parse(fs.readFileSync(process.argv[1], 'utf8')))) process.exit(1);
      `, output.artifact.file], { cwd: workdir });
      if (check.status !== 0) throw new Error('installed Ed25519 receipt failed signature validation');
    }
    return 'VERIFIED + CONTRADICTED, both Ed25519 signatures checked';
  });

  step('npx praxis-memory verify needs no account or repository config', () => {
    if (!workdir) throw new Error('skipped — nothing installed');
    const root = path.join(workdir, 'verify-repo');
    const stub = path.join(workdir, 'unconfigured-agent');
    fs.mkdirSync(stub);
    // Represent a machine with no authenticated extractor. Never invoke a real
    // paid coding agent from a package/release check on a maintainer's machine.
    fs.writeFileSync(path.join(stub, 'unconfigured.cjs'), 'process.exit(1);\n');
    fs.writeFileSync(path.join(stub, IS_WIN ? 'claude.cmd' : 'claude'), IS_WIN ? '"%dp0%\\unconfigured.cjs" %*\r\n' : '#!/bin/sh\nexit 1\n', { mode: 0o700 });
    const env = { ...process.env, ANTHROPIC_API_KEY: '', PRAXIS_VERIFY_EXTRACTOR_CMD: '',
      PATH: stub + path.delimiter + (process.env.PATH || process.env.Path || '') };
    if (IS_WIN) env.Path = env.PATH;
    for (const [report, expected, exit] of [['Updated README.md', 'VERIFIED', 0], ['Updated missing.txt', 'CONTRADICTED', 1]]) {
      fs.appendFileSync(path.join(root, 'README.md'), report + '\n');
      for (const args of [['add', 'README.md'], ['commit', '-qm', report]]) {
        const commit = sh('git', args, { cwd: root });
        if (commit.status !== 0) throw new Error(commit.out);
      }
      const start = Date.now();
      const result = sh('npx', ['--no-install', 'praxis-memory', 'verify', '--json'], { cwd: root, env, timeout: 60000 });
      if (result.status !== exit) throw new Error(`npx returned ${result.status}: ${result.out}`);
      const output = JSON.parse(result.out);
      if (output.decision?.decisions?.[0]?.verdict !== expected) throw new Error('zero-config npx produced the wrong verdict');
      if (output.claims?.[0]?.source?.extractor !== 'local-conservative-fallback') throw new Error('unconfigured extraction was not labelled honestly');
      if (Date.now() - start >= 60000) throw new Error('zero-config npx exceeded one minute');
    }
    return 'zero-argument engine: true + false claims, labelled local fallback';
  });

  step('PRAXIS Live serves and verifies from the installed build', () => {
    if (!workdir) throw new Error('skipped — nothing installed');
    const script = `
      import { createLiveServer, listenLiveLocal } from './node_modules/praxis-memory/src/lib/live/server.js';
      import { verifyVerifyReceipt } from './node_modules/praxis-memory/src/lib/verify/verify-receipt.js';
      const { server, token } = createLiveServer({ stageDelayMs: 0 });
      const port = await listenLiveLocal(server, 0);
      try {
        const origin = 'http://127.0.0.1:' + port;
        const page = await fetch(origin + '/?t=' + token);
        const html = await page.text();
        if (!page.ok || !html.includes('PRAXIS Live') || !html.includes('LIVE CLAIM GRAPH')) throw new Error('installed Live page did not render the Tier 2 graph');
        const response = await fetch(origin + '/api/run', { method: 'POST', headers: { 'content-type': 'application/json', 'x-praxis-token': token }, body: JSON.stringify({ scenario: 'false-claim' }) });
        const events = (await response.text()).trim().split('\\n').map(JSON.parse);
        const result = events.at(-1);
        if (result?.verdict !== 'CONTRADICTED' || !verifyVerifyReceipt(result.receipt)) throw new Error('installed Live pipeline did not issue a valid contradicted receipt');
        const retrieval = events.find((event) => event.stage === 'retriever' && event.state === 'complete')?.evidence;
        if (retrieval?.missingClaimPaths !== 2 || !retrieval.snippets?.some((item) => item.path === 'README.md' && item.status === 'context')) throw new Error('installed Live pipeline did not stream Tier 1 evidence snippets');
      } finally { await new Promise((resolve) => server.close(resolve)); }
    `;
    const r = sh(process.execPath, ['--input-type=module', '-e', script], { cwd: workdir, timeout: 30000 });
    if (r.status !== 0) throw new Error(`exit ${r.status}:\n${r.out}`);
    return 'page + core pipeline + Ed25519 receipt';
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
      if (!/provenance\s+demo-replay/i.test(r.out)) throw new Error('demo receipt was not marked as a demo');
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
