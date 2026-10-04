import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const project = fileURLToPath(new URL('..', import.meta.url));
const owned = resolve(project, '.hyperframes');
mkdirSync(owned, { recursive: true });

for (const fail of [false, true]) {
  test(fail ? 'failed official assembly preserves reusable media sources' : 'runtime uses hoisted media once and preserves authoring sources', () => {
    const root = mkdtempSync(join(owned, 'assembly-test-'));
    try {
      mkdirSync(join(root, 'scripts'));
      mkdirSync(join(root, 'compositions', 'frames'), { recursive: true });
      copyFileSync(join(project, 'scripts', 'assemble-film.mjs'), join(root, 'scripts', 'assemble-film.mjs'));
      const input = '<template><video id="film" src="real.mp4"></video><h1>Real work</h1></template>';
      const frame = join(root, 'compositions', 'frames', '01-test.html');
      writeFileSync(frame, input);
      const fake = join(root, 'official-test-fixture.mjs');
      writeFileSync(fake, `import {readFileSync,writeFileSync} from 'node:fs';
        const path='compositions/frames/01-test.html';
        writeFileSync(path,readFileSync(path,'utf8').replace('<video id="film" src="real.mp4"></video>','<!-- hoisted -->'));
        writeFileSync('index.html','<div data-composition-src="compositions/frames/01-test.html"></div><video id="film" src="real.mp4"></video>');
        console.log('official-mutated'); process.exit(${fail ? 1 : 0});`);
      const run = spawnSync(process.execPath, [join(root, 'scripts', 'assemble-film.mjs'), fake], { encoding: 'utf8' });
      assert.equal(run.status, fail ? 1 : 0, run.stderr);
      assert.ok(run.stdout.includes('official-mutated'), 'Fixture must mutate the input before completing');
      assert.equal(readFileSync(frame, 'utf8'), input);
      if (!fail) {
        const generated = readFileSync(join(root, 'compositions', 'assembled', '01-test.html'), 'utf8');
        assert.ok(!generated.includes('<video'));
        const index = readFileSync(join(root, 'index.html'), 'utf8');
        assert.ok(index.includes('data-composition-src="compositions/assembled/01-test.html"'));
        assert.equal((index.match(/<video/g) || []).length, 1);
      }
    } finally {
      const rel = relative(owned, resolve(root));
      assert.ok(rel && !rel.startsWith('..') && !rel.includes(':'));
      rmSync(root, { recursive: true, force: true });
    }
  });
}
