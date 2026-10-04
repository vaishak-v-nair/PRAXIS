// Add Studio's caption-track metadata to the official assembler's wrapper.
import { readFileSync, writeFileSync } from 'node:fs';
const path = new URL('../index.html', import.meta.url);
const source = readFileSync(path, 'utf8');
const wrappers = [...source.matchAll(/<div\b[^>]*\bid="el-captions"[^>]*>/g)];
if (wrappers.length !== 1 || !wrappers[0][0].includes('compositions/captions.html')) {
  throw new Error('Expected one assembled caption composition; preserve unexpected markup.');
}
const previous = wrappers[0][0];
if (/\bdata-track-kind=/.test(previous) && !previous.includes('data-track-kind="captions"')) {
  throw new Error('Conflicting track kind; preserve the assembler output.');
}
const labelled = previous.includes('data-track-kind="captions"')
  ? previous : previous.replace('id="el-captions"', 'id="el-captions" data-track-kind="captions"');
if (labelled !== previous) writeFileSync(path, source.replace(previous, labelled), 'utf8');
console.log('Assembled caption track labelled; picture and audio timing preserved.');
