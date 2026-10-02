// Managed optional app: durable state is outside npm's cache and release folders.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { workbenchStatus } from './workbench.js';
import { ensureUv, runCommand, sha256, managedDirectory } from './review-runtime.js';

const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA = 'praxis.local-review.v1';
const ROOT_FILES = new Set(['package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json']);
const SOURCE_DIRS = new Set(['app', 'components', 'lib', 'public']);

export function reviewHome({ platform = process.platform, env = process.env, user = os.homedir() } = {}) {
  return path.resolve(platform === 'win32' ? env.LOCALAPPDATA || path.join(user, 'AppData', 'Local')
    : platform === 'darwin' ? path.join(user, 'Library', 'Application Support')
      : env.XDG_DATA_HOME || path.join(user, '.local', 'share'), 'PRAXIS', 'ProjectReview');
}

/** An allowlist, not a recursive checkout copy: no jobs, keys, tests or builds. */
export function reviewSources(source = path.join(PACKAGE, 'apps/workbench')) {
  if (!fs.existsSync(path.join(source, 'package-lock.json'))) throw new Error('This package is missing Review source. Reinstall PRAXIS or use a complete checkout.');
  const files = [];
  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      const eligible = ROOT_FILES.has(relative) || SOURCE_DIRS.has(relative.split('/')[0]) ||
        relative === 'backend' || relative === 'backend/regen' || relative === 'backend/requirements.txt' ||
        /^backend\/regen\/[^/]+\.py$/.test(relative) || relative === 'tools' || relative === 'tools/backend.mjs';
      if (!eligible || entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') continue;
      if (entry.isSymbolicLink()) throw new Error(`Review runtime source cannot be a symbolic link: ${relative}`);
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file, relative + '/');
      else if (entry.isFile()) files.push({ relative, bytes: fs.readFileSync(file) });
    }
  }
  visit(source);
  files.sort((a, b) => a.relative.localeCompare(b.relative, 'en'));
  for (const required of ['app/page.tsx', 'backend/regen/app.py', 'tools/backend.mjs']) {
    if (!files.some(file => file.relative === required)) throw new Error(`Review runtime source is incomplete: ${required}`);
  }
  return { files, fingerprint: sha256(Buffer.concat(files.flatMap(file => [Buffer.from(file.relative + '\0'), file.bytes, Buffer.from('\0')]))) };
}

function ownedHome(home, create = false) {
  if (!path.isAbsolute(home) || home === path.parse(home).root) throw new Error('Review home must be an absolute, dedicated folder.');
  const marker = path.join(home, 'installation.json');
  if (fs.existsSync(home)) {
    if (fs.lstatSync(home).isSymbolicLink()) throw new Error('Review home cannot be a symbolic link.');
    if (fs.existsSync(marker)) {
      if (JSON.parse(fs.readFileSync(marker, 'utf8')).schema !== SCHEMA) throw new Error('Unrecognised Review installation. Existing files were preserved.');
    } else if (fs.readdirSync(home).length) throw new Error('Review home already contains unrelated files. Choose a dedicated folder with --home.');
  }
  if (create && !fs.existsSync(marker)) {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    fs.writeFileSync(marker, JSON.stringify({ schema: SCHEMA }), { mode: 0o600, flag: 'wx' });
  }
}

export function reviewLayout({ home = reviewHome(), source, version } = {}) {
  home = path.resolve(home);
  ownedHome(home);
  version ||= JSON.parse(fs.readFileSync(path.join(PACKAGE, 'package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid Review package version.');
  const sources = reviewSources(source);
  const root = path.join(home, 'releases', `${version}-${sources.fingerprint.slice(0, 16)}`);
  return { home, root, version, sources, data: path.join(home, 'data'), envFile: path.join(home, 'provider.env') };
}

export function managedStatus(layout) {
  const status = workbenchStatus({ appPath: layout.root });
  let prepared = false;
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(layout.root, 'setup.json'), 'utf8'));
    prepared = marker.fingerprint === layout.sources.fingerprint && marker.node === process.versions.node.split('.')[0] &&
      fs.existsSync(path.join(layout.root, '.next/BUILD_ID'));
  } catch { /* No successful setup receipt: do not infer readiness. */ }
  return { ...status, ok: status.ok && prepared, home: layout.home, data: layout.data, envFile: layout.envFile,
    missing: [...status.missing, ...(prepared ? [] : ['completed production setup'])] };
}

