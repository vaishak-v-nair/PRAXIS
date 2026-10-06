// Stage only the public website for a manual static deployment. No repo upload.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function buildPublicSite(root = path.resolve(import.meta.dirname, '..')) {
root = path.resolve(root);
const destination = path.join(root, 'apps/workbench/.regen/artifacts/public-site');
// This is one dedicated generated directory, never a source or evidence folder.
if (fs.existsSync(destination)) {
  if (fs.lstatSync(destination).isSymbolicLink() || fs.realpathSync(destination).toLowerCase() !== destination.toLowerCase()) {
    throw new Error('Public staging destination must not resolve through a symbolic link.');
  }
  if (path.relative(root, destination).replaceAll('\\', '/') !== 'apps/workbench/.regen/artifacts/public-site') throw new Error('Unexpected public staging directory.');
  fs.rmSync(destination, { recursive: true });
}
fs.mkdirSync(destination, {recursive:true});
const files = [];
// Only deploy reviewed website files. Local QA captures and other untracked
// files may live under web/ but must never become public assets.
const publicFiles = new Set([
  '_headers', 'appearance.js', 'index.html', 'og.png',
  '_assets/demo.gif', '_assets/flow.webp', '_assets/navicon.png', '_assets/pet.webp',
  'live/app.js', 'live/engine-visual.js', 'live/graph.js', 'live/index.html', 'live/style.css',
  'receipt/explorer.js', 'receipt/index.html', 'receipt/style.css', 'receipt/verify.js',
  'test-your-project/app.js', 'test-your-project/index.html', 'test-your-project/install.mjs',
  'test-your-project/local.html', 'test-your-project/report.js', 'test-your-project/style.css',
  'test-your-project/worker.js', 'test-your-project/release.json',
  'test-your-project/engine/browser.py', 'test-your-project/engine/manifest.json',
  'test-your-project/engine/reality.py', 'test-your-project/engine/scanner.py',
]);
const publicDirectories = new Set([...publicFiles].flatMap(file => {
  const parts = file.split('/');
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}));
function copy(directory, prefix = '') {
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    if (entry.isSymbolicLink()) continue;
    const relative = prefix + entry.name;
    if (entry.isDirectory()) {
      if (publicDirectories.has(relative)) copy(path.join(directory,entry.name), relative + '/');
      continue;
    }
    if (!publicFiles.has(relative)) continue;
    let bytes = fs.readFileSync(path.join(directory, entry.name));
    if (relative === 'index.html') {
      let html = bytes.toString('utf8');
      for (const [name, mime] of [['navicon.png','image/png'],['pet.webp','image/webp'],['flow.webp','image/webp'],['demo.gif','image/gif']]) {
        if (!fs.existsSync(path.join(root,'web/_assets',name))) continue;
        html = html.replaceAll(`data:${mime};base64,` + fs.readFileSync(path.join(root,'web/_assets',name)).toString('base64'), './_assets/' + name);
      }
      bytes = Buffer.from(html);
    }
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), {recursive:true}); fs.writeFileSync(target, bytes);
    files.push({file:relative,sha:createHash('sha1').update(bytes).digest('hex'),size:bytes.length});
  }
}
copy(path.join(root,'web'));
fs.writeFileSync(path.join(destination, 'manifest-for-upload.json'), JSON.stringify(files));
// Wrangler should serve website assets, not deployment bookkeeping.
fs.writeFileSync(path.join(destination, '.assetsignore'), 'manifest-for-upload.json\n');
return {destination,files,bytes:files.reduce((total,file)=>total+file.size,0)};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildPublicSite();
  console.log(JSON.stringify({...result, files:result.files.length}));
}
