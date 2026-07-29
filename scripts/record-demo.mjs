#!/usr/bin/env node
// B5 — the launch recording. `node scripts/record-demo.mjs`
//
// Records the REAL `praxis demo`: it spawns the actual CLI, captures the actual
// bytes it writes and the actual milliseconds between them, and renders those
// into frames. Nothing here is hand-authored. There is no mock screen, no
// retouched line, no way to type a nicer output into this file — if the demo
// regresses, the recording regresses with it, which is the only property that
// makes a launch asset worth trusting.
//
// The storyboard is fixed by the launch spec (D96):
//   0-4s    one command typed
//   4-18s   the replay plays, real output, condensed pacing
//   18-26s  the seal + verdict beat — the visual peak, brief hold
//   26-30s  "verify it yourself" and the tagline
//
// Two artifacts, per D96/D100:
//   docs/demo.gif  the 18-30s segment, LOOPING FROM THE SEAL FRAME so a
//                  scroller meets proof first. <=720px wide, <=3MB.
//   docs/demo.mp4  the whole thing, for when compression would cost legibility.
//
// Design constraints it enforces rather than assumes: the terminal palette is
// the SHIPPED ui.js palette (D99), the frame is sized so the type is legible at
// 360px phone width (D100), and the window has no chrome, no zooms, no cursor
// theatrics (D96's anti-slop list).

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import { frameSvg, castFrames, typingFrames, sealIndex, frameWith, W, H } from './lib/termframe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs');

// ── capture ──────────────────────────────────────────────────────────────────

/**
 * Run the real command and return [{ t, text }] — the accumulated screen at
 * every moment it changed. PRAXIS_RICH forces colour without a TTY, which is
 * the only concession made to being recorded.
 */
function capture({ speed = '0.62' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'src', 'cli.js'), 'demo'], {
      cwd: ROOT,
      env: { ...process.env, PRAXIS_RICH: '1', PRAXIS_DEMO_SPEED: speed, NO_COLOR: '' },
    });
    const t0 = Date.now();
    const events = [];
    let acc = '';
    child.stdout.on('data', (d) => {
      acc += d.toString();
      events.push({ t: Date.now() - t0, text: acc });
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`demo exited ${code}`));
      if (!events.length) return reject(new Error('the demo produced no output to record'));
      resolve(events);
    });
  });
}


// ── render ───────────────────────────────────────────────────────────────────

async function raster(frames) {
  const out = [];
  for (const f of frames) {
    out.push(await sharp(Buffer.from(frameSvg(f.lines))).ensureAlpha().raw().toBuffer());
  }
  return out;
}

async function writeGif(frames, file) {
  const bufs = await raster(frames);
  await sharp(Buffer.concat(bufs), { raw: { width: W, height: H * bufs.length, channels: 4, pageHeight: H } })
    .gif({ loop: 0, effort: 10, delay: frames.map((f) => f.delay), colours: 64, dither: 0 })
    .toFile(file);
  return fs.statSync(file).size;
}

async function writeMp4(frames, file) {
  if (!ffmpeg) return null;
  const tmp = fs.mkdtempSync(path.join(ROOT, '.record-'));
  try {
    // A concat list with per-frame durations keeps the mp4 on the same beats as
    // the GIF instead of resampling the pacing into something else.
    const list = [];
    for (let i = 0; i < frames.length; i++) {
      const p = path.join(tmp, `f${String(i).padStart(4, '0')}.png`);
      await sharp(Buffer.from(frameSvg(frames[i].lines))).png().toFile(p);
      list.push(`file '${p.replace(/\\/g, '/')}'`, `duration ${(frames[i].delay / 1000).toFixed(3)}`);
    }
    list.push(`file '${path.join(tmp, `f${String(frames.length - 1).padStart(4, '0')}.png`).replace(/\\/g, '/')}'`);
    const listFile = path.join(tmp, 'list.txt');
    fs.writeFileSync(listFile, list.join('\n'));
    const r = spawnSync(
      ffmpeg,
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', 'fps=25,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '20', '-movflags', '+faststart', file],
      { encoding: 'utf8', timeout: 240000 },
    );
    if (r.status !== 0) throw new Error('ffmpeg failed: ' + String(r.stderr).slice(-400));
    return fs.statSync(file).size;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const mb = (n) => (n / 1024 / 1024).toFixed(2) + 'MB';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('recording the real demo …');
  const events = await capture();

  const cast = castFrames(events);
  const all = [...typingFrames('npx praxis-memory demo'), ...cast];
  const seal = sealIndex(all);

  // Holds, placed on the three beats a viewer actually needs time for. The
  // loop was 5.5s on its first cut — true to the content but well short of the
  // ~12s segment the spec asks for, and short enough that the eye never settles
  // on the resting frame. These are the only invented timings in the file, and
  // they lengthen pauses rather than reordering anything.
  const verified = frameWith(all, /VERIFIED\s+chain intact/);
  const command = frameWith(all, /receipt verify /);
  all[seal].delay = Math.max(all[seal].delay, 1500); // the receipt exists
  if (verified !== -1) all[verified].delay = Math.max(all[verified].delay, 2000); // …and it checks out
  if (command !== -1) all[command].delay = Math.max(all[command].delay, 1800); // the thing to type
  all[all.length - 1].delay = 3200; // rest on the whole story before looping

  const total = all.reduce((a, f) => a + f.delay, 0);
  console.log(`  ${all.length} frames · ${(total / 1000).toFixed(1)}s · seal at frame ${seal} (${(all.slice(0, seal).reduce((a, f) => a + f.delay, 0) / 1000).toFixed(1)}s)`);

  const gifFrames = all.slice(seal);
  const gifMs = gifFrames.reduce((a, f) => a + f.delay, 0);
  const gifPath = path.join(OUT, 'demo.gif');
  const gifSize = await writeGif(gifFrames, gifPath);
  console.log(
    `  docs/demo.gif   ${gifFrames.length} frames · ${(gifMs / 1000).toFixed(1)}s loop · ${W}x${H} · ${mb(gifSize)}` +
      (gifSize > 3 * 1024 * 1024 ? '  ⚠ OVER the 3MB budget' : '  (budget 3MB)'),
  );

  const mp4Path = path.join(OUT, 'demo.mp4');
  const mp4Size = await writeMp4(all, mp4Path);
  if (mp4Size) console.log(`  docs/demo.mp4   ${all.length} frames · ${mb(mp4Size)}`);

  if (W > 720) throw new Error(`frame is ${W}px wide — the spec caps it at 720`);
  if (gifSize > 3 * 1024 * 1024) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith('record-demo.mjs')) {
  main().catch((e) => {
    console.error('record-demo failed:', e.message);
    process.exit(1);
  });
}
