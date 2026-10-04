// LEGACY V1 ONLY: rejected slideshow styling; see README.md for the current film.
// Add VO-paced shot plans after the official duration-sync pass. No duration edits.
import { readFileSync, writeFileSync } from 'node:fs';
const file = new URL('../STORYBOARD.md', import.meta.url);
const audio = JSON.parse(readFileSync(new URL('../audio_meta.json', import.meta.url), 'utf8'));
if (audio.voices?.length !== 13) throw new Error('All thirteen real narration lines are required');
const clean = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const plans = [
  { focal: 'Oversized question', roles: 'typography = foreground', adapt: 'Keep the fixed center and two phrase beats; use restrained masked reveals and a still question instead of playful overshoot.', scenes: [
    [null, 0, 'Warm base ground; the display phrase “Built with AI” enters via per-word staggered reveal (`dynamic-content-sequencing`), centered and field-claiming. A quiet mono chapter label sits above it; no capture or decorative substitute.'],
    ['But', .45, 'The phrase replaces in place with “Does it work?” via `discrete-text-sequence`. The final question mark receives the sole coral emphasis. Hold this large question, with the lower caption band clear.'],
  ]},
  { focal: 'assets/website-hero.png', roles: 'website-hero = foreground', scenes: [
    [null, 0, 'The real website capture establishes with a smooth element-level rise (`gsap-effects`); asymmetric 70/30 layout, large crop of the actual hero beside the display title “PRAXIS”. Background, hairline capture matte, and type form three layers.'],
    ['Start', .52, 'A second line “Final engineering check” reveals on its cue (`dynamic-content-sequencing`); the capture remains still and unaltered.'],
    ['choose', .77, 'Reveal “Test Your Project” as an editorial action annotation (`gsap-effects`), associated with the actual captured entry point. Show the verified domain as a mono label. No invented cursor or click.'],
  ]},
  { focal: 'assets/browser-findings.png', roles: 'browser-intake = foreground state 1; browser-findings = foreground state 2; browser-handoff = foreground state 3', adapt: 'Keep one held surface and a real flow through discrete captured states. Replace device chrome with a plain clipped screenshot matte, avoid simulated clicks, and keep the camera locked.', scenes: [
    [null, 0, 'The held screenshot surface establishes with the actual browser-intake crop (`gsap-effects`), full-width below “Try before you install”; focus the selected-folder card, not the page navigation.'],
    ['shows', .32, 'Advance the same surface laterally to browser-findings via `3d-page-scroll` translateX; clip intentional offscreen travel and mark the moving layer. Reveal a short “Source findings” side label (`discrete-text-sequence`).'],
    ['builds', .52, 'Advance laterally to browser-handoff within the same matte; frame the actual Copy agent prompt and its copied state. The preceding image clears within the seam; never stack all three screens.'],
    ['No', .72, 'Reveal three plain scope labels in sequence (`dynamic-content-sequencing`): “On-device source”, “No API key”, “Tests not run”. Hold the real handoff crop for reading.'],
  ]},
  { focal: 'assets/setup-transcript.png', roles: 'setup-transcript = foreground', scenes: [
    [null, 0, 'Actual setup-transcript screenshot establishes at large scale (`gsap-effects`), asymmetric 70/30 with “Run locally” display title. Crop around the recorded runtime stages so output is legible; no fabricated terminal shell.'],
    ['prepared', .35, 'Reveal the compact line “Managed Python · production interface” (`dynamic-content-sequencing`) beside the actual successful output. Preserve the transcript’s source-checkout and cache-reuse labels.'],
    ['public', .71, 'A restrained coral-edge annotation “Public release pending” enters (`gsap-effects`). Keep the actual command readable and the caveat above the caption band; hold still.'],
  ]},
  { focal: 'assets/local-intake.png', roles: 'local-intake = foreground', scenes: [
    [null, 0, 'The actual local-intake surface establishes (`gsap-effects`) with a wide crop of the input routes beneath “One review, your project”. No fabricated project data; keep original captured pixels.'],
    ['Set', .32, 'Reveal “Goal + spending limit” (`dynamic-content-sequencing`); the surface seats toward the captured goal/budget region with one short focus reposition (`coordinate-target-zoom`), then locks.'],
    ['only', .62, 'Reveal “Explicit trust” and then “Isolated Docker copy” on their spoken cues (`dynamic-content-sequencing`). A hairline editorial callout frames the trust region without repainting the app.'],
  ]},
  { focal: 'assets/ai-team.png', roles: 'ai-team = foreground state 1; peer-evidence = foreground state 2', scenes: [
    [null, 0, 'The real specialist board establishes full-width (`gsap-effects`) beneath “Four roles. One snapshot.” The 4-column capture is the dominant element, with a plain warm ground and matte.'],
    ['share', .42, 'Reveal the mono annotation “One shared spending budget” (`dynamic-content-sequencing`) above the surface; retain the real partial statuses.'],
    ['exchange', .62, 'The board and peer-evidence capture perform a lateral velocity-matched replacement inside the same matte (`3d-page-scroll` translateX, cut-catalog); focus the actual source comments. Reveal “Peer challenge” as a concise tag and hold for reading.'],
  ]},
  { focal: 'assets/ai-team.png', roles: 'ai-team = foreground', scenes: [
    [null, 0, 'Actual partial specialist board establishes (`gsap-effects`); asymmetric 60/40 with a large source capture and an editorial status column. Header “A partial review stays partial” appears in two paced pieces, not as a dumped list.'],
    ['Groq', .25, 'Reveal the factual completion label “Groq + NVIDIA / completed” (`dynamic-content-sequencing`), warm green from frame.md; keep the underlying actual cards visible.'],
    ['OpenRouter', .5, 'Reveal “OpenRouter / no credit” (`dynamic-content-sequencing`), using the ordinary ink and coral-edge caution rather than a fake successful provider card.'],
    ['Gemini', .64, 'Reveal “Gemini / rate limit” and then “No invented result” on the final cue (`dynamic-content-sequencing`). Hold this frame as a deliberate breather for the visible limits.'],
  ]},
  { focal: 'assets/people-workspace.png', roles: 'people-workspace = foreground', scenes: [
    [null, 0, 'The actual two-contributor workspace establishes (`gsap-effects`), broad surface below “People + agents”; crop the discussion and contributor labels, not the footer.'],
    ['Share', .4, 'Reveal the short annotation “Team context or one specialist” (`dynamic-content-sequencing`) alongside the real sharing control and addressed contribution. The source surface remains still.'],
    ['Private', .65, 'Reveal “Private notes: not sent to models” (`gsap-effects`). A separate mono scope line “Two local browser sessions · no remote invitations yet” arrives in the back half and holds above captions.'],
  ]},
  { focal: 'assets/failed-tests.png', roles: 'passed-tests = foreground state 1; failed-tests = foreground state 2', scenes: [
    [null, 0, 'Show the actual passed-tests crop (`gsap-effects`) as the dominant full-width surface. A display title “Test the side effect” and small “Deliberately correct fixture” label establish the controlled comparison.'],
    ['passes', .21, 'Reveal “SQLite persistence + input validation / passed” (`dynamic-content-sequencing`), based on the real execution. Hold the actual green test result; do not invent a production-readiness pass.'],
    ['false', .4, 'Replace the surface with failed-tests in a lateral velocity-matched seam (`3d-page-scroll`, cut-catalog). Reveal “Deliberately broken fixture” and focus the actual failing assertions for no stored row.'],
    ['fail', .7, 'Reveal “Success response ≠ database write” then “Executed tests failed” (`dynamic-content-sequencing`). The independent result holds still; models cannot vote it green.'],
  ]},
  { focal: 'assets/source-finding.png', roles: 'source-finding = foreground state 1; local-overview = foreground state 2', scenes: [
    [null, 0, 'The actual source finding establishes (`gsap-effects`) beside the compact display title “From failure to a decision”; focus the observed source and human-readable impact. Asymmetric 60/40, three layers.'],
    ['recorded', .4, 'Reveal “Observed source · why it matters · next step” (`dynamic-content-sequencing`) as one editorial line, without transcribing the full app wall of text.'],
    ['Missing', .56, 'A lateral replacement (`3d-page-scroll`, cut-catalog) seats local-overview at large scale. Reveal “Release blocked: gaps remain” and hold the actual readiness blockers. No overall pass is invented.'],
  ]},
  { focal: 'assets/fix-plan.png', roles: 'fix-plan = foreground state 1; fix-handoff = foreground state 2', adapt: 'Keep the persistent surface and sequential real flow. Use clipped recorded plan details followed by its actual handoff state; do not reconstruct UI, simulate approval, or add device chrome.', scenes: [
    [null, 0, 'The actual fix-plan surface establishes (`gsap-effects`) below “Plan first”; use a large top-section crop with original files and recorded plan stages visible. A source label states “Real provider-drafted plan”.'],
    ['Review', .22, 'Content scrolls inside the surface (`3d-page-scroll`) to show validation and risk entries; clip only intentional image overflow. Reveal concise “Files · checks · risks” on its narration cue. Scroll completes before the next phase.'],
    ['Copy', .43, 'Advance laterally to the actual fix-handoff crop inside the same matte (`3d-page-scroll` translateX). Reveal “Use the coding agent you already have” (`dynamic-content-sequencing`); never animate a fake connected-model approval.'],
    ['Original', .78, 'Reveal “Copied brief · original source unchanged” on the last cue (`dynamic-content-sequencing`). Hold the captured handoff with the explicit no-implementation state visible.'],
  ]},
  { focal: 'assets/source-map.png', roles: 'source-map = foreground state 1; recorded-activity = foreground state 2', scenes: [
    [null, 0, 'The actual source-map surface establishes (`gsap-effects`) in a wide strip below “Inspect the context”; label it “Static imports” so it cannot imply runtime traces.'],
    ['activity', .46, 'A lateral velocity-matched swap (`3d-page-scroll`, cut-catalog) reveals the actual recorded-activity crop. Label it “Recorded backend activity” (`discrete-text-sequence`), not a fictional live knowledge graph.'],
    ['limits', .84, 'Reveal “Recorded facts, visible limits” (`gsap-effects`) and hold the actual activity timeline for the closing transition.'],
  ]},
  { focal: 'assets/praxis-mark.png', roles: 'praxis-mark = foreground brand mark', adapt: 'Keep the fixed centered phrase relay and a final mark/URL hold. Use quiet, smooth phrase reveals; no drifting particles, invented icons, or playful kinetic gags.', scenes: [
    [null, 0, 'The centered display beat “People. Agents. Teams.” reveals phrase by phrase (`dynamic-content-sequencing`) over the flat warm ground, occupying the primary content field.'],
    ['One', .23, 'The phrase replaces in place (`discrete-text-sequence`) with “One project.”, paired with “Evidence you can inspect” as smaller lead text. Keep the lower caption band clear.'],
    ['Try', .53, 'The existing public praxis-mark seats above the final wordmark with a smooth single scale settle (`gsap-effects`); the final domain “praxis-six-xi.vercel.app” builds as one mono label. Reveal “Try the browser check” as the sole coral callout.'],
    ['local', .77, 'Add the restrained line “Local workspace for the deeper review” (`dynamic-content-sequencing`); hold the final lockup dead still through the end.'],
  ]},
];
let storyboard = readFileSync(file, 'utf8').replace('- asset_candidates: intentionally typography-only', '- asset_candidates:');
const frameStart = storyboard.indexOf('## Frame 1');
let prefix = storyboard.slice(0, frameStart);
if (!prefix.includes('## Video direction')) prefix += `## Video direction\n\nPalette and type: frame.md is normative. Warm dark ground (cream), ink headings, tile mattes, restrained coral emphasis; actual captured UI colors are preserved. Body labels use Inter, display uses EB Garamond, metadata uses JetBrains Mono, all renderer-bundled. Never duplicate narration as a paragraph.\n\nMotion: one paused, seek-safe GSAP timeline per frame. Smooth long-tail entrances; reveal successive content on spoken cues across the whole frame. Still camera after short focus moves. No perpetual breathing, clocks, random particles, back-half drift, CSS animations, or fabricated cursors.\n\nRhythm: frames 7 and 9 hold their real availability/test results as deliberate reading breathers after successive cue reveals. Other frames develop through actual captured states. Each frame boundary is a deliberate replacement crossfade; no continuing-element handoff is promised.\n\nComposition: primary capture or typography occupies at least 40% of canvas, in the top 83%; captions own y=880–1080. Use at least three clear layers (ground, matte, capture/type), vary wide and asymmetric layouts, and preserve readable crops. Screens are actual recorded results, not reconstructed app mockups. Annotations summarize those recorded facts. Avoid screenshots of navigation/footer unless inseparable from the captured evidence.\n\nNegative list: no fake provider success, remote invitations, published npm release, automatic source edits, receipt claims, financial hype, 3D decoration, stock imagery, off-brand gradients, front-loaded slideshow dumps, or independently floating screensaver elements.\n\n`;
const blocks = storyboard.slice(frameStart).split(/(?=^## Frame \d+ —)/m);
if (blocks.length !== 13) throw new Error('Expected thirteen frame sections');
const updated = blocks.map((block, index) => {
  const plan = plans[index];
  const voice = audio.voices.find(item => item.frame === index + 1);
  const duration = Number(block.match(/- duration: ([\d.]+)s/)[1]);
  if (duration < voice.duration_s) throw new Error(`Duration not synced: frame ${index + 1}`);
  block = block.split('\n<!-- shot-design:start -->')[0].trimEnd();
  if ([2, 10].includes(index)) block = block.replace('- blueprint: device-surface-showcase', '- blueprint: compose');
  if (index === 12) block = block.replace('- blueprint: kinetic-type-beats', '- blueprint: compose');
  const starts = plan.scenes.map(([cue, fraction], sceneIndex) => {
    if (sceneIndex === 0) return 0;
    const match = cue && voice.words.find(word => clean(word.text) === clean(cue));
    return Number((match ? match.start : duration * fraction).toFixed(2));
  });
  for (let i = 1; i < starts.length; i++) if (starts[i] <= starts[i - 1]) starts[i] = Number((duration * plan.scenes[i][1]).toFixed(2));
  const scenes = plan.scenes.map(([, , text], i) => `Scene ${i + 1} (${starts[i].toFixed(2)}–${(starts[i + 1] ?? duration).toFixed(2)}s): ${text}`).join('\n\n');
  const assets = [...block.matchAll(/assets\/([\w-]+\.png)/g)].map(match => match[1]);
  const geometry = assets.map(name => {
    const bytes = readFileSync(new URL(`../assets/${name}`, import.meta.url));
    return `${name}: ${bytes.readUInt32BE(16)}×${bytes.readUInt32BE(20)}`;
  }).join('; ');
  const choice = block.includes('- blueprint: compose') ? 'Compose' : 'Adapt';
  return `${block}\n\n<!-- shot-design:start -->\n- focal: ${plan.focal}\n- roles: ${plan.roles}\n- sfx: none\n- capture_geometry: ${geometry || 'no image asset'}\n\n${plan.adapt ? `${choice}: ${plan.adapt}\n\n` : ''}${scenes}\n<!-- shot-design:end -->\n`;
});
writeFileSync(file, prefix + updated.join('\n'), 'utf8');
console.log('Thirteen shot plans paced to real voice durations and available word cues.');
