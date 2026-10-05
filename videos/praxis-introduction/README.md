# PRAXIS introduction

Video production is paused at the user's request. All sources, media, reports
and exports are saved; [VIDEO-RESUME.md](VIDEO-RESUME.md) records the exact resume
point. Prioritize PRAXIS software testing. Do not automatically render again.

The current launch cut is **53.4 seconds at 30 fps**. It shows the redesigned
local app filling the frame: choose a folder, describe its goal, inspect source,
explicitly approve host tests, see a real missing-order failure, compare a
separate correct project, and copy a review-bound brief. Source review needs no
Docker or model key. Host tests retain this computer's file/network permissions;
the filmed projects are controlled demo fixtures. Copying does not approve edits.

`index.html`, `LAUNCH-STORYBOARD.md`, `LAUNCH-SCRIPT.md`, `frame.md`, and the nine
`launch-*.html` source fragments describe this cut. The accepted longer film and
all media remain intact. Its exact root source is archived as
`archive/walkthrough.source.html.txt`, outside automatic entry-point discovery.

The narration is the natural conversational ElevenLabs Chris voice, generated
from the authored public script. All 116 words were independently checked in
nine final clips; the original decoded speech samples remain intact. Licensed
Mixkit music and actual-action click cues remain private production inputs.
Distribute the incorporated video, never standalone music or raw library media.

The current preview uses pinned HyperFrames 0.8.120. Capture and browser QA need
the Workbench Python environment with Playwright/httpx; the pure helper tests
also run in a standard-library-only Python environment:

```powershell
npx --yes hyperframes@0.8.120 preview --background
node --test scripts/assemble-launch.test.mjs scripts/assemble-film.test.mjs
python -m unittest discover -s scripts -p "test_*.py"
python scripts/qa-launch.py
```

The final browser CTA is source-only. Local execution is a separate approved
step. npm publishing remains a manual user action. Measured QA and sampled
visual review do not replace an actual listening review.

The launch browser audit checks 22 phrases over 55 actual seeks, all seven
native recordings, the final source-only CTA, repeatable reverse seeking, and a
deliberate two-caption collision. The baked track contains 111 words; the final
five spoken words appear in the closing hero instead of a duplicate caption.
While the recorded permission dialog is visible, annotations sit in the empty
right backdrop, leaving its disclosures and approval button visible. This lasts
from frame 559 through 695 (18.633333–23.2 seconds, end excluded). Before and after
that interval, local captions use the fixed footer and leave dashboard details clear.
Its WebVTT sidecar is `renders/praxis-launch.vtt`. Do not enable a second caption
overlay over the baked picture.

`scripts/fixtures/launch-caption-clock.json` is the public authoring-clock test
fixture. It includes display text and times, not raw ASR responses, review jobs,
provider credentials, media, or private provenance. Production alignment and
audio metadata remain local. Assembly tests therefore run in a clean source
checkout without uploading the local evidence used to produce the film.

The exact native export command is:

```powershell
npx --yes hyperframes@0.8.120 render --quality delivery --fps 30 --resolution landscape-4k --workers 2 --video-frame-format png --frames-cache-dir .hyperframes/extract-cache --strict --no-best-effort --output renders/praxis-launch-render-v3-4k.mp4
```

`LAUNCH-QA.md` records the delivery checks and their limits. Final incorporated
MP4s remain local; authoring sources may be pushed. The 4K narrated master,
1080p narrated copy, and 1080p music-only version use separate filenames, so no
accepted older film is replaced.

The launch recorder requires `--comparison-review <actual-local-review-id>`.
It never embeds this machine's historical review ID as a reusable default.
Use only the controlled fixture projects and an already completed comparison;
the recorder checks real API state, source preservation and zero model spend.
Voice alignment reports music as pending unless a prepared bed with a matching
hash exists. It does not fabricate missing media or a successful transcript.

## Preserved October 4 walkthrough

A 124.69-second product walkthrough, delivered in 4K and 1080p at 30 fps: an original axolotl opening,
real browser/local demonstrations and a warm branded ending. Creative choices
are in CREATIVE-DIRECTION.md. The source vault is reviewed, not replaced.

