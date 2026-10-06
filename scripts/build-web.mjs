// Build the self-contained landing page: web/_src.html + web/_assets/* →
// web/index.html, a COMPLETE standalone HTML document (doctype, head with
// viewport/charset/OG/favicon) for hosting on Vercel/Pages where the file is
// served raw. Assets inline as data URIs so there are no external requests.
// One-time: `--extract` recovers assets from a built page.
//
// Note: _src.html holds only <title>/<meta>/<style>/body — no head scaffold —
// so it stays valid as a claude.ai artifact body too. The scaffold below is
// added ONLY to the standalone build; don't republish index.html as an
// artifact (the platform adds its own head and would double-wrap it).
import fs from 'node:fs';
import path from 'node:path';
import { buildBrowserEngine } from './build-browser-engine.mjs';

const root = path.join(import.meta.dirname, '..');
const SRC = path.join(root, 'web', '_src.html');
const OUT = path.join(root, 'web', 'index.html');
const ASSETS = path.join(root, 'web', '_assets');
// Official public home. The existing Pages mirror remains a supported host.
const SITE = 'https://praxis-six-xi.vercel.app';
fs.mkdirSync(path.join(root, 'web/test-your-project'), {recursive:true});
fs.writeFileSync(path.join(root, 'web/test-your-project/release.json'), JSON.stringify({
  schema: 'praxis.review-install.v1',
  version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
}) + '\n');

if (process.argv.includes('--extract')) {
  const html = fs.readFileSync(OUT, 'utf8');
  const uris = [...html.matchAll(/data:image\/(png|webp);base64,([A-Za-z0-9+/=]+)/g)];
  fs.mkdirSync(ASSETS, { recursive: true });
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
const navicon = uri('navicon.png', 'image/png');

// Head scaffold. `<head>` is left open on purpose — _src.html's <title>/<meta>/
// <style> continue in head, and the parser auto-opens <body> at the first flow
// element (the <nav>). Charset must come first; viewport makes mobile work.
const HEAD = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#150d0b">
<link rel="icon" href="${navicon}">
<link rel="canonical" href="${SITE}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="PRAXIS">
<meta property="og:title" content="PRAXIS — check what works in the project you built with AI.">
<meta property="og:description" content="Start with a browser source review. See grounded findings, choose deeper local checks, and give your coding agent a clear next step. Docker is optional.">
<meta property="og:url" content="${SITE}/">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="PRAXIS — the axolotl mascot beside the command: npx praxis-memory demo.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="PRAXIS — check what works in the project you built with AI.">
<meta name="twitter:description" content="Review your AI-built project in the browser or locally. See source-backed findings and choose the next change.">
<meta name="twitter:image" content="${SITE}/og.png">
`;

let body = fs.readFileSync(SRC, 'utf8')
  .replaceAll('__APPEARANCE__', fs.readFileSync(path.join(root, 'web', 'appearance.js'), 'utf8'))
  .replaceAll('__NAVICON__', navicon)
  .replaceAll('__PET__', uri('pet.webp', 'image/webp'))
  .replaceAll('__FLOW__', uri('flow.webp', 'image/webp'))
  // the launch recording, cut from the real command — docs/demo.gif is the
  // source of truth; web/_assets holds the copy the build inlines
  .replaceAll('__DEMOGIF__', uri('demo.gif', 'image/gif'));

fs.writeFileSync(OUT, HEAD + body);
buildBrowserEngine(root);
console.log('built web/index.html', (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB');
