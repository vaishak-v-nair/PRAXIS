// Regenerate web/og.png — the social share card. Needs the private brand
// vault (assets/source/) on disk; on a clone without it, this script is a
// no-op and the committed web/og.png stays as-is.
// Mascot: one frame of happy.mp4 through the standard chroma pipeline
// (colorkey → despeckle → 1px erode, so no dark fringe on any background),
// then GDI+ (scripts/gen-og.ps1) lays out the card — Windows text rendering
// is deterministic, sharp's SVG text path is not (no fontconfig).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';

const SRC = 'assets/source/happy.mp4';
const FRAME_AT = '1.5';
if (!fs.existsSync(SRC)) {
  console.log('brand vault not present — keeping the committed web/og.png');
  process.exit(0);
}

function despeckleAndErode(data, w, h) {
  const A = Buffer.from(data);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4 + 3;
      if (A[i] === 0) continue;
      let n = 0, edge = false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || yy >= h || xx < 0 || xx >= w) { edge = true; continue; }
          if (A[(yy * w + xx) * 4 + 3] > 40) n++; else edge = true;
        }
      if (n < 2 || edge) { data[i - 3] = 0; data[i - 2] = 0; data[i - 1] = 0; data[i] = 0; }
    }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-og-'));
execFileSync(ffmpeg, [
  '-ss', FRAME_AT, '-i', SRC, '-frames:v', '1',
  '-vf', 'colorkey=0x000000:0.10:0.05',
  path.join(tmp, 'f.png'),
], { stdio: 'ignore' });

const img = sharp(path.join(tmp, 'f.png')).ensureAlpha();
const { width, height } = await img.metadata();
const raw = await img.raw().toBuffer();
despeckleAndErode(raw, width, height);
const mascot = path.join(tmp, 'mascot.png');
await sharp(raw, { raw: { width, height, channels: 4 } })
  .trim({ threshold: 8 })
  .png()
  .toFile(mascot);

execFileSync('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass',
  '-File', 'scripts/gen-og.ps1',
  '-Mascot', mascot,
  '-Out', path.resolve('web/og.png'),
], { stdio: 'inherit' });

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`web/og.png ${Math.round(fs.statSync('web/og.png').size / 1024)} KB`);