The film shows the official website, private browser source check, local input
routes, four specialists, peer review, human participation, correct/broken tests,
findings, plan handoff, source map and actual activity. The tiny order projects
are deliberately correct/broken demo fixtures. Execution and model results are
real; original project source and the shared spending budget remain unchanged.

The browser check does not execute project code. Local tests require permission
and run in Docker. People in this demonstration are local browser contributors,
not authenticated remote members. Groq/NVIDIA completed; unavailable providers
remain visible. Planning does not modify the original source. The new npm release
is still a separate manual action.

## Open and export

These are historical commands, retained for that accepted walkthrough. Restore
its archived root and `walkthrough-frame.md` in a separate copy before using
them; running them on the current launch root would export the wrong version.

```powershell
npx --yes hyperframes@0.8.114 preview --background
npx --yes hyperframes@0.8.114 check --snapshots --samples 20
npx --yes hyperframes@0.8.114 render --skill=product-launch-video --quality delivery --fps 30 --resolution landscape-4k --frames-cache-dir .hyperframes/extract-cache --output renders/praxis-introduction-4k.mp4
ffmpeg -i renders/praxis-introduction-4k.mp4 -vf scale=1920:1080:flags=lanczos -c:v libx264 -preset slow -crf 14 -c:a copy -movflags +faststart renders/praxis-introduction.mp4
```

Video, media, raw takes, transcripts, evidence, keys and memory stay local.
Generated artifacts are ignored by Git and npm. The first rejected film is
retained as renders/praxis-introduction-v1.mp4; earlier plans are in history/.
Private brand masters stay in the company asset vault and are never staged.

## Reproduce the actual recordings

Start the source Workbench with `node src/cli.js workbench --production`. The
explicit demo exercise is `apps/workbench/tools/team_smoke.py`; it uses the
existing provider adapters, a bounded budget and trusted Docker execution.
It requires working providers and Docker, and intentionally spends credits.

`scripts/record-walkthrough.py` reads the resulting local team-smoke artifact
and records actual Playwright actions against the running app and official site.
It reuses existing results and plans, performs real clipboard actions, and asserts
source/spend are unchanged. Use --full-screen for native 4K capture. Pass frame numbers for selective retakes.

`scripts/conform-recordings.py` edits inspected source windows to the measured
narration slots. It preserves raw takes, removes navigation/loading waits,
limits speed to 1.6x, and holds actual frames where needed. Recorded proof lives
in capture/recordings-v4/recording-proof.json and edit-proof.json. It never
repaints UI, changes status or invents test output. Both PASS and assertion FAIL
are expanded and checked before recording. The provider/API/clipboard assertions
fail visibly when unavailable; no fake success substitute is rendered.

## Voice, captions and brand

Narration is the conversational ElevenLabs Chris voice generated through the
connected vidIQ MCP. It is AI-synthesized speech, not a human actor or voice clone.
The approved public narration was the only content sent for voice generation.
The connected fal account had no credits and was not retried or reconfigured.

`scripts/transcribe-chunks.py` uses the existing server-side Groq key to transcribe
short overlapping narration windows. `scripts/align-narration.py` checks every
spoken word against the script, cuts at measured quiet intervals and preserves
native voice cadence. One documented ASR spelling correction, fixed→fix in
fix plan, retains its timestamp. Speech timestamps are estimated by ASR. The
308 spoken words must all be present; missing words fail the alignment gate.
`prepare-caption-meta.py` preserves this exact order when ASR onsets regress.
Seven minimal onset adjustments are logged in caption-timing-adjustments.json;
raw metadata remains unchanged. Use audio_meta_captions.json for caption building.

Eleven middle chapters are edge-to-edge native 3840×2160 recordings in a
1920×1080 composition. No smaller source is accepted inside a 4K container.
The filming browser uses zoom 3 with a native 3840×2160 viewport; this affects only
presentation. No app state, result, budget or source is repainted or fabricated.

