"""Record the requested editorial revision without losing the first cut's plans."""
import json
import shutil
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
LINES = [
    ("question", "Ready to share?", "You built an app with AI. It looks good. But does it actually work?"),
    ("website", "Start here", "That's where Praxis comes in. Open the website and choose Test Your Project."),
    ("browser", "Try a private check", "Pick your project folder. The browser reads the code on your device, points out possible problems, and gives you a prompt to copy. It hasn't run the app yet."),
    ("local-setup", "Run the local tool", "For real tests and AI review, run Praxis locally. Here, we're using the working release candidate. The new public package hasn't been released yet."),
    ("local-intake", "Choose your project", "Choose a folder, upload your source, or paste a GitHub link. Add your goal and a spending limit. Tests run in a separate Docker copy, after you allow them."),
    ("ai-team", "Meet the review team", "Four AI specialists look at the same project: how it feels to use, how reliable it is, how secure it is, and what's needed to ship it."),
    ("provider-limits", "Honest about limits", "They compare findings and check each other's evidence. If a provider runs out of credit or hits a limit, Praxis tells you. It never pretends the review finished."),
    ("people", "People join the review", "People can join the conversation too. Leave a goal, ask a specialist, or add a private note. You decide what the AI team can see."),
    ("runtime-proof", "Catch the false success", "Now watch this. One version saves an order, and its tests pass. The broken version says success, but saves nothing. The real test catches it."),
    ("findings", "Understand the problem", "Each finding explains the problem, why it matters, and where to look. Checks that didn't run stay visible, so a green result doesn't hide missing work."),
    ("fix-plan", "Make a plan first", "Next, draft a fix plan. Review the changes, the risks, and the tests. Then copy the plan into your coding agent. Planning leaves your original files untouched."),
    ("context", "See what happened", "The source map shows how files connect. The activity view shows what actually ran. You can inspect both instead of trusting a summary."),
    ("close", "PRAXIS", "Build with AI. Check with Praxis. Try the browser check first, then go local for the deeper review."),
]
FEEDBACK = """## Changes from v1 — 2026-10-03

User feedback: robotic voice; repeated or colliding captions and titles; random
badges and asterisk symbols; weak screen recordings and screenshots. Make the
walkthrough easy for a teenager, prevent overlap and overflow, and QA the export.

Revision: conversational ElevenLabs Chris narration through the connected vidIQ
MCP. One continuous take, then split at measured speech boundaries. Word timings
come from an actual transcription, never evenly distributed estimates. Real
Playwright action recordings replace the screenshot slideshow. One short chapter
title above the footage; captions occupy a separate bottom band. No decorative
badges, asterisk/spike symbols, karaoke underlines, crossfade ghost text or fake UI.

The original locked plans are retained under history/v1. The first rendered film
is retained as praxis-introduction-v1.mp4. Verification logic and source projects
are unchanged. Actual app status indicators remain evidence, not editorial decor.

Connected fal generation was unavailable because its account had no credits.
vidIQ completed the replacement voice generation. Eight installed Hyperframes
skills were updated; CLI pin advanced from 0.8.111 to 0.8.114. The new usage
command is unavailable in this CLI, so remaining Hyperframes allowance is unknown.

"""

