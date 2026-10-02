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
function copy(directory, prefix = '') {
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    if (entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name === '_src.html') continue;
    const relative = prefix + entry.name;
    if (entry.isDirectory()) { copy(path.join(directory,entry.name), relative + '/'); continue; }
    if (!/\.(?:html|js|mjs|css|json|py|png|webp|gif|svg)$/i.test(entry.name) && entry.name !== '_headers') continue;
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
