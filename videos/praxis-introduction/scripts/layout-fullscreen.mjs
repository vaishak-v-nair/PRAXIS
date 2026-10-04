// Apply the reviewed full-screen framing to existing, real product chapters.
// Brand frames remain individually authored. Native recordings and narration
// are never synthesized or changed by this authoring utility.
import { readFileSync, writeFileSync } from 'node:fs';
const project = new URL('../', import.meta.url);
const scenes = JSON.parse(readFileSync(new URL('revision-scenes.json', project), 'utf8'));
const voices = JSON.parse(readFileSync(new URL('audio_meta.json', project), 'utf8')).voices;
for (const scene of scenes.filter(s => s.frame > 1 && s.frame < 13)) {
  const id = String(scene.frame).padStart(2, '0');
  const duration = voices.find(v => v.frame === scene.frame)?.duration_s;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Missing actual narration duration ${id}`);
  const source = `assets/recordings-v4/${id}-${scene.slug}.mp4`;
  const frame = `<template>
  <style>
    #root { position:relative; width:100%; height:100%; overflow:hidden; container-type:size; }
    .f${id}-background { position:absolute; inset:0; background:#0B0F17; }
    #f${id}-recording { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; }
  </style>
  <div id="root" data-composition-id="${id}-${scene.slug}" data-width="1920" data-height="1080">
    <div id="f${id}-background" class="clip f${id}-background" data-start="0" data-duration="${duration}" data-track-index="0"></div>
    <video id="f${id}-recording" class="clip" src="${source}" data-frame-video="approved"
      data-start="0" data-duration="${duration}" data-track-index="1"
      data-frame-video-x="0" data-frame-video-y="0" data-frame-video-width="1920"
      data-frame-video-height="1080" data-frame-video-fit="contain" muted playsinline></video>
  </div>
  <script>
    (() => {
      const tl = gsap.timeline({paused:true});
      tl.to({progress:0},{progress:1,duration:${duration},ease:'none'},0);
      window.__timelines=window.__timelines||{};
      window.__timelines['${id}-${scene.slug}']=tl;
    })();
  </script>
</template>
`;
  writeFileSync(new URL(`compositions/frames/${id}-${scene.slug}.html`, project), frame);
}
console.log(`Eleven real product chapters fill 1920x1080; reusable voice and brand sources preserved.`);
