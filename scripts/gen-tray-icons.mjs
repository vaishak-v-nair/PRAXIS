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
const ANIM_OUT = 'src/tray/anim';
const SEGMENTS = {
  idle: ['assets/tray/flow-alpha.webp', 0, 14],
  warning: ['assets/tray/flow-alpha.webp', 14, 14],
  limit: ['assets/tray/flow-alpha.webp', 28, 14],
  switching: ['assets/tray/flow-alpha.webp', 42, 14],
  restored: ['assets/tray/flow-alpha.webp', 56, 14],
  happy: ['assets/tray/happy-alpha.webp', 0, 30],
};
fs.mkdirSync(ANIM_OUT, { recursive: true });
for (const [state, [file, page, pages]] of Object.entries(SEGMENTS)) {
  const out = path.join(ANIM_OUT, `${state}.gif`);
  await sharp(file, { page, pages, animated: true })
    .resize(170, null)
    .gif({ loop: 0, effort: 7 })
    .toFile(out);
  console.log(out, Math.round(fs.statSync(out).size / 1024) + ' KB');
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
