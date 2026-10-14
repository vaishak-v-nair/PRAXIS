import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { reviewSources } from '../../../src/lib/review-install.js';
import { hash, resetBundledRuntime, validateRuntime } from './packaging.mjs';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = validateRuntime(path.join(desktop, 'src-tauri/runtime'));
if (manifest.runtimeId !== reviewSources().fingerprint) throw new Error('The bundled engine is older than the current Workbench source. Run prepare:runtime and smoke:runtime again before building.');
for (const [source, bundled] of [[path.resolve(desktop, '../../src/lib/review-service.js'), 'review-service.mjs'], [path.resolve(desktop, '../../src/lib/review-service-runtime.js'), 'review-service-runtime.mjs'], [path.join(desktop, 'runtime/supervisor.mjs'), 'supervisor.mjs']]) {
  if (hash(source) !== manifest.files.find(file => file.file === bundled)?.sha256) throw new Error('The desktop owner changed after runtime staging. Run prepare:runtime and smoke:runtime again before building.');
}
const arguments_ = process.argv.slice(2);
const targetOption = arguments_.findIndex(argument => argument === '--target' || argument.startsWith('--target='));
const target = targetOption < 0 ? undefined : arguments_[targetOption].startsWith('--target=') ? arguments_[targetOption].slice('--target='.length) : arguments_[targetOption + 1];
const nativeTargets = { 'win32-x64': 'x86_64-pc-windows-msvc', 'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin', 'linux-x64': 'x86_64-unknown-linux-gnu' };
if (targetOption >= 0 && (!target || !nativeTargets[`${manifest.platform}-${manifest.arch}`] || target !== nativeTargets[`${manifest.platform}-${manifest.arch}`])) throw new Error('Desktop runtimes must be built on the matching native target; cross-architecture frozen engines are unsupported.');
const resources = path.join(desktop, 'src-tauri/target', ...(target ? [target] : []), arguments_.includes('--debug') ? 'debug' : 'release', 'runtime');
// Prevent an old frontend chunk or vulnerable dependency surviving a new bundle.
// Only the exact copied runtime directory is reset, never binaries or user data.
resetBundledRuntime(resources, desktop);
// An incremental Cargo build can skip build.rs and its resource copy entirely.
// Populate the validated tree explicitly so both incremental and clean builds
// launch exactly the engine that is about to be packaged.
fs.cpSync(path.join(desktop, 'src-tauri/runtime'), resources, { recursive: true, dereference: false });
validateRuntime(resources);
const child = spawn(process.execPath, [path.join(desktop, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', ...arguments_], { cwd: desktop, stdio: 'inherit', windowsHide: true, shell: false });
child.once('exit', code => {
  process.exitCode = code ?? 1;
  if (code === 0) {
    try {
      const copied = validateRuntime(resources);
      if (copied.runtimeId !== manifest.runtimeId) throw new Error('The native build copied an unexpected runtime.');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
});
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
