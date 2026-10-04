// Use the official assembler while preserving reviewed, reusable frame sources.
// Its approved-video hoist also writes the stripped frame to disk. Restore those
// inputs even when it fails, so a second assembly cannot silently lose footage.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = process.argv[2];
if (!script) throw new Error('Pass the installed product-launch-video assemble-index.mjs path.');
const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const folder = join(project, 'compositions', 'frames');
const sources = readdirSync(folder).filter(name => name.endsWith('.html'))
  .map(name => ({ path: join(folder, name), bytes: readFileSync(join(folder, name)) }));
let result;
try {
  result = spawnSync(process.execPath, [resolve(script), '--storyboard', 'STORYBOARD.md', '--hyperframes', '.'],
    { cwd: project, stdio: 'inherit' });
  if (result.status === 0) {
    // The host owns the hoisted native media. Runtime templates must be the
    // stripped versions, or restoring authoring inputs would mount every video
    // twice. Keep generated templates separate from the reusable source.
    const generated = join(project, 'compositions', 'assembled');
    mkdirSync(generated, { recursive: true });
    for (const source of sources) copyFileSync(source.path, join(generated, source.path.split(/[\\/]/).at(-1)));
    const indexPath = join(project, 'index.html');
    let count = 0;
    const index = readFileSync(indexPath, 'utf8').replace(
      /data-composition-src="compositions\/frames\/([^"/]+\.html)"/g,
      (_, name) => { count++; return `data-composition-src="compositions/assembled/${name}"`; });
    if (count !== sources.length) throw new Error(`Expected ${sources.length} frame mounts; found ${count}.`);
    writeFileSync(indexPath, index);
  }
} finally {
  for (const source of sources) {
    if (!readFileSync(source.path).equals(source.bytes)) writeFileSync(source.path, source.bytes);
  }
}
if (result?.error) throw result.error;
if (result?.status !== 0) process.exit(result?.status || 1);
console.log('Official assembly completed; all reviewed frame sources preserved.');
