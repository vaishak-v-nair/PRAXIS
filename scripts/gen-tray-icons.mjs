// Generate multi-size .ico files for the tray app from the mascot art.
// PNG-in-ICO (Vista+). Run: node scripts/gen-tray-icons.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'src/tray/icons';
const SIZES = [16, 24, 32, 48];

// state -> source (png file, or [animated webp, page])
const SOURCES = {
  idle: 'assets/mascot-idle.png',
  warning: 'assets/mascot-warning.png',
  limit: 'assets/mascot-limit.png',
  switching: ['assets/tray/flow-alpha.webp', 47],
  restored: ['assets/tray/flow-alpha.webp', 61],
  happy: ['assets/tray/happy-alpha.webp', 30],
};

function ico(pngs) {
  // pngs: [{size, buf}]
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + 16 * count;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}

// ---- animated GIFs for the popover panel (PictureBox plays GIFs natively) ----
// Each emotion is its OWN full source video (assets/source/*.mp4), chroma-keyed
// to transparency — the complete animation, not a stitched loop segment.
import ffmpeg from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const ANIM_OUT = 'src/tray/anim';
const VIDEOS = {
  idle: ['assets/source/idle.mp4', '0.2', 64],
  warning: ['assets/source/warning.mp4', '0.2', 64],
  limit: ['assets/source/limit hit.mp4', '0.2', 64],
  switching: ['assets/source/switching.mp4', '0.1', 28],
  restored: ['assets/source/restored.mp4', '0.2', 64],
  happy: ['assets/source/happy.mp4', '0.2', 64],
};

function despeckle(data, W, H) {
  const A = Buffer.from(data);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4 + 3;
      if (A[i] === 0) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const yy = y + dy,
            xx = x + dx;
          if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
          if (A[(yy * W + xx) * 4 + 3] > 40) n++;
        }
      if (n < 2) {
        data[i - 3] = 0;
        data[i - 2] = 0;
        data[i - 1] = 0;
        data[i] = 0;
      }
    }
}

fs.mkdirSync(ANIM_OUT, { recursive: true });
for (const [state, [video, ss, maxFrames]] of Object.entries(VIDEOS)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-anim-'));
  execFileSync(
    ffmpeg,
    ['-y', '-ss', ss, '-i', video,
      '-vf', 'fps=8,scale=340:-2:flags=lanczos,colorkey=0x000000:0.10:0.05',
      '-frames:v', String(maxFrames), path.join(tmp, 'f_%03d.png')],
    { stdio: 'pipe' },
  );
  const files = fs.readdirSync(tmp).filter((f) => f.startsWith('f_')).sort();
  const frames = [];
  let W = 0,
    H = 0;
  for (const f of files) {
    const { data, info } = await sharp(path.join(tmp, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    W = info.width;
    H = info.height;
    despeckle(data, W, H);
    frames.push(
      await sharp(data, { raw: { width: W, height: H, channels: 4 } }).resize(190, null).raw().toBuffer(),
    );
  }
  const tW = 190,
    tH = Math.round((H / W) * 190);
  const out = path.join(ANIM_OUT, `${state}.gif`);
  await sharp(Buffer.concat(frames), {
    raw: { width: tW, height: tH * frames.length, channels: 4, pageHeight: tH },
  })
    .gif({ loop: 0, effort: 7, delay: new Array(frames.length).fill(125) })
    .toFile(out);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(out, files.length + ' frames', Math.round(fs.statSync(out).size / 1024) + ' KB');
}

// ---- tray icons: SAME idle mascot in every state, only the GLOW changes ----
// (vision doc: "the axolotl's own body color never changes — only the glow
// around it". Two intensities per state so the tray icon can breathe.)
const GLOW = {
  happy: '#ef6f95',
  idle: '#5fbd85',
  warning: '#f0b545',
  limit: '#e8543f',
  switching: '#5aa5ee',
  restored: '#e8bd55',
};

function glowSvg(size, color, strength) {
  const r = Math.round(size * 0.48);
  const c = size / 2;
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs><radialGradient id="g"><stop offset="0%" stop-color="${color}" stop-opacity="${strength}"/>
      <stop offset="65%" stop-color="${color}" stop-opacity="${strength * 0.45}"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/></radialGradient></defs>
      <circle cx="${c}" cy="${c}" r="${r}" fill="url(#g)"/></svg>`,
  );
}

fs.mkdirSync(OUT, { recursive: true });
const mascotMaster = await sharp('assets/mascot-idle.png').png().toBuffer();
for (const [state, color] of Object.entries(GLOW)) {
  for (const [suffix, strength] of [
    ['', 0.55], // soft breath
    ['2', 0.95], // strong breath
  ]) {
    const pngs = [];
    for (const size of SIZES) {
      const body = await sharp(mascotMaster)
        .resize(Math.round(size * 0.92), Math.round(size * 0.92), {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
      const buf = await sharp({
        create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([
          { input: await sharp(glowSvg(size, color, strength)).png().toBuffer(), left: 0, top: 0 },
          { input: body, gravity: 'centre' },
        ])
        .png()
        .toBuffer();
      pngs.push({ size, buf });
    }
    const file = path.join(OUT, `${state}${suffix}.ico`);
    fs.writeFileSync(file, ico(pngs));
    console.log(file, Math.round(fs.statSync(file).size / 1024) + ' KB');
  }
}
