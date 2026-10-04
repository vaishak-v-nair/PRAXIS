// The host owns hoisted media. Author deterministic camera transforms here,
// rather than trying to animate host media from a sub-composition timeline.
import { readFileSync, writeFileSync } from 'node:fs';
const project = new URL('../', import.meta.url);
const file = new URL('index.html', project);
let html = readFileSync(file, 'utf8');
if (html.includes('id="full-screen-camera"')) throw new Error('Assemble a clean host before applying camera motion.');
const voices = JSON.parse(readFileSync(new URL('audio_meta.json', project), 'utf8')).voices;
const plan = JSON.parse(readFileSync(new URL('camera-plan.json', project), 'utf8'));
let cursor = 0;
const cues = [];
for (const voice of voices) {
  const camera = plan.find(c => c.frame === voice.frame);
  if (camera) {
    if (!(camera.start >= 0 && camera.end > camera.start && camera.end <= voice.duration_s && camera.scale >= 1 && camera.scale <= 1.08)) {
      throw new Error(`Invalid bounded camera cue ${voice.frame}`);
    }
    const id = `f${String(voice.frame).padStart(2,'0')}-recording`;
    if (!html.includes(`id="${id}"`)) throw new Error(`Missing real media ${id}`);
    cues.push({ ...camera, id, time:cursor+camera.start, duration:camera.end-camera.start });
  }
  cursor += voice.duration_s;
}
const script = `<script id="full-screen-camera">
(() => {
  const tl=window.__timelines.main;
  if(!tl)throw new Error('Host timeline required for camera motion');
  const cues=${JSON.stringify(cues)};
  for(const cue of cues){
    const video=document.getElementById(cue.id);
    tl.fromTo(video,{scale:1,transformOrigin:cue.origin},
      {scale:cue.scale,transformOrigin:cue.origin,duration:cue.duration,ease:'power2.inOut',immediateRender:false},cue.time);
  }
})();
</script>\n`;
if (!html.includes('</body>')) throw new Error('Expected a complete assembled HTML document');
html = html.replace('</body>', script+'</body>');
writeFileSync(file, html);
console.log(`${cues.length} restrained camera moves authored on the host timeline.`);
