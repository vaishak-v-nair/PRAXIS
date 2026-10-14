import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { reviewSources, setupNpm } from '../../../src/lib/review-install.js';
import { dependencyNotices, resetGenerated, runtimeManifest, validateRuntime } from './packaging.mjs';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), checkout = path.resolve(desktop, '../..');
const build = path.join(desktop, '.build'), runtime = path.join(desktop, 'src-tauri/runtime'), stage = path.join(build, 'workbench');
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, stdio: 'inherit', ...options });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Desktop preparation failed with exit ${code}. No ready artifact was recorded.`)));
  });
}
async function vendorLicense(url, target) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw new Error('A matching bundled runtime license could not be retrieved from its official source. No redistribution-ready artifact was recorded.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 100 || bytes.length > 2 * 1048576) throw new Error('The official runtime license response was invalid.');
  fs.writeFileSync(target, bytes);
}
fs.mkdirSync(build, { recursive: true }); resetGenerated(stage, desktop); resetGenerated(runtime, desktop);
const sources = reviewSources();
for (const source of sources.files) { const destination = path.join(stage, source.relative); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, source.bytes); }
// Change only the generated staging copy. The shipped Workbench remains the
// canonical UI and scanner; these settings package its existing SSR server.
const config = path.join(stage, 'next.config.ts');
const configuration = fs.readFileSync(config, 'utf8');
if (!configuration.includes('const config: NextConfig = {')) throw new Error('Workbench build config changed. Review standalone packaging before proceeding.');
fs.writeFileSync(config, configuration.replace('const config: NextConfig = {', 'const config: NextConfig = {\n  output: "standalone",\n  outputFileTracingRoot: process.cwd(),'));
console.log('[1/4] Building the existing Workbench standalone interface.');
const npm = setupNpm(['ci', '--no-audit', '--no-fund']); await run(npm.command, npm.args, { cwd: stage });
const next = path.join(stage, 'node_modules/next/dist/bin/next');
await run(process.execPath, [next, 'build'], { cwd: stage, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
fs.cpSync(path.join(stage, '.next/standalone'), path.join(runtime, 'ui'), { recursive: true, dereference: true });
fs.cpSync(path.join(stage, '.next/static'), path.join(runtime, 'ui/.next/static'), { recursive: true });
if (fs.existsSync(path.join(stage, 'public'))) fs.cpSync(path.join(stage, 'public'), path.join(runtime, 'ui/public'), { recursive: true });
console.log('[2/4] Bundling a native Python API using the existing backend.');
const pythonBase = process.env.PRAXIS_DESKTOP_BUILD_PYTHON || path.join(checkout, 'apps/workbench/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const pythonEnv = path.join(build, 'python');
if (!fs.existsSync(path.join(pythonEnv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'))) await run(pythonBase, ['-m', 'venv', pythonEnv]);
const python = path.join(pythonEnv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const pythonVersion = spawnSync(python, ['-c', 'import platform; print(platform.python_version())'], { encoding: 'utf8', windowsHide: true });
if (pythonVersion.status !== 0 || !/^\d+\.\d+\.\d+\s*$/.test(pythonVersion.stdout)) throw new Error('The Python build runtime version could not be established.');
const pythonRelease = pythonVersion.stdout.trim();
await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', path.join(stage, 'backend/requirements.txt'), '-r', path.join(desktop, 'requirements-build.txt')]);
const hidden = sources.files.filter(file => /^backend\/regen\/[^/]+\.py$/.test(file.relative)).flatMap(file => ['--hidden-import', `regen.${path.basename(file.relative, '.py')}`]);
await run(python, ['-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--name', 'praxis-review-api', '--distpath', path.join(runtime, 'api'), '--workpath', path.join(build, 'pyinstaller'), '--specpath', build, '--paths', path.join(stage, 'backend'), '--collect-submodules', 'uvicorn', '--collect-all', 'playwright', '--collect-data', 'certifi', ...hidden, path.join(desktop, 'backend-entry.py')], { env: { ...process.env, PYTHONPATH: path.join(stage, 'backend'), PRAXIS_WORKBENCH_DATA_DIR: path.join(build, 'packaging-data'), PRAXIS_WORKBENCH_ENV_FILE: path.join(build, 'no-provider.env') } });
// Frozen regen modules live below _internal/regen. Their existing __file__
// lookup resolves the Workbench tools next to the frozen executable. Preserve
// that contract and copy only the allowlisted bridge plus shared MCP modules.
for (const source of sources.files.filter(source => source.relative.startsWith('tools/') && source.relative !== 'tools/backend.mjs')) {
  const destination = path.join(runtime, 'api/praxis-review-api', source.relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, source.bytes);
}
console.log('[3/4] Bundling the matching Node runtime and local owner.');
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'; fs.copyFileSync(process.execPath, path.join(runtime, nodeName));
if (process.platform !== 'win32') fs.chmodSync(path.join(runtime, nodeName), 0o755);
for (const [source, name] of [[path.join(checkout, 'src/lib/review-service.js'), 'review-service.mjs'], [path.join(checkout, 'src/lib/review-service-runtime.js'), 'review-service-runtime.mjs'], [path.join(desktop, 'runtime/supervisor.mjs'), 'supervisor.mjs']]) fs.copyFileSync(source, path.join(runtime, name));
fs.copyFileSync(path.join(checkout, 'LICENSE'), path.join(runtime, 'PRAXIS-LICENSE.txt'));
await vendorLicense(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`, path.join(runtime, 'NODE-LICENSE.txt'));
await vendorLicense(`https://raw.githubusercontent.com/python/cpython/v${pythonRelease}/LICENSE`, path.join(runtime, 'PYTHON-LICENSE.txt'));
fs.copyFileSync(path.join(stage, 'package-lock.json'), path.join(runtime, 'WORKBENCH-PACKAGE-LOCK.json'));
fs.copyFileSync(path.join(stage, 'backend/requirements.txt'), path.join(runtime, 'WORKBENCH-REQUIREMENTS.txt'));
dependencyNotices(path.join(stage, 'node_modules'), path.join(runtime, 'licenses/npm'));
const pythonSite = spawnSync(python, ['-c', 'import sysconfig; print(sysconfig.get_path("purelib"))'], { encoding: 'utf8', windowsHide: true });
const pythonSiteRelative = path.relative(pythonEnv, path.resolve(pythonSite.stdout?.trim() || pythonEnv));
if (pythonSite.status !== 0 || !pythonSiteRelative || pythonSiteRelative.startsWith('..') || path.isAbsolute(pythonSiteRelative)) throw new Error('The private Python dependency location could not be established.');
dependencyNotices(pythonSite.stdout.trim(), path.join(runtime, 'licenses/python'));
fs.writeFileSync(path.join(runtime, 'THIRD-PARTY-NOTICES.txt'), `PRAXIS desktop contains the native Node.js ${process.version} runtime and Python ${pythonRelease}. Their matching vendor licenses accompany this distribution as NODE-LICENSE.txt and PYTHON-LICENSE.txt. Vendor notice texts from the pinned Workbench npm/Python build environments are retained in licenses/npm and licenses/python. WORKBENCH-PACKAGE-LOCK.json and WORKBENCH-REQUIREMENTS.txt record requested dependency versions; apps/desktop/src-tauri/Cargo.lock records Rust/Tauri build dependencies in the source distribution. Complete native binary redistribution-notice review remains part of public release acceptance.\n`);
console.log('[4/4] Checking every bundled file and recording target hashes.');
const manifest = runtimeManifest(runtime, { mode: 'standalone', version: JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'))).version, runtimeId: sources.fingerprint, platform: process.platform, arch: process.arch, nodeVersion: process.version, pythonVersion: pythonRelease, builtAt: new Date().toISOString(), backend: `api/praxis-review-api/praxis-review-api${process.platform === 'win32' ? '.exe' : ''}`, frontend: 'ui/server.js' });
validateRuntime(runtime);
console.log(`Prepared ${(manifest.totalBytes / 1048576).toFixed(1)} MiB of real native runtime files. Run the packaged-runtime smoke before producing an installer.`);