def main():
    archive = PROJECT / "history/v1"
    archive.mkdir(parents=True, exist_ok=True)
    for name in ("BRIEF.md", "SCRIPT.md", "STORYBOARD.md", "frame.md"):
        if not (archive / name).exists():
            shutil.copyfile(PROJECT / name, archive / name)
    old = PROJECT / "renders/praxis-introduction.mp4"
    if old.exists() and not old.with_name("praxis-introduction-v1.mp4").exists():
        # Both explicitly named paths stay inside this project's render directory.
        old.rename(old.with_name("praxis-introduction-v1.mp4"))
    brief = (archive / "BRIEF.md").read_text(encoding="utf-8")
    (PROJECT / "BRIEF.md").write_text(brief + "\n" + FEEDBACK, encoding="utf-8")
    script = "# SCRIPT — PRAXIS introduction v2\n\nVoice: ElevenLabs Chris through vidIQ MCP.\nVoice direction: conversational, warm, clear, short sentences.\nTiming: actual transcription of generated audio; natural breathing pauses retained.\nNo Windows/SAPI fallback, impersonation or voice cloning. No music under narration.\n\n"
    for n, (_, title, spoken) in enumerate(LINES, 1):
        script += f"## Line {n} — {title} (Frame {n})\n\nDelivery: explain this to a curious teenager.\n\n    {spoken}\n\n"
    (PROJECT / "SCRIPT.md").write_text(script, encoding="utf-8")
    (PROJECT / "narration-public.txt").write_text("\n\n".join(line[2] for line in LINES) + "\n", encoding="utf-8")
    (PROJECT / "revision-scenes.json").write_text(json.dumps([
        {"frame": n, "slug": slug, "title": title, "text": text}
        for n, (slug, title, text) in enumerate(LINES, 1)
    ], indent=2), encoding="utf-8")
    storyboard = """---
format: 1920x1080
duration: 150s
message: See what works before you share an AI-built project.
arc: Question → real workflow → real failure → reviewable plan → next step
audience: Curious teenagers and AI-assisted software builders
mode: autonomous
music: none
captions: English, sentence-grouped subtitles in a dedicated bottom band
---

""" + FEEDBACK + """## Video direction

One visual world: the real PRAXIS app. Neutral dark canvas, Inter typography,
off-white text and one restrained blue accent from the product. Real UI pixels
retain their original colors. No serif display, symbols, badges or noisy metadata.

Fixed geometry: chapter heading x=96, y=62, maximum width=1728, font=48px.
Footage matte x=96, y=162, width=1728, height=708. Captions own y=920–1024,
font=34px, maximum two lines. No text, code, artwork or footage in that band.
The footage is a locally recorded sequence of real browser actions, not recreated
UI or a screenshot animated to imply execution. Source review is not runtime proof.

Clean hard cuts between scenes and between independent recorded results. Never
blend two text-bearing screens. No asset zoom or perpetual animation. The motion
comes from genuine clicks and scrolls. A chapter title has one 0.22s entrance,
then holds. Captions have no word-highlights, bouncing letters or underlines.
The failed test is a deliberate held reading beat. Evidence is shown before a
summary. Shared notes are local sessions, not authenticated remote collaboration.

"""
    for n, (slug, title, text) in enumerate(LINES, 1):
        asset = "none" if n in (1, 13) else f"assets/recordings/{n:02d}-{slug}.mp4"
        storyboard += f"""## Frame {n} — {title}

- scene: {title}, shown through real recorded actions.
- voiceover: {json.dumps(text)}
- duration: {max(5, len(text.split()) / 2.8):.3f}s
- transition_in: cut
- status: outline
- src: compositions/frames/{n:02d}-{slug}.html
- blueprint: compose
- asset_candidates: {asset}

Narrative role: make one step understandable without specialist jargon.
On-screen editorial words: {json.dumps(title)} only. For Frame 4 the actual
source command may also appear: "node src/cli.js workbench --production".
No repeated narration paragraphs, decorative pills, star symbols or screenshot stacks.
Scene (0.00s–end): read the measured duration from audio metadata after sync.
Chapter title uses a restrained 0.22s entrance (`gsap-effects`), then holds.
The footage is fixed in the shared matte; the framework owns video playback.
Video starts at zero; no manual playback, clocks or source-time inventions.
No timed ordinary wrapper around timed video. Use one paused registered timeline.
All content stays above y=880. Independent result states use a deliberate cut.

"""
    (PROJECT / "STORYBOARD.md").write_text(storyboard, encoding="utf-8")
    (PROJECT / "frame.md").write_text("""---
version: v2
name: PRAXIS clear walkthrough
colors:
  ink: "#F4F7FB"
  cream: "#0B0F17"
  tile: "#131B28"
  tile-strong: "#24415E"
  coral: "#8DBEFF"
  navy: "#0B0F17"
  navy-soft: "#131B28"
  navy-elev: "#1D2A3B"
typography:
  display: { fontFamily: "Inter", px: 86, weight: 600 }
  headline: { fontFamily: "Inter", px: 48, weight: 600 }
  body: { fontFamily: "Inter", px: 34, weight: 400 }
  code: { fontFamily: "JetBrains Mono", px: 28, weight: 400 }
---

Real product recordings lead. One clean title per chapter; no editorial badges,
asterisks, spikes, stock images, gradients, glow or synthetic product UI. Inter
and JetBrains Mono are local licensed font files under assets/fonts.
Canvas 1920×1080. Footage x96 y162 w1728 h708. Captions y920–1024 exclusively.
Title baseline stays clear of footage. Hold legible results without fake movement.
All frames are templated sub-compositions, one paused GSAP timeline, unique ids,
background on its own full-duration clip, no hidden media playback manipulation.
No crossfades between text-bearing states. Preserve actual status colors in UI.
Opening and closing title treatments remain restrained and readable, with no
paragraph duplication of narration. Closing domain: praxis-six-xi.vercel.app.
""", encoding="utf-8")
    print(f"v2 plan: {len(LINES)} scenes, {sum(len(x[2].split()) for x in LINES)} spoken words")

if __name__ == "__main__":
    main()
