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
// The storyboard, since the demo was inverted to lead with proof (D3):
//   0-3s    one command typed
//   3-11s   the receipt is sealed, verified, and handed over — the visual peak
//   11-45s  the replay plays: what that receipt is a receipt OF
//   45-50s  "verify it yourself" again, and the tagline
//
// Two artifacts, per D96/D100:
//   docs/demo.gif  the PROOF segment only — seal to the start of the story,
//                  looping from the seal frame so a scroller meets proof at
//                  frame zero. Self-contained. <=720px wide, <=3MB.
//   docs/demo.mp4  the whole thing, story included, for when compression would
//                  cost legibility.
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
import { frameSvg, castFrames, typingFrames, proofSegment, segmentRows, rowsHeight, frameWith, W } from './lib/termframe.mjs';

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
      env: {
        ...process.env,
        PRAXIS_RICH: '1',
        PRAXIS_DEMO_SPEED: speed,
        NO_COLOR: '',
        // The recording opens with `npx praxis-memory demo` being typed, so the
        // command it then tells the viewer to run has to be in the same form.
        // This machine has a global `praxis` shim; most viewers do not.
        PRAXIS_CMD: 'npx praxis-memory',
      },
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

async function raster(frames, rows) {
  const out = [];
  for (const f of frames) {
    out.push(await sharp(Buffer.from(frameSvg(f.lines, rows))).ensureAlpha().raw().toBuffer());
  }
  return out;
}

async function writeGif(frames, file, rows) {
  const h = rowsHeight(rows);
  const bufs = await raster(frames, rows);
  await sharp(Buffer.concat(bufs), { raw: { width: W, height: h * bufs.length, channels: 4, pageHeight: h } })
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
  const { start: seal, end: storyAt } = proofSegment(all);
  if (storyAt >= all.length) {
    console.warn('  ⚠ no REPLAY header found — the GIF will run to the end of the recording');
  }

  // Holds, placed on the three beats a viewer actually needs time for. These are
  // the only invented timings in the file, and they lengthen pauses rather than
  // reordering anything.
  const verified = frameWith(all, /VERIFIED\s+chain intact/);
  const command = frameWith(all, /receipt verify /);
  all[seal].delay = Math.max(all[seal].delay, 1500); // the receipt exists
  if (verified !== -1) all[verified].delay = Math.max(all[verified].delay, 2000); // …and it checks out
  if (command !== -1) all[command].delay = Math.max(all[command].delay, 1800); // the thing to type
  // The loop's resting frame: the completed proof block, held before it cuts
  // back to the seal. In the mp4 this same hold is the pause before the story.
  all[storyAt - 1].delay = Math.max(all[storyAt - 1].delay, 2600);
  all[all.length - 1].delay = 3200; // rest on the ending before the mp4 stops

  const total = all.reduce((a, f) => a + f.delay, 0);
  console.log(`  ${all.length} frames · ${(total / 1000).toFixed(1)}s · seal at frame ${seal} (${(all.slice(0, seal).reduce((a, f) => a + f.delay, 0) / 1000).toFixed(1)}s)`);

  const gifFrames = all.slice(seal, storyAt);
  const gifRows = segmentRows(gifFrames);
  const gifMs = gifFrames.reduce((a, f) => a + f.delay, 0);
  const gifPath = path.join(OUT, 'demo.gif');
  const gifSize = await writeGif(gifFrames, gifPath, gifRows);
  console.log(
    `  docs/demo.gif   ${gifFrames.length} frames · ${(gifMs / 1000).toFixed(1)}s loop · ${W}x${rowsHeight(gifRows)} · ${mb(gifSize)}` +
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
