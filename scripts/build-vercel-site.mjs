// Support the existing Vercel project rooted in web, without publishing raw source.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPublicSite } from './build-public-site.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const MARKER = '.praxis-static-output';

export function buildVercelSite(root = ROOT) {
  root = path.resolve(root);
  const web = path.join(root, 'web'), destination = path.join(web, 'dist');
  if (fs.lstatSync(web).isSymbolicLink() || path.relative(root, destination).replaceAll('\\', '/') !== 'web/dist') {
    throw new Error('Vercel output must stay in the real web/dist directory.');
  }
  if (fs.existsSync(destination)) {
    if (fs.lstatSync(destination).isSymbolicLink() ||
        fs.realpathSync(destination).toLowerCase() !== destination.toLowerCase() ||
        !fs.existsSync(path.join(destination, MARKER)) ||
        fs.readFileSync(path.join(destination, MARKER), 'utf8') !== 'praxis.static-output.v1\n') {
      throw new Error('Vercel output contains unrelated files or a redirected path. Existing files were preserved.');
    }
  }
  const staged = buildPublicSite(root);
  if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true });
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, MARKER), 'praxis.static-output.v1\n');
  for (const file of staged.files) {
    const target = path.join(destination, file.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(staged.destination, file.file), target);
  }
  return { destination, files: staged.files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await import('./build-web.mjs');
  console.log(JSON.stringify(buildVercelSite()));
}
