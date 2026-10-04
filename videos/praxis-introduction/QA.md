# PRAXIS introduction and dashboard QA

## Review ledger

| Round | Artifact | Finding | Revision |
| --- | --- | --- | --- |
| v1 | Preserved local MP4 | Robotic voice, screenshot pacing and crowded overlays | Conversational synthesized narration, real action recordings and phrase captions |
| v3 | Preserved local MP4 | The product appeared inside a small cropped panel; source detail was soft | Native 4K capture, full-canvas product chapters and approved dashboard redesign |
| v4 stills | 41 timestamped frames | Caption covered a handoff/button and a proof zoom cropped coverage labels | Empty caption regions, no local proof zoom and speech-aligned finding/coverage cuts |
| v4 corrected | 92 exact-time preview samples | Browser/runtime and geometry checks pass | Reviewed the actual encoded master next |
| v4 first encoded | Completed 4K and 1080p MP4s | Seven prior defects fixed; browser scroll still crossed a caption and closing copy was too small on phones | Cut between settled browser states; enlarge closing URL/action |
| v4 final preview | 107 exact-time samples and targeted framework check | No caption overflow; actual closing text fits at 390px viewing width | Final encoded review follows the completed render |
| v4 final encoded | Fresh independent review of both completed exports | All nine material prior issues fixed; no new material visual regression | SHIP; minor timing and listening limits documented below |

The film uses the accepted ElevenLabs Chris narration. It is synthesized speech,
not a human actor. No narration or provider review was regenerated during the
full-canvas correction. Demo fixtures, raw takes and older exports remain local.

## Product gates — 2026-10-03

- Core: 545 passing tests, seven environment skips, zero failures.
- Workbench backend: 179 passing tests, three environment skips, zero failures.
- Frontend TypeScript and production build passed.
- Frontend pressure checks: 14 states, two appearances, widths 320, 390, 768,
  1024 and 1440; zero axe violations, no escaped card/page text, eight preserved
  action contracts and no browser JavaScript errors. UI-only fixtures are marked
  synthetic and are distinct from the actual course-demo results in the film.
- Installed-package smoke: nine checks passed, including the correct/false claim
  outcomes, Ed25519 signatures, local zero-config route and historical receipts.
- Source privacy guard passed; the tarball remains 3.53 MB within its 3.55 MB
  budget. No runtime dependency was added to the core CLI.

## Film gates

- Eleven product takes contain native 3840×2160 PNG frames. A small source inside
  a larger output container is rejected. Browser zoom affects only recording.
- Recorded source fingerprints and model spend are unchanged; no source apply.
- Eleven Python helper tests and two Node assembly tests passed. Negative controls
  reject small native pixels, regressing frame timestamps, incorrect transcripts,
  invalid subtitle order, small/wrong-cadence/incomplete exports, missing or
  clipping audio, and failed assembly that would lose author media.
- Caption QA: exact 308-word script, 49 phrases, 107 seek samples; one active
  phrase, at most two lines, no caption overflow and no duplicate native media.
  Reverse seeking gives identical opening pixels. An extra active-caption
  negative control is detected and restored before any artifact is written.
- The full Hyperframes sweep passed before the last two corrections. A new check
  covers the corrected browser window and closing hold: browserSkipped=false;
  no lint, runtime, layout or contrast errors. One reviewed lint warning concerns
  the generated parent HTML length; the thirteen authored chapters remain split.
  The framework motion auditor was disabled; deterministic reverse seeking is
  checked separately, and pacing requires independent visual review.
- Closing URL/action use 64px/60px Inter, measuring 13px/12.19px at a 390px
  viewing width. Actual text fits its panel during the checked 1.5-second hold.
- Subtitle sidecar generated from the same measured caption windows.

## Scope of confidence

Browser captions use inspected vacant margins; local captions use the vacant
middle of the actual fixed footer. Geometry is checked automatically; absence
of semantic UI occlusion needs independent pixel review. ASR word timings are
estimated. The user has accepted the narration; automated loudness/decode checks
cannot substitute for listening or establish an award-winning aesthetic.

Browser inspection does not execute the submitted app. Model opinions are not
runtime proof. Local participants are browser sessions on one computer, not
authenticated remote collaborators. Provider failures and skipped checks remain
visible. Generating/copying a plan is distinct from authorizing implementation.
The npm release remains a separate manual user action.

## First v4 encoded delivery — retained for comparison

The 4K master is 3840×2160, and the distribution derivative is 1920×1080.
Both contain 3,741 frames at 30fps, 124.7 seconds of picture and 124.693 seconds
of narration. Both fully decode without errors. Measured narration is -16.43
LUFS integrated, -1.41dBTP true peak and 4.0LU range. These are actual encoded
measurements, not source-file or render-job estimates.

The master is 42,296,400 bytes; the distribution copy is 13,781,880 bytes.
The renderer reports hardware GPU capture and completed in 13m42.3s, lowering
audio by 0.8dB to respect its delivery peak ceiling. The eleven product sources
contain native 4K pixels; the old cropped HD takes are not upscaled into the master.

Independent review of this first export found the two defects recorded above.
Its MP4s remain as praxis-introduction-v4-first-4k.mp4 and
praxis-introduction-v4-first.mp4. The corrected export is recorded below.

## Corrected encoded delivery — 2026-10-04

The resumed render completed with exit code zero in 11m45.1s using hardware GPU
screenshot capture. Every packet/frame of the new master and derivative decoded
successfully. Both contain 3,741 frames at 30fps, 124.7 seconds of picture and
124.693 seconds of narration. The master is 40,943,572 bytes; the distribution
copy is 13,487,007 bytes. Narration remains -16.43 LUFS integrated, -1.41dBTP
and 4.0LU range. The accepted voice was not regenerated or changed.

A poster comes from the actual encoded opening at 3.6 seconds. The WebVTT uses
the same measured caption windows. The complete local source, private masters,
raw takes and previous exports remain intact.

The restored frontend and API both respond with HTTP 200. Both persisted demo
jobs remain complete with three recorded checks each; no implementation was
applied. The local Linux Docker engine and the cached Node 22 and Python 3.12
execution images report ready. This is service/history validation, not a fresh
test or provider review.

A fresh independent encoded review ended SHIP. It inspected 624 whole-film
samples at 0.2-second intervals, 631 dense frames across 25 transition/defect
windows, native proof crops, the 1080p derivative and closing frames at a
390-pixel viewing width. All nine material prior issues are fixed; no new
material visual regression was found. The product fills the canvas and the
closing URL/action are readable. The report and sampled pixels remain local
under capture/qa-v4/critic-final.md and capture/qa-v4/final-review/.

The activity caption precedes its cut by approximately 0.73 seconds; the
reviewer considers this brief anticipation nonblocking. Low-motion reading
holds are intentional and permitted by the walkthrough brief; the longest
measured low-difference span is 3.73 seconds. These are not claims that the
framework motion auditor passed.

The review is sampled pixel inspection and complete decode/audio measurement,
not exhaustive per-frame certification. Actual listening was unavailable because
the environment rejected audio input; subjective sound quality and exact
audiovisual sync remain unverified. The accepted voice was retained.

Reviewed master SHA256:
`dac14eb08cedf3ceca2c49a82cb43490ee5a796d0c503441589f413f00f8b734`.
