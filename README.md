<div align="center">

# 🦎 PRAXIS

### Give Claude Code a memory. Never re-explain your project again.

Every session starts already knowing your architecture, your decisions, and the
reason that one file is weird. **Local-first. No server. No account. Nothing leaves your machine.**

<br>

![PRAXIS demo](docs/demo.gif)

<br>

[![npm](https://img.shields.io/npm/v/praxis-memory?color=d6547a&label=npm)](https://www.npmjs.com/package/praxis-memory)
[![license](https://img.shields.io/badge/license-MIT-42c193)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518-54a2e6)](https://nodejs.org)
![local-first](https://img.shields.io/badge/data-never%20leaves%20your%20machine-e0668c)

```bash
npx praxis-memory init
```

</div>

---

## The problem

Every new Claude Code session starts from zero. You re-explain your project every
morning. Praxis fixes that: it writes a living memory into the file Claude already
reads (`CLAUDE.md`), so the next session opens already caught up. No dashboards, no
copy-pasting yesterday's context.

## Quickstart

```bash
npm i -g praxis-memory   # the command is: praxis
cd your-project
praxis init             # set up memory + the auto-capture hook
praxis status           # see what Praxis remembers
```

Then just use Claude Code. Your memory loads automatically. When a session ends,
Praxis logs it. For a rich, decision-level summary, run `/praxis-save` in-session.

## How it works

Praxis makes **Claude maintain its own memory.** No server, no API cost, nothing
uploaded — the whole loop runs on your machine, on the Claude you already have.

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
  `praxis capture` appends a lightweight summary (files touched, etc.).
- **Rich capture** — `/praxis-save` asks Claude to write a real decision-level summary.

## What Praxis writes, and where

| Path | What |
|------|------|
| `.praxis/memory.md` | Your living project memory — the thing Claude reads |
| `.praxis/config.json` | Local settings: capture on/off, size cap, redaction |
| `CLAUDE.md` | A managed `PRAXIS:START/END` block. **Your own content is never touched.** |
| `.claude/settings.json` | A `Stop` hook, merged in without disturbing existing hooks |
| `.claude/commands/` | `/praxis-save`, `/praxis-status` slash commands |

## The mascot is the status bar

Praxis's axolotl regenerates lost limbs. Praxis regenerates lost context. Its glow
is the state of your session at a glance:

| 🟢 healthy | 🟠 filling | 🔵 moving | 🔴 limit | 🟡 restored |
|:--:|:--:|:--:|:--:|:--:|
| context fresh | context getting full | transferring context | usage limit reached | context recovered |

## Safety

- **Redaction** — before writing, Praxis strips common secrets (API keys, tokens,
  private keys). Best-effort, not a guarantee; the real defense is that Praxis is told
  never to write secrets.
- **Never auto-commits** — `init` adds `.praxis/` to `.gitignore` by default.
- **Local only** — v0.1 makes zero network calls.

## Roadmap

- **v0.1 (now)** — local memory for Claude Code. File-based capture + `/praxis-save`.
- **v0.2** — an MCP server (queryable memory), and an **opt-in, sanitized** shared
  brain: explicit consent, patterns not raw code, value flows back. Never silent harvesting.
- **Later** — cross-tool support, richer summarization.

## Develop

```bash
git clone <your-repo> praxis && cd praxis
npm link          # puts `praxis` on your PATH (needed for the auto-hook)
npm test          # node --test
```

The demo GIF is generated with [vhs](https://github.com/charmbracelet/vhs):

```bash
vhs demo.tape     # writes docs/demo.gif
```

## License

MIT.
