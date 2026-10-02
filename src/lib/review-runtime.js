// Optional Review bootstrap. Core commands never download or execute these tools.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

export const UV_VERSION = '0.12.22';
// Official astral-sh/uv release archives. Changing a pin requires rechecking its SHA256.
const ASSETS = {
  'win32-x64': ['uv-x86_64-pc-windows-msvc.zip', 'ea1397797a0ca15f63516dd0f49c2dde9776db9be5861cab152ebe8ad199894d'],
  'win32-arm64': ['uv-aarch64-pc-windows-msvc.zip', '6a42b919c2bb7135f07b4d1bb8e489f0eaab0bae039020573cc522d831e2d32e'],
  'darwin-x64': ['uv-x86_64-apple-darwin.tar.gz', '1b8a5b316883df2daf20fb9a446e5b230e01d947d57aba2694977c5ac5a7e98c'],
  'darwin-arm64': ['uv-aarch64-apple-darwin.tar.gz', '5d714de09501a59393ceca78f4bc232a50478729640d251907160299b2a93ddd'],
  'linux-x64': ['uv-x86_64-unknown-linux-gnu.tar.gz', 'b9980552309f09c15172b8be828555e375097f16deb459795ce7bfd200380f0b'],
  'linux-arm64': ['uv-aarch64-unknown-linux-gnu.tar.gz', '6f66a14e8239871fb477f9746c941fedfa77e8fe28a8bc7c07e1dc7f53a66712'],
};
export function uvAsset(platform = process.platform, arch = process.arch) {
  const asset = ASSETS[`${platform}-${arch}`];
  if (!asset) throw new Error(`Automatic Review setup does not support ${platform}/${arch}. Use the source setup guide.`);
  return { file: asset[0], sha256: asset[1], url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset[0]}` };
}
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function managedDirectory(directory, base) {
  if (!path.isAbsolute(base) || !path.isAbsolute(directory)) throw new Error('Managed runtime directories must be absolute.');
  const relative = path.relative(base, directory);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Managed directory escaped Review home.');
  if (fs.existsSync(base) && fs.lstatSync(base).isSymbolicLink()) throw new Error('Managed Review directories cannot be symbolic links.');
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  let current = base;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Managed Review directories cannot be symbolic links.');
    fs.mkdirSync(current, { recursive: true, mode: 0o700 });
  }
}

/** Stop only the process tree started by PRAXIS, never listeners owned by others. */
export function stopTree(child) {
  if (!child?.pid || child.exitCode != null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.once('error', () => child.kill('SIGTERM'));
  } else child.kill('SIGTERM');
}

export async function runCommand(command, args, { cwd, env = process.env, signal, timeout = 600000 } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: true, shell: false });
    let problem;
    const stop = () => { problem = new Error('Setup was cancelled. Completed files are retained; rerun to resume.'); stopTree(child); };
    const timer = setTimeout(() => { problem = new Error(`${path.basename(command)} exceeded the setup time limit. Rerun to resume.`); stopTree(child); }, timeout);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    const finish = error => {
      clearTimeout(timer); signal?.removeEventListener('abort', stop);
      error ? reject(error) : resolve();
    };
    child.once('error', () => finish(new Error(`Could not start ${path.basename(command)}. Check the setup log.`)));
    child.once('close', code => finish(problem || (code === 0 ? null : new Error(`${path.basename(command)} exited with code ${code}. Setup is incomplete; rerun after resolving the error.`))));
  });
}

export async function downloadVerified(asset, destination, { fetchImpl = fetch, signal, timeout = 120000, maxBytes = 40 * 1024 * 1024 } = {}) {
  const response = await fetchImpl(asset.url, { signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]) });
  if (!response.ok || !response.body) throw new Error(`Could not download the official uv runtime (HTTP ${response.status}). Check network access to GitHub.`);
  const chunks = []; let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error('The runtime download exceeds the expected size limit.');
      chunks.push(Buffer.from(value));
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = Buffer.concat(chunks);
  if (sha256(bytes) !== asset.sha256) throw new Error('Official runtime checksum mismatch. Nothing was extracted or executed.');
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, destination); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function executableIn(directory, name, depth = 0) {
  if (depth > 2) return null;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Unexpected symbolic link in the runtime archive.');
    const file = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === name) return file;
    if (entry.isDirectory()) { const found = executableIn(file, name, depth + 1); if (found) return found; }
  }
  return null;
}

export async function ensureUv(home, { run = runCommand, fetchImpl, signal, platform = process.platform, arch = process.arch } = {}) {
  const asset = uvAsset(platform, arch);
  const directory = path.join(home, 'tools', `uv-${UV_VERSION}-${platform}-${arch}`);
  managedDirectory(directory, home);
  const receiptPath = path.join(directory, 'runtime.json');
  if (fs.existsSync(receiptPath)) {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const executable = path.resolve(directory, receipt.executable || '');
    if (!executable.startsWith(directory + path.sep) || receipt.archive !== asset.sha256 ||
        !fs.existsSync(executable) || fs.lstatSync(executable).isSymbolicLink() || sha256(fs.readFileSync(executable)) !== receipt.binary) {
      throw new Error('The cached runtime changed or is incomplete. Inspect the tools directory before reinstalling.');
    }
    return executable;
  }
  managedDirectory(path.join(home, 'downloads'), home);
  const archive = path.join(home, 'downloads', asset.file);
  if (!fs.existsSync(archive) || sha256(fs.readFileSync(archive)) !== asset.sha256) {
    await downloadVerified(asset, archive, { fetchImpl, signal });
  }
  if (platform === 'win32') {
    const literal = value => "'" + value.replaceAll("'", "''") + "'";
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${literal(archive)} -DestinationPath ${literal(directory)} -Force`], { signal, timeout: 120000 });
  } else {
    await run('tar', ['-xzf', archive, '-C', directory], { signal, timeout: 120000 });
  }
  const executable = executableIn(directory, platform === 'win32' ? 'uv.exe' : 'uv');
  if (!executable) throw new Error('The official runtime archive does not contain uv. Setup stopped.');
  if (platform !== 'win32') fs.chmodSync(executable, 0o700);
  fs.writeFileSync(receiptPath, JSON.stringify({ archive: asset.sha256, executable: path.relative(directory, executable), binary: sha256(fs.readFileSync(executable)) }), { mode: 0o600 });
  return executable;
}
