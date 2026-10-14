import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
/** Copy vendor notice texts, never whole development packages or user state. */
export function dependencyNotices(source, destination) {
  if (!path.isAbsolute(source) || !path.isAbsolute(destination) || fs.lstatSync(source).isSymbolicLink()) throw new Error('Dependency notices require real absolute package directories.');
  const records = [];
  function visit(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || ['__pycache__', '.bin', '.git'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name), name = relative + entry.name;
      if (entry.isDirectory()) visit(file, name + '/');
      else if (entry.isFile() && /^(?:licen[cs]e|copying|notice|third-party-notices)(?:[-_.].*)?$/i.test(entry.name)) {
        if (fs.statSync(file).size > 2 * 1048576 || records.length >= 1000) throw new Error('The dependency notice set is oversized.');
        const target = path.join(destination, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(file, target); records.push(name);
      }
    }
  }
  visit(source); return records;
}
function noLinkedParents(directory, boundary) {
  const relative = path.relative(boundary, directory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Refusing a runtime path outside its generated directory.');
  let current = boundary;
  for (const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Refusing a linked generated runtime path.');
  }
}
export function resetGenerated(directory, desktop) {
  const resolved = path.resolve(directory), root = path.resolve(desktop);
  const permitted = [path.join(root, '.build'), path.join(root, 'src-tauri/runtime')];
  if (!permitted.some(target => resolved === target || resolved.startsWith(target + path.sep)) || fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) throw new Error('Refusing to reset a directory outside desktop-generated output.');
  noLinkedParents(resolved, root);
  fs.rmSync(resolved, { recursive: true, force: true }); fs.mkdirSync(resolved, { recursive: true });
}
/** Tauri copies resources without pruning files removed from previous builds. */
export function resetBundledRuntime(directory, desktop) {
  const resolved = path.resolve(directory), root = path.resolve(desktop);
  const target = path.join(root, 'src-tauri/target'), parts = path.relative(target, resolved).split(path.sep);
  const nativeTarget = /^[a-zA-Z0-9_]+(?:-[a-zA-Z0-9_]+){2,}$/;
  const valid = parts.length === 2 && ['debug', 'release'].includes(parts[0]) && parts[1] === 'runtime'
    || parts.length === 3 && nativeTarget.test(parts[0]) && ['debug', 'release'].includes(parts[1]) && parts[2] === 'runtime';
  if (!valid) throw new Error('Refusing to reset anything except generated native runtime resources.');
  noLinkedParents(resolved, root);
  fs.rmSync(resolved, { recursive: true, force: true }); fs.mkdirSync(resolved, { recursive: true });
}
function runtimeFiles(directory) {
  if (!fs.statSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw new Error('Bundled runtime must be a real directory.');
  const records = [];
  function visit(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Bundled runtime cannot contain symbolic links: ${relative}${entry.name}`);
      const file = path.join(current, entry.name), name = relative + entry.name;
      if (entry.isDirectory()) visit(file, name + '/');
      else if (entry.isFile() && name !== 'manifest.json') {
        if (/(^|\/)(\.env(?:\.|$)|\.praxis|\.regen|\.venv|jobs\.sqlite3|provider\.env|assets\/source|test-results)/i.test(name)) throw new Error(`Private or development state cannot enter a desktop artifact: ${name}`);
        if (name.includes('\\') || records.length >= 100000) throw new Error('Invalid or oversized bundled runtime file set.');
        records.push({ file: name, bytes: fs.statSync(file).size, sha256: hash(file) });
      }
    }
  }
  visit(directory); records.sort((a, b) => a.file.localeCompare(b.file, 'en'));
  return records;
}
export function runtimeManifest(directory, metadata) {
  const records = runtimeFiles(directory);
  const manifest = { ...metadata, schema: 'praxis.desktop-runtime.v1', totalBytes: records.reduce((total, item) => total + item.bytes, 0), files: records };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2)); return manifest;
}
export function validateRuntime(directory, { platform = process.platform, arch = process.arch } = {}) {
  const file = path.join(directory, 'manifest.json');
  noLinkedParents(file, path.resolve(directory));
  if (fs.statSync(file).size > 16 * 1048576) throw new Error('Bundled runtime manifest is oversized.');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.schema !== 'praxis.desktop-runtime.v1' || manifest.mode !== 'standalone' || manifest.platform !== platform || manifest.arch !== arch || !Array.isArray(manifest.files) || manifest.files.length > 100000) throw new Error('Desktop runtime does not match this target. Build it on a matching native target.');
  const names = new Set();
  for (const entry of manifest.files) {
    if (typeof entry.file !== 'string' || !entry.file || path.isAbsolute(entry.file) || entry.file.includes('\\') || entry.file.split('/').some(part => !part || part === '..' || part === '.') || names.has(entry.file) || !/^[a-f0-9]{64}$/.test(entry.sha256 || '') || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw new Error('Invalid bundled runtime file manifest.');
    names.add(entry.file);
    const target = path.join(directory, entry.file);
    if (!fs.existsSync(target) || fs.lstatSync(target).isSymbolicLink() || hash(target) !== entry.sha256 || fs.statSync(target).size !== entry.bytes) throw new Error(`Bundled runtime integrity failed: ${entry.file}`);
  }
  const actual = runtimeFiles(directory);
  if (actual.length !== names.size || actual.some(entry => !names.has(entry.file)) || manifest.totalBytes !== actual.reduce((total, entry) => total + entry.bytes, 0)) throw new Error('Bundled runtime contains unrecorded or incomplete files. Rebuild the artifact.');
  for (const required of [platform === 'win32' ? 'node.exe' : 'node', manifest.backend, manifest.frontend, 'supervisor.mjs', 'review-service.mjs', 'review-service-runtime.mjs']) {
    if (!names.has(required)) throw new Error(`Bundled runtime is missing ${required}.`);
  }
  if (names.has('ui/.next/BUILD_ID') === false || !manifest.files.some(item => item.file.startsWith('ui/.next/static/'))) throw new Error('Bundled frontend static assets are incomplete.');
  for (const required of ['api/praxis-review-api/tools/mcp-evidence.mjs', 'api/praxis-review-api/tools/verify/mcp-sources.js', 'api/praxis-review-api/tools/verify/mcp-client.js', 'api/praxis-review-api/tools/verify/schema.js', 'api/praxis-review-api/tools/verify/package.json']) {
    if (!names.has(required)) throw new Error(`Bundled evidence bridge is missing ${required}.`);
  }
  return manifest;
}
