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

fs.mkdirSync(OUT, { recursive: true });
for (const [state, src] of Object.entries(SOURCES)) {
  const base = Array.isArray(src) ? sharp(src[0], { page: src[1] }) : sharp(src);
  const master = await base.png().toBuffer();
  const pngs = [];
  for (const size of SIZES) {
    const buf = await sharp(master)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    pngs.push({ size, buf });
  }
  const file = path.join(OUT, `${state}.ico`);
  fs.writeFileSync(file, ico(pngs));
  console.log(file, Math.round(fs.statSync(file).size / 1024) + ' KB');
}
