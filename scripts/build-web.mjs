// Build the self-contained landing page: web/_src.html + web/_assets/* →
// web/index.html. Assets are inlined as data URIs so the artifact needs no
// external hosts. One-time: `--extract` pulls the assets back out of an
// existing built index.html (document order: navicon, pet/flow by type).
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const SRC = path.join(root, 'web', '_src.html');
const OUT = path.join(root, 'web', 'index.html');
const ASSETS = path.join(root, 'web', '_assets');

if (process.argv.includes('--extract')) {
  const html = fs.readFileSync(OUT, 'utf8');
  const uris = [...html.matchAll(/data:image\/(png|webp);base64,([A-Za-z0-9+/=]+)/g)];
  fs.mkdirSync(ASSETS, { recursive: true });
  // document order in the built page: navicon(png), pet(webp), flow(webp), navicon(png)
  const seen = { png: 0, webp: 0 };
  for (const [, type, b64] of uris) {
    let name = null;
    if (type === 'png' && seen.png === 0) name = 'navicon.png';
    if (type === 'webp') name = seen.webp === 0 ? 'pet.webp' : 'flow.webp';
    seen[type]++;
    if (name) fs.writeFileSync(path.join(ASSETS, name), Buffer.from(b64, 'base64'));
  }
  console.log('extracted:', fs.readdirSync(ASSETS).map((f) => `${f} ${(fs.statSync(path.join(ASSETS, f)).size / 1024).toFixed(0)}KB`).join(' · '));
  process.exit(0);
}

const uri = (file, mime) => `data:${mime};base64,` + fs.readFileSync(path.join(ASSETS, file)).toString('base64');
let html = fs.readFileSync(SRC, 'utf8');
html = html
  .replaceAll('__NAVICON__', uri('navicon.png', 'image/png'))
  .replaceAll('__PET__', uri('pet.webp', 'image/webp'))
  .replaceAll('__FLOW__', uri('flow.webp', 'image/webp'));
fs.writeFileSync(OUT, html);
console.log('built web/index.html', (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB');
