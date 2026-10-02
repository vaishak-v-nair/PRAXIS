#!/usr/bin/env node
// Local, read-only release gates. This script never logs in, tags, pushes or
// publishes. npm publish runs it through prepublishOnly before any upload.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { notesFor } from './changelog.mjs';
import { checkTrackedPaths } from './leak-guard.mjs';
import { checkBudget } from './tarball-budget.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const REGISTRY = 'https://registry.npmjs.org/';
export const REQUIRED_FILES = [
  'src/cli.js', 'src/lib/verify/index.js', 'scripts/postinstall.js', 'start.ps1',
  'apps/workbench/package.json', 'apps/workbench/package-lock.json',
  'apps/workbench/backend/requirements.txt', 'apps/workbench/backend/regen/app.py',
  'docs/WORKBENCH-INTEGRATION.md', 'docs/AGENT-WORKFLOW.md',
  'docs/PROJECT-REVIEW-QUICKSTART.md', 'docs/VERIFY-QUICKSTART.md',
];

export function checkMetadata(pkg, lock, changelog) {
  const errors = [];
  if (pkg.name !== 'praxis-memory' || !/^\d+\.\d+\.\d+$/.test(pkg.version || '')) errors.push('Expected praxis-memory and a stable SemVer version.');
  if (pkg.private) errors.push('The public package cannot be private.');
  if (Object.keys(pkg.dependencies || {}).length || Object.keys(pkg.optionalDependencies || {}).length) errors.push('The CLI must keep zero runtime dependencies.');
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version || lock.name !== pkg.name) errors.push('package.json and package-lock.json must name the same version.');
  if (pkg.bin?.praxis !== 'src/cli.js' || pkg.bin?.['praxis-memory'] !== 'src/cli.js') errors.push('Both existing CLI bins must be preserved.');
  if (pkg.publishConfig?.registry !== REGISTRY || pkg.publishConfig?.access !== 'public') errors.push('Publish config must explicitly use the public npm registry.');
  const notes = notesFor(changelog, pkg.version);
  if (!notes.ok) errors.push(notes.hint);
  return { ok: errors.length === 0, errors };
}

export function checkPackage(entry) {
  const errors = [];
  const files = (entry.files || []).map(file => String(file.path).replace(/\\/g, '/'));
  const privatePaths = checkTrackedPaths(files).violations.map(item => item.path);
  for (const file of files) {
    const segments = file.split('/');
    if (segments.some(segment => /^(?:\.env(?:\..*)?|\.npmrc|\.regen|\.git|\.next|node_modules|__pycache__|\.venv.*|\.pytest_cache)$/.test(segment) && segment !== '.env.example') ||
        /(?:^|\/)(?:ed25519-private\.pem|[^/]*private[^/]*\.key)$/.test(file) ||
        file.startsWith('apps/workbench/repos/')) privatePaths.push(file);
  }
  if (privatePaths.length) errors.push('Private/generated package paths: ' + [...new Set(privatePaths)].join(', '));
  for (const file of REQUIRED_FILES) if (!files.includes(file)) errors.push('Missing shipped setup/runtime file: ' + file);
  const budget = checkBudget(entry.unpackedSize);
  if (!Number.isFinite(entry.unpackedSize) || !budget.ok) errors.push(budget.message);
  return { ok: errors.length === 0, errors, files: files.length, unpackedSize: entry.unpackedSize };
}

function run(file, args, { capture = false, timeout = 600000 } = {}) {
  const result = spawnSync(file, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true,
    shell: file === 'npm' && process.platform === 'win32', timeout,
    env: { ...process.env, PRAXIS_NO_TRAY: '1', PROMPTFOO_DISABLE_TELEMETRY: '1' },
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'], maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${path.basename(file)} ${args.join(' ')} failed${result.error ? ': ' + result.error.message : ''}${capture ? '\n' + (result.stderr || result.stdout || '') : ''}`);
  return result.stdout;
}

function npm(args, options) {
  return process.env.npm_execpath
    ? run(process.execPath, [process.env.npm_execpath, ...args], options)
    : run('npm', args, options);
}

export function main(argv = process.argv.slice(2)) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const metadata = checkMetadata(pkg, lock, fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'));
  if (!metadata.ok) throw new Error(metadata.errors.join('\n'));
  const entry = JSON.parse(npm(['pack', '--dry-run', '--json'], { capture: true, timeout: 120000 }))[0];
  const packed = checkPackage(entry);
  if (!packed.ok) throw new Error(packed.errors.join('\n'));
  console.log(`PASS release metadata and package contents: ${pkg.name}@${pkg.version}, ${packed.files} files`);
  if (argv.includes('--metadata-only')) return;

  // Fail closed on network/auth errors. Read the existing public version list
  // rather than treating any failed request as an available version.
  const available = npm(['view', pkg.name, 'versions', '--json', '--registry', REGISTRY, '--fetch-retries=0', '--fetch-timeout=15000'], { capture: true, timeout: 20000 });
  const versions = JSON.parse(available);
  if ((Array.isArray(versions) ? versions : [versions]).includes(pkg.version)) throw new Error(`${pkg.name}@${pkg.version} is already published. Bump the version and update the lockfile/changelog.`);
  console.log('PASS target npm version is not published');

  const gates = [
    ['core regressions', () => run(process.execPath, ['scripts/ci/run-tests.mjs'])],
    ['tracked privacy', () => run(process.execPath, ['scripts/ci/leak-guard.mjs'])],
    ['installed package + receipt smoke', () => run(process.execPath, ['scripts/ci/pack-smoke.mjs'])],
    ['golden verification recall and precision', () => npm(['run', 'eval:verify'])],
    ['backend regressions', () => npm(['run', 'test:workbench'])],
    ['frontend TypeScript', () => npm(['run', 'typecheck:workbench'])],
    ['frontend production build', () => npm(['run', 'build:workbench'])],
    ['CLI production dependency audit', () => npm(['audit', '--omit=dev', '--audit-level=high'])],
    ['Workbench production dependency audit', () => npm(['--prefix', 'apps/workbench', 'audit', '--omit=dev', '--audit-level=high'])],
  ];
  for (const [name, gate] of gates) { console.log('\nCHECK ' + name); gate(); }
  console.log(`\nPASS all manual release gates for ${pkg.name}@${pkg.version}. Nothing was published.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error('RELEASE BLOCKED: ' + error.message); process.exitCode = 1; }
}
