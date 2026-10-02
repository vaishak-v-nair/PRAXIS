import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export function buildBrowserEngine(root) {
  const destination = path.join(root, 'web/test-your-project/engine');
  fs.mkdirSync(destination, { recursive: true });
  const files = {};
  for (const name of ['scanner.py', 'reality.py', 'browser.py']) {
    const source = fs.readFileSync(path.join(root, 'apps/workbench/backend/regen', name));
    fs.writeFileSync(path.join(destination, name), source);
    files[name] = createHash('sha256').update(source).digest('hex');
  }
  const manifest = { schema: 'praxis.browser-engine.v1', version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, runtime: '314.0.7', files };
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