Captions are sentence phrases in inspected empty areas. Local scenes use the
center of the actual fixed footer, x=560–1480,y=986–1074; browser shots use the
upper-right margin then the empty lower-left after the handoff cut. Brand scenes
use their lower margin. Local Inter 30–34px, at most two lines, no word bouncing,
stars, or ghost crossfades. There is no permanent chapter-title band. Font
derivatives retain their OFL licensing via scripts/prepare-fonts.mjs.

The browser chapter cuts directly from settled source selection to real results,
so the intermediate scrolling heading never crosses the caption. The closing URL
and action scale to 13px and 12.19px at a 390px viewing width; their actual text
bounds and a 1.5-second reading hold are checked before export.

Selective retakes preserve the previous output. Before conforming a retake,
preserve the old capture/recordings-v4/source-edits copy and replace its expected
filename with the new raw take. Otherwise the conformer reuses its original
source rather than the already-edited video. Action marks and voice words define
the goal, missing-check and activity cuts. Speeds stay bounded at 1.6x. Quiet
reading holds repeat real frames; no synthetic interpolation or invented motion.

`scripts/prepare-brand.py` derives silent transparent VP9 videos from the private
source vault. Playback belongs to Hyperframes, not manual script clocks.
`media.autoProxy` is off to preserve alpha. The mascot is decoration and a guide;
it does not imply an independent verifier observation. Native raw audio is muted.

The user-requested awesome-claude-video-skills repository is a reviewed local
catalogue under .tools. Selected MIT-licensed saas-motion-video and
business-motion-film skills are installed in the user's Codex skills directory.
The catalogue's SAFE grade is not an independent security audit. No community
MCP server or additional PRAXIS runtime dependency was installed.

## Assembly and QA

Use the official product-launch-video `audio.mjs sync-durations`, caption builder,
frame packets and transitions helpers. The actual voice durations own timing.
Build exactly one assigned frame per worker. `scripts/assemble-film.mjs` wraps the
official assembler and restores its input HTML even on failure. Stripped runtime templates live in the ignored
compositions/assembled directory, preventing duplicate media while preserving
reusable authoring sources. Repeated assembly must not silently lose footage.

```powershell
node scripts/assemble-film.mjs C:/Users/vaish/.agents/skills/product-launch-video/scripts/assemble-index.mjs
node scripts/apply-camera.mjs
node scripts/label-captions.mjs
```

Run the complete browser check, inspect chapter midpoints and both sides of cuts,
then review rendered pixels independently. Retain a QA ledger distinguishing
measured checks, sampled visuals and the limits of listening. Deliberate holds
let viewers read test output; don't add perpetual motion to satisfy an ad's
arbitrary animation quota. Actual final duration and decode health come from
ffprobe/ffmpeg, not estimates.

Legacy SAPI/slideshow helpers remain for historical reproducibility only. Do not
run them for the current film: they recreate the voice/style the user rejected.

## Validation commands

Use the Workbench Python environment when system Python lacks Playwright:

```powershell
node --test scripts/assemble-film.test.mjs
python -m unittest discover -s scripts -p "test_*.py"
python scripts/qa-video.py
python scripts/qa-encoded.py renders/praxis-introduction-4k.mp4 --resolution 3840x2160 --output capture/qa-v4/encoded-final-4k.json
python scripts/qa-encoded.py renders/praxis-introduction.mp4 --resolution 1920x1080 --output capture/qa-v4/encoded-final-1080p.json
```

Helper tests cover native-size rejection, regressing timestamps, caption onset
correction, subtitle order, encoded-delivery rejection and assembly restoration.
Browser QA checks 308 words,
49 phrases, 107 seek samples, one active caption, native media, safe-region bounds, reverse seeking
and an overlap negative control. It exports renders/praxis-introduction.vtt.

The MP4 has baked captions; the WebVTT is a separate accessible sidecar. Avoid
enabling a second overlay over the baked captions. Source-only authoring files
may be pushed; outputs, raw media and evidence remain local. The public npm
release is still a separate manual user action. QA.md distinguishes measurements,
sampled independent visual review and listening limitations.
