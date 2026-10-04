import { readFileSync } from 'node:fs';
const audio = JSON.parse(readFileSync(new URL('../audio_meta.json', import.meta.url), 'utf8'));
let cursor = 0;
const midpoints = [], seams = [], starts = [];
for (const voice of audio.voices) {
  starts.push({ frame: voice.frame, start: Number(cursor.toFixed(3)), duration: voice.duration_s });
  midpoints.push((cursor + voice.duration_s / 2).toFixed(3));
  if (cursor > 0) seams.push((cursor - .1).toFixed(3), (cursor + .2).toFixed(3));
  cursor += voice.duration_s;
}
console.log(JSON.stringify({ duration: Number(cursor.toFixed(3)), midpoints: midpoints.join(','), seams: seams.join(','), starts }, null, 2));
