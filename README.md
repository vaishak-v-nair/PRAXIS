<div align="center">

<img src="docs/mascot.gif" width="340" alt="Praxis — the axolotl that regrows your context">

# PRAXIS

### Your AI never forgets your project.

**Praxis is an open-source, local memory for Claude Code.** It distills every coding
session into one durable markdown file — the decisions, the constraints, the reasons —
and hands it back to Claude automatically the next time you open the project.

[![npm](https://img.shields.io/npm/v/praxis-memory?color=d6547a&label=npm)](https://www.npmjs.com/package/praxis-memory)
[![license](https://img.shields.io/badge/license-MIT-4fa376)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518-4e8fd0)](https://nodejs.org)
[![local-first](https://img.shields.io/badge/data-never%20leaves%20your%20machine-dfa03a)](#safety)

```bash
npm install -g praxis-memory && praxis
```

*One command — same on **Windows, macOS and Linux** (Node 18+). It sets up the hooks, the memory file, the tray companion, everything — then every session after remembers. The global install matters: the hooks (auto-capture, pre-compact snapshots, tray auto-start) call `praxis` by name, so it needs to be on your PATH. Just trying it out? `npx praxis-memory` works for a look around.*

*Never used a terminal? **[Start here](docs/START-HERE.md)** — five minutes, no prior knowledge, works the same in VS Code, Cursor, or a plain terminal window.*

**Two doors:** before Claude, it's the terminal — `praxis`. Inside Claude Code, it's the slash — type `/` and the `/praxis-*` commands are right there.

</div>

---

## Why

| **0 bytes** | **$0** | **1 file** | **MIT** |
|:--:|:--:|:--:|:--:|
| leave your machine | added inference cost | portable markdown | open source |

Every new Claude Code session starts from zero. You re-explain the stack, it re-explores
yesterday's dead ends, and it "simplifies" the one file that must never be touched.
Praxis closes the loop: the context survives the session.

## How it works

```
   session ends
       │
       ▼
   Claude Code "Stop" hook ──▶ praxis capture
       │                          │
       │                          ▼
       │                  .praxis/memory.md   (redacted, size-capped)
       ▼
   next session starts
       │
       ▼
   CLAUDE.md ──@include──▶ .praxis/memory.md ──▶ Claude already knows your project
```

- **Auto-load** — `init` adds a managed block to `CLAUDE.md` that `@`-includes your
  memory. Claude reads `CLAUDE.md` automatically, so memory loads every session with
  zero manual steps.
- **Auto-capture** — `init` installs a `Stop` hook. When a session ends,
  `praxis capture` appends a lightweight summary: what you were working on,
  which files were touched.
- **Snapshots** — a `PreCompact` hook fires right before Claude squeezes a full
  session. That is the moment detail is about to be lost — Praxis saves the
  context size, your recent asks and the files touched, first.
- **Always on** — a `SessionStart` hook brings the tray companion up the moment
  a Claude session opens. Health is ambient, not a command you remember to run.
- **Rich capture** — `/praxis-save` asks Claude to write a real decision-level summary.

## The companion

An axolotl regrows lost limbs; Praxis regrows lost context. The mascot is the status
bar — its state *is* your session's state:

<table align="center">
<tr>
<td align="center"><img src="assets/tray/idle.webp" width="104" alt="idle"><br><sub>🟢 <b>idle</b><br>context fresh</sub></td>
<td align="center"><img src="assets/tray/warning.webp" width="104" alt="warning"><br><sub>🟠 <b>warning</b><br>filling up</sub></td>
<td align="center"><img src="assets/tray/limit.webp" width="104" alt="limit"><br><sub>🔴 <b>limit</b><br>limit reached</sub></td>
<td align="center"><img src="assets/tray/switching.webp" width="104" alt="switching"><br><sub>🔵 <b>switching</b><br>moving context</sub></td>
<td align="center"><img src="assets/tray/restored.webp" width="104" alt="restored"><br><sub>🟡 <b>restored</b><br>context recovered</sub></td>
</tr>
</table>

On Windows it starts with the very first install and lives in your system tray: the axolotl breathes slowly, and only its glow changes with your session state — green healthy, amber filling, red at the limit, blue switching, gold restored. Left-click opens a popover: the animated mascot, live memory stats, your recent session entries and a suggestion. macOS and Linux are next; `praxis status` covers every platform meanwhile.

At the moments that matter, the mascot itself floats up from the corner of your
screen — no popup box, no window, just the axolotl and one plain-English line
("Saved. Your next session starts already briefed."). It never takes focus,
clicks pass straight through it, and it fades away on its own after a few
seconds. Turn it off any time with `"overlay": false` in `.praxis/config.json`
(balloon toasts return as the fallback).

## Commands

```bash
npx praxis-memory     # set up here (or show status, if already set up)
praxis init           # explicit setup
praxis status         # what Praxis remembers, and session health
praxis health         # how full is this Claude session, really — and where to go next
praxis hud            # live view of your Claude session, in plain English (second terminal)
praxis switch <tool>  # pack a handoff brief and move to gemini / codex / claude / cursor
praxis tray           # the axolotl in your system tray (Windows; --stop to quit)
praxis feedback       # the two questions that shape what gets built next
```

Inside Claude Code, type `/` and the Praxis commands appear:

| Command | What it does |
|---------|--------------|
| `/praxis-recap` | catch me up on this project |
| `/praxis-save` | rich session summary, written by Claude |
| `/praxis-remember` | save a fact or decision right now |
| `/praxis-forget` | remove outdated info from memory |
| `/praxis-status` | memory at a glance |
| `/praxis-health` | how full is this session, and the best next step |
| `/praxis-switch` | hand this work off to gemini · codex · cursor · antigravity |
| `/praxis-feedback` | the two questions that shape what gets built |
| `/praxis-hud` | how to watch this session live, in plain English |
| `/praxis-explain` | re-explain Claude's last answer with zero jargon — for people who don't read code |

## What Praxis writes, and where

| Path | What |
|------|------|
| `.praxis/memory.md` | Your living project memory — the thing Claude reads |
| `.praxis/config.json` | Local settings: capture on/off, size cap, redaction |
| `CLAUDE.md` | A managed `PRAXIS:START/END` block. **Your own content is never touched.** |
| `.claude/settings.json` | `Stop` + `PreCompact` + `SessionStart` hooks, merged in without disturbing existing hooks |
| `.claude/commands/` | The five `/praxis-*` slash commands, project-scoped |
| `~/.claude/commands/` | The same five, user-wide — so `/` shows them in **every** project |

> `/` menu looks empty? Restart the open Claude Code session — it loads commands at start.

## The HUD

A working Claude session is a wall of scrolling text — file dumps, tool calls,
JSON. `praxis hud` (in a second terminal) retells the **whole session as a
story**: what you said, what Claude said back, what it actually did — one
aligned, plain-English line each, with a real context-health bar on top:

```
 $ praxis hud

 ✦ PRAXIS HUD  ·  E:\PRAXIS                        ▮▮▮▮▮▯▯▯▯▯  52% full
 ● Running a command  ·  just now
 ──────────────────────────────────────────────────────────────────────
  19:02  you     fix the login bug
  19:02   ·      Reading a file — src/auth.js ×3
  19:03  claude  The token expiry check uses < instead of <=. Fixing it.
  19:03   ·      Editing a file — src/auth.js
  19:04   ·      Running a command — npm test
 ──────────────────────────────────────────────────────────────────────
  q to quit  ·  watching your session live
```

It reads the session transcript file Claude Code already writes — it never
touches or overrides Claude's terminal, so it can't break anything. Repeated
steps collapse into one line (`×3`), a squeeze (compaction) shows up as a ⚠
note, and when Claude asks *you* a question a red banner appears so you never
miss it.

Don't read code? The HUD glosses jargon inline — *"refactor (rewriting code
without changing what it does)"* — and inside Claude, `/praxis-explain` makes
it re-explain its last answer with zero jargon: what was asked, what actually
changed, why it's better, what you should do now.

## Session health, and switching tools

Claude Code writes its real token usage into every session transcript. `praxis
health` reads it and tells you — with actual numbers, not guesses — how full
the current session is, how many times it has been squeezed (compacted), and
exactly what to do about it:

```
 Claude Code   ● 91% full (182k of 200k tokens) — critical
               squeezed 3 times already (each squeeze loses detail)

 What to do
 Nearly full. Best move: praxis switch gemini — Gemini CLI starts at 0%
 and your project memory comes along.
```

You never have to run it: the tray companion computes the same number itself
every few seconds, straight from the transcript. The icon's glow turns amber
when the session gets heavy and red when it's critical, the tooltip and panel
show "session 82% full", and the mascot floats up once per level with the way
out. `praxis health` is just the detailed view of what the tray already knows.

Claude is measured deeply; other tools (Gemini CLI, Codex CLI, Cursor,
Antigravity) are checked shallowly — installed or not — so every suggestion is
one you can actually take. The HUD shows the same number live in its header.

`praxis switch gemini` (or `codex`, `claude`, `cursor`, `antigravity`) packs
your project brief and the latest session notes into `.praxis/handoff.md` and
puts the exact launch command on your clipboard. The next tool starts already
knowing your project — you never re-explain it.

## Safety

- **Redaction** — before writing, Praxis strips common secrets (API keys, tokens,
  private keys). Best-effort, not a guarantee; the real defense is that Praxis is told
  never to write secrets.
- **Never auto-commits** — `init` adds `.praxis/` to `.gitignore` by default. Commit
  the memory deliberately if you want shared team context.
- **Local only** — v0.1 makes zero network calls.

## Roadmap

PRAXIS is **v0** — one product, built from scratch, in the open. The npm
version (0.x.y) just counts releases inside v0; the milestone that matters is v1.

**Already in v0**
- The memory loop: auto-capture, auto-load, `/praxis-*` slash commands, redaction, size cap.
- The tray companion (Windows): breathing axolotl, glow = session state, live panel.
- `praxis hud` — the session retold in plain English · `praxis switch` — handoff brief for gemini/codex/claude/cursor.
- Real session health, measured from the transcript — ambient in the tray, detailed in `praxis health`.
- The floating mascot: state changes announced by the axolotl itself, no popup box.
- Pre-compact snapshots: what you were working on, saved the moment before Claude squeezes the session.

**Still inside v0**
- Tray companion for macOS and Linux.
- MCP server — memory Claude can query, beyond the size cap.
- The HUD as the *primary* way to watch a session, not a sidecar.
- Deep health for the other tools (Gemini CLI, Codex), richer summarization.

**v1.0 — the line**
v1.0 is not a feature list. It ships when real users say PRAXIS is something
they wouldn't work without. Until then, everything is v0.

## Develop

```bash
git clone https://github.com/vaishak-v-nair/PRAXIS.git && cd PRAXIS
npm link          # puts `praxis` on your PATH (needed for the auto-hook)
npm test          # node --test
```

## License

MIT — [LICENSE](LICENSE).

<div align="center">
<sub>🦎 regenerate lost context.</sub>
</div>