export function stageReview(layout) {
  ownedHome(layout.home, true);
  const parent = path.dirname(layout.root);
  for (const directory of [parent, layout.root, layout.data]) {
    managedDirectory(directory, layout.home);
  }
  const manifest = path.join(layout.root, 'source.json');
  if (fs.existsSync(manifest)) {
    if (JSON.parse(fs.readFileSync(manifest, 'utf8')).fingerprint !== layout.sources.fingerprint) throw new Error('Review source manifest changed. Existing files were preserved.');
  } else {
    if (fs.readdirSync(layout.root).length) throw new Error('Release folder contains unrelated files. Existing files were preserved.');
    fs.writeFileSync(manifest, JSON.stringify({ fingerprint: layout.sources.fingerprint, version: layout.version }), { flag: 'wx', mode: 0o600 });
  }
  for (const file of layout.sources.files) {
    const target = path.join(layout.root, file.relative);
    managedDirectory(path.dirname(target), layout.home);
    if (fs.existsSync(target)) {
      if (fs.lstatSync(target).isSymbolicLink() || !fs.readFileSync(target).equals(file.bytes)) throw new Error(`Managed source changed: ${file.relative}. Existing files were preserved.`);
    } else { fs.writeFileSync(target, file.bytes, { flag: 'wx' }); }
  }
}

function setupLock(home) {
  const file = path.join(home, 'setup.lock');
  if (fs.existsSync(file)) {
    const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (previous.schema !== SCHEMA || !Number.isSafeInteger(previous.pid) || previous.pid <= 0) throw new Error('Unrecognised setup lock. Inspect it before retrying.');
    try { process.kill(previous.pid, 0); throw new Error('Another PRAXIS Review setup is running. Wait for it to finish.'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; fs.unlinkSync(file); }
  }
  const nonce = randomUUID();
  fs.writeFileSync(file, JSON.stringify({ schema: SCHEMA, pid: process.pid, nonce }), { flag: 'wx', mode: 0o600 });
  return () => { if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).nonce === nonce) fs.unlinkSync(file); };
}

export function setupNpm(args, env = process.env) {
  const candidates = [env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
  const entry = candidates.find(file => file && path.basename(file) === 'npm-cli.js' && fs.existsSync(file));
  if (!entry) throw new Error('Node.js with npm is required. Install the official Node.js 22+ LTS distribution.');
  return { command: process.execPath, args: [entry, ...args] };
}

export async function setupReview(layout, { run = runCommand, uv = ensureUv, signal, log = console.log } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('PRAXIS Review requires Node.js 22 or later.');
  ownedHome(layout.home, true);
  const unlock = setupLock(layout.home);
  try {
    stageReview(layout); // Even cached setups must match the bundled runtime source.
    if (managedStatus(layout).ok) { log('Review is already prepared. Your saved reviews and provider settings stay in the data folder.'); return managedStatus(layout); }
    log('[1/4] Installing the locked Review interface dependencies…');
    const npm = args => { const invocation = setupNpm(args); return run(invocation.command, invocation.args, { cwd: layout.root, signal }); };
    await npm(['ci', '--no-audit', '--no-fund']);
    log('[2/4] Preparing a private Python runtime with the official Astral uv distribution…');
    const executable = await uv(layout.home, { run, signal });
    const env = { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(layout.home, 'tools/python'), UV_CACHE_DIR: path.join(layout.home, 'cache/uv'), UV_NO_PROGRESS: '1' };
    managedDirectory(env.UV_PYTHON_INSTALL_DIR, layout.home);
    managedDirectory(env.UV_CACHE_DIR, layout.home);
    const python = workbenchStatus({ appPath: layout.root }).python;
    if (!fs.existsSync(python)) await run(executable, ['venv', '--managed-python', '--python', '3.12', path.join(layout.root, '.venv')], { cwd: layout.root, env, signal });
    log('[3/4] Installing the Review API dependencies…');
    await run(executable, ['pip', 'install', '--python', python, '--requirement', 'backend/requirements.txt'], { cwd: layout.root, env, signal });
    log('[4/4] Building the local production interface…');
    await npm(['run', 'build']);
    if (!workbenchStatus({ appPath: layout.root }).ok || !fs.existsSync(path.join(layout.root, '.next/BUILD_ID'))) throw new Error('Setup commands finished but the app is incomplete. No ready state was recorded.');
    fs.writeFileSync(path.join(layout.root, 'setup.json'), JSON.stringify({ fingerprint: layout.sources.fingerprint, node: process.versions.node.split('.')[0], preparedAt: new Date().toISOString() }), { mode: 0o600 });
    return managedStatus(layout);
  } finally { unlock(); }
}
