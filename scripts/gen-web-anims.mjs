// Regenerate web/_assets/flow.webp — the landing page's tray-companion demo.
// Each state segment is its FULL source loop (seam measured from frame diffs),
// played at 1.5x (delay = 1000 / (fps * 1.5)), with a short hold on each
// state's last frame so the cut to the next state reads as intentional.
// Chroma pipeline mirrors gen-tray-icons.mjs: colorkey → despeckle → sharp
// toilet-roll webp (never ffmpeg's own anim-webp muxer — dispose ghosting).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';

const W = 412, H = 316; // panel display size; source 3840x2160 center-cropped to this aspect
const CROP = '2816:2160';
const HOLD_EXTRA = 400; // ms added to each segment's last frame

// [video, seek, duration(s) = one full loop at 1x, fps, repeats]
const SEGMENTS = [
  ['idle', 'assets/source/idle.mp4', 0.2, 7.6, 5, 1],
  ['warning', 'assets/source/warning.mp4', 0.2, 6.75, 5, 1],
  ['limit', 'assets/source/limit hit.mp4', 0.2, 9.8, 5, 1],
  ['switching', 'assets/source/switching.mp4', 0.1, 3.6, 5, 1],
  ['restored', 'assets/source/restored.mp4', 0.2, 9.8, 5, 1],
];

function despeckle(data, w, h) {
  const A = Buffer.from(data);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4 + 3;
      if (A[i] === 0) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
          if (A[(yy * w + xx) * 4 + 3] > 40) n++;
        }
      if (n < 2) { data[i - 3] = 0; data[i - 2] = 0; data[i - 1] = 0; data[i] = 0; }
    }
}

const frames = [];
const delays = [];
for (const [state, video, ss, dur, fps, repeats] of SEGMENTS) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-flow-'));
  execFileSync(ffmpeg, [
    '-ss', String(ss), '-t', String(dur), '-i', video,
    '-vf', `fps=${fps},crop=${CROP},scale=${W}:${H}:flags=lanczos,colorkey=0x000000:0.10:0.05`,
    path.join(tmp, 'f_%03d.png'),
  ], { stdio: 'ignore' });
  const files = fs.readdirSync(tmp).sort();
  const segFrames = [];
  for (const f of files) {
    const buf = await sharp(path.join(tmp, f)).ensureAlpha().raw().toBuffer();
    despeckle(buf, W, H);
    segFrames.push(buf);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const delay = Math.round(1000 / (fps * 1.5));
  for (let r = 0; r < repeats; r++)
    for (let i = 0; i < segFrames.length; i++) {
      frames.push(segFrames[i]);
      const last = r === repeats - 1 && i === segFrames.length - 1;
      delays.push(last ? delay + HOLD_EXTRA : delay);
    }
  console.log(`${state}: ${segFrames.length} frames x${repeats} @ ${delay}ms (${(dur / 1.5).toFixed(1)}s per loop at 1.5x)`);
}

await sharp(Buffer.concat(frames), {
  raw: { width: W, height: H * frames.length, channels: 4, pageHeight: H },
})
  .webp({ loop: 0, effort: 4, quality: 72, delay: delays })
  .toFile('web/_assets/flow.webp');

const total = delays.reduce((a, b) => a + b, 0);
console.log(`flow.webp: ${frames.length} frames, ${(total / 1000).toFixed(1)}s cycle, ${Math.round(fs.statSync('web/_assets/flow.webp').size / 1024)} KB`);
