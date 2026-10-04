import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const directory = join(project, 'assets', 'fonts');
const captured = join(project, 'capture', 'assets', 'fonts');
await mkdir(directory, { recursive: true });
await mkdir(captured, { recursive: true });
for (const [family, output] of [['inter', 'Inter-variable.ttf'], ['ebgaramond', 'EB_Garamond-variable.ttf'], ['jetbrainsmono', 'JetBrains_Mono-variable.ttf']]) {
  const result = await fetch(`https://api.github.com/repos/google/fonts/contents/ofl/${family}`, {
    headers: { 'User-Agent': 'PRAXIS-video-build' }, signal: AbortSignal.timeout(20000),
  });
  if (!result.ok) throw new Error(`Official font directory HTTP ${result.status}`);
  const files = await result.json();
  const face = files.find(file => file.name.endsWith('.ttf') && !file.name.toLowerCase().includes('italic'));
  const license = files.find(file => file.name === 'OFL.txt');
  if (!face || !license) throw new Error(`Font or license missing: ${family}`);
  for (const [file, name] of [[face, output], [license, `${family}-OFL.txt`]]) {
    if (!file.download_url.startsWith('https://raw.githubusercontent.com/google/fonts/')) throw new Error('Unexpected font host');
    const response = await fetch(file.download_url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Font download HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== file.size) throw new Error(`Incomplete font download: ${name}`);
    await writeFile(join(directory, name), bytes);
    await copyFile(join(directory, name), join(captured, name));
  }
  console.log(`Staged ${output} and OFL license from google/fonts`);
}
