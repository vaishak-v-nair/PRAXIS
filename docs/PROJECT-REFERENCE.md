> Historical documentation snapshot retained for reference. It contains earlier roadmaps and receipt descriptions. Use the current [README](../README.md), consumer quickstart and receipt specifications for present behavior.

<div align="center">

<img src="docs/mascot.gif" width="340" alt="Praxis — the axolotl that regrows your context">

# PRAXIS

### Your AI says "done." PRAXIS proves it.

**PRAXIS is a local project review tool for software built with AI.**
Bring a folder or GitHub repository, inspect source-backed findings, run authorized
checks in Docker, and review a fix plan before handing it to a model or coding agent.
The existing CLI separately provides claim verification, signed receipts, portable
project memory, agent adapters, and a tray companion.

[![npm](https://img.shields.io/npm/v/praxis-memory?color=d6547a&label=npm)](https://www.npmjs.com/package/praxis-memory)
[![CI](https://github.com/vaishak-v-nair/PRAXIS/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/vaishak-v-nair/PRAXIS/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-4fa376)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522-4e8fd0)](https://nodejs.org)
[![local-first](https://img.shields.io/badge/workspace-local%20first-dfa03a)](#safety)

**[Website](https://praxis-six-xi.vercel.app/)** · **[Test your project in the browser](https://praxis-six-xi.vercel.app/test-your-project/)** · **[Changelog](CHANGELOG.md)** · **[Receipt spec](RECEIPT-SPEC.md)** · **[Start here (no terminal experience)](docs/START-HERE.md)**

```powershell
# From this checkout with Node.js 22+:
node src/cli.js review
```

The new Review launcher prepares dependencies, installs private Python and builds
the production interface. It opens **http://127.0.0.1:3000** when both services
respond. Saved reviews and provider settings live in a persistent user-data folder,
outside npm's cache. Use `review --check` for an inert readiness check, or
`review --setup-only` to prepare without starting services. The public command
`npx praxis-memory@0.14.2 review` becomes available after the manual npm release;
this checkout command works now. Node.js remains a prerequisite.

The existing Windows developer launcher `.\start.ps1` remains available with
its `-Check`, `-SkipInstall` and explicit `-InitMemory` options. Model keys stay server-side; reviews send bounded,
redacted excerpts to the providers you configure and use a shared spending limit.
Docker runtime execution and source application remain explicit actions.

**[Project review quickstart](docs/PROJECT-REVIEW-QUICKSTART.md)** ·
**[Setup on any platform](docs/WORKBENCH-INTEGRATION.md)** ·
**[Product and codebase map](docs/PRODUCT-MAP.md)**

Prefer the existing memory CLI? `npx praxis-memory` sets up its supported hooks.

**Want to see it before you install anything?**

```bash
npx praxis-memory demo
```

<!--
  Recorded from the real command by scripts/record-demo.mjs — it spawns the CLI
  and renders the bytes it actually wrote. The GIF is the PROOF segment only: it
  opens on the receipt being sealed and stops where the recorded story starts,
  so a scroller meets proof at frame zero and the loop stays self-contained.
  The full run, story included, is the MP4.
  Alt text is deliberately NOT "shows a verified verdict": this receipt carries
  no verdict at all, because no judge ran. Alt text describes what is on screen.
-->
<img src="docs/demo.gif" width="692" alt="Terminal recording: praxis demo seals a receipt on your own machine and verifies it offline — chain intact, signature valid, three entries, checked with no network. The screen states that no judge ran and so the receipt carries no verdict, and hands you the command that proves it yourself." />

*[Full recording as MP4](docs/demo.mp4) — the whole run, including the story the GIF stops before.*

*The offline demo seals an explicitly marked recorded excerpt and checks its chain
and signature. It carries no judge verdict and is separate from a Workbench review.*

*`npx praxis-memory demo --live` runs an installed coding agent in a throwaway
project and requests a separate judge (spends tokens). `praxis live` is the
two-scenario Verify presentation, with optional LangGraph.js orchestration.*

*Never used a terminal? **[Start here](docs/START-HERE.md)** — five minutes, no prior knowledge, works the same in VS Code, Cursor, or a plain terminal window.*

**What setup writes, and who it affects.** PRAXIS captures each session with a
Claude Code hook that runs `npx -y praxis-memory`. By default that hook goes in
`.claude/settings.local.json` — **your** file, gitignored, nobody else touched.
If your repo has other contributors, setup asks once whether you'd rather arm the
whole project; choosing that writes the committed `.claude/settings.json`, and
your teammates then get memory and receipts automatically — which also means
their sessions run `npx` too. `praxis doctor` always tells you which one you're on.

**Two doors:** before Claude, it's the terminal — `praxis`. Inside Claude Code, it's the slash — type `/` and the `/praxis-*` commands are right there.

</div>

---

## Why

| **0 bytes** | **$0** | **1 file** | **MIT** |
|:--:|:--:|:--:|:--:|
| leave your machine | added inference cost | portable markdown | open source |

These figures describe the local memory/capture and offline signature loop.
Workbench model reviews, explicit live agent/judge runs, Verify extraction,
repository downloads, and configured MCP sources have their own network and cost
boundaries. PRAXIS does not guarantee free model access or remaining API credit.

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
- **Agent orchestration** — `praxis flow` uses the native DAG runner. Optional
  LangGraph.js orchestration is confined to PRAXIS Live; Workbench uses its own
  bounded Python review and repair pipeline. CrewAI is not integrated.
- **Auto-capture** — `init` installs a `Stop` hook. When a session ends,
  `praxis capture` appends a structured state transition summary on its own.
- **Receipts** — supported session evidence can be sealed into a signed,
  hash-chained record (commands, files, tests). A transcript's unsupported fields
  are not invented. Sealing is separate from judging completion claims.
  `praxis receipt` reads the recorded evidence back.
- **Snapshots** — a `PreCompact` hook fires right before Claude squeezes a full
  session. Praxis saves the context size, your recent asks and the files touched.
- **Always on** — a `SessionStart` hook brings the tray companion up the moment
  a Claude session opens. Health is ambient, not a command you remember to run.
- **Inspectable evidence** — Workbench retains command outcomes, coverage gaps,
  model findings, and repair history locally. LangSmith is a transitive optional
  development dependency, not a dedicated tracing integration; Langfuse is not integrated.
- **Nothing is ever lost** — the working memory stays small so Claude loads fast,
  but entries rotated out of it move to `.praxis/archive/sessions/` (one file per
  month, oldest first). With an Obsidian vault connected, the archive is mirrored there too.

## The companion

An axolotl regrows lost limbs; Praxis regrows lost context. The mascot is the status
bar — its state *is* your session's state:

<table align="center">
<tr>
<td align="center"><img src="docs/tray/idle.webp" width="104" alt="idle"><br><sub>🟢 <b>idle</b><br>context fresh</sub></td>
<td align="center"><img src="docs/tray/warning.webp" width="104" alt="warning"><br><sub>🟠 <b>warning</b><br>filling up</sub></td>
<td align="center"><img src="docs/tray/limit.webp" width="104" alt="limit"><br><sub>🔴 <b>limit</b><br>limit reached</sub></td>
<td align="center"><img src="docs/tray/switching.webp" width="104" alt="switching"><br><sub>🔵 <b>switching</b><br>moving context</sub></td>
<td align="center"><img src="docs/tray/restored.webp" width="104" alt="restored"><br><sub>🟡 <b>restored</b><br>context recovered</sub></td>
</tr>
</table>

On Windows it starts with the very first install and lives in your system tray: the axolotl breathes slowly, and only its glow changes with your session state — green healthy, amber filling, red at the limit, blue switching, gold restored. Left-click opens a popover: the animated mascot, live memory stats, your recent session entries and a suggestion. macOS and Linux are next; `praxis status` covers every platform meanwhile.

At the moments that matter, the mascot itself floats up from the corner of your
screen — no popup box, no window, just the axolotl and one plain-English line
with the live numbers behind it ("Your Claude session is 88% full. praxis
switch starts a fresh one - your memory comes along."). It never takes focus,
clicks pass straight through it, and it fades away on its own after a few
seconds. Turn it off any time with `"overlay": false` in `.praxis/config.json`
(balloon toasts return as the fallback).

## Commands

**Local review and repair workbench:** the full application formerly run from
`E:\BrosKi\demo` now lives in `apps/workbench` in this repository. From a PRAXIS
checkout run `npm run dev`, or `node src/cli.js workbench`. It reviews local folders
or GitHub repositories, prepares repairs in copies, and keeps diff review, exports,
shared model budgets, runtime trust, and source-apply confirmation. It has separate
Next.js/Python dependencies; scans can send redacted excerpts to your selected
model provider. The existing CLI, offline receipt demo, and deck remain available.
See [setup and directory plan](docs/WORKBENCH-INTEGRATION.md).
For the current project-review workflow, see
[Project review quickstart](docs/PROJECT-REVIEW-QUICKSTART.md).

```bash
npx praxis-memory     # set up here (or show status, if already set up)
praxis demo           # see the whole thing in one minute — no setup, no network
praxis demo --live    # same loop on real work: a sandbox agent, judged live (spends tokens)
praxis init           # explicit setup
praxis status         # what Praxis remembers, and session health
praxis recap          # catch me up on this project, right in the terminal
praxis save           # log the current session into memory, mid-flight
praxis remember "<f>" # save a fact or decision into project memory now
praxis forget "<t>"   # remove matching lines from memory (asks first)
praxis health         # how full is this Claude session, really — and where to go next
praxis switch <tool>  # pack a handoff brief and move to gemini / codex / claude / cursor
praxis checkpoint     # save the whole session to md files, then /compact and keep going
praxis trace          # the AI context behind a commit (on · off · log · <hash>)
praxis gate [ref]     # slop-risk score for a commit — triage before you review
praxis receipt        # proof of what the AI did this session (--html · --list)
praxis receipt verify <file>   # offline proof: chain + signature, free
praxis receipt --verify        # judge this session's claims (one model call)
npx praxis-memory verify       # check the latest AI-agent commit and sign the result
praxis github-app              # run the PR check + comment webhook service
praxis flow [file]    # native DAG orchestration — parallel isolated agent execution
praxis eval [suite]    # offline deterministic fidelity benchmark against signed receipts
praxis workbench      # local review-and-repair app (optional source checkout)
praxis doctor         # what's set up, what broke, and the fix for each — a local read
praxis tray           # the axolotl in your system tray (Windows; --stop to quit)
praxis feedback       # the two questions that shape what gets built next
```

*No global install? Every command works as `npx praxis-memory <command>` — e.g. `npx praxis-memory status`.*

**Verify an agent's completion report:** start with [`docs/VERIFY-QUICKSTART.md`](docs/VERIFY-QUICKSTART.md). Static mode is local and never executes project code; trusted mode requires an explicit command policy.

**Verify pull requests:** [`docs/GITHUB-APP.md`](docs/GITHUB-APP.md) covers the
GitHub App permissions, webhook service, advisory default, protected-base opt-in
gate, and the public browser receipt explorer.

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
| `/praxis-checkpoint` | save everything, `/compact`, continue in this same session |
| `/praxis-flow` | execute agentic DAG workflow with parallel isolated nodes |
| `/praxis-eval` | run deterministic offline fidelity benchmark against receipts |
| `/praxis-feedback` | the two questions that shape what gets built |
| `/praxis-explain` | re-explain Claude's last answer with zero jargon — for people who don't read code |
| `/praxis-receipt` | the receipt: what the AI really did — verify claims, or get the shareable card |
| `/praxis-doctor` | diagnose the install — what works, what broke, how to fix it |
| `/praxis-trace` · `/praxis-cost` · `/praxis-gate` · `/praxis-roi` · `/praxis-vault` · `/praxis-telemetry` · `/praxis-tray` | the same commands as the CLI, explained in plain English by Claude |

Every `praxis` command has a slash twin, and every slash command has a terminal
twin — use whichever is closer to your hands.

## What Praxis writes, and where

| Path | What |
|------|------|
| `.praxis/memory.md` | Your living project memory — the thing Claude reads |
| `.praxis/config.json` | Local settings: capture on/off, size cap, redaction |
| `.praxis/checkpoints/` | `praxis checkpoint` — the RESUME brief + full session archives |
| `.praxis/archive/` | Entries rotated out of the working memory — kept forever, monthly files |
| `.praxis/receipts/` | One signed, hash-chained receipt per session — see [RECEIPT-SPEC.md](RECEIPT-SPEC.md) |
| `.praxis/verify/` | Local claim, evidence, and policy artifacts linked from signed receipts |
| `CLAUDE.md` | A managed `PRAXIS:START/END` block. **Your own content is never touched.** |
| `.mcp.json` | The praxis MCP server, registered alongside any servers you already have |
| `.claude/settings.json` | `Stop` + `PreCompact` + `SessionStart` hooks, merged in without disturbing existing hooks |
| `.claude/commands/` | The `/praxis-*` slash commands — one per praxis command, project-scoped |
| `~/.claude/commands/` | The same commands, user-wide — so `/` shows them in **every** project |

> `/` menu looks empty? Restart the open Claude Code session — it loads commands at start.

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

## Trace — the *why* behind every commit

Git records *what* changed. `praxis trace` records **why the AI changed it** —
straight from the session, attached to the commit, in plain git:

```
 $ praxis trace

 7efb103  feat(telemetry): go live behind the Cloudflare worker

 praxis trace — the AI context behind this commit

 Asked:
   · make telemetry live end-to-end
 Touched: src/lib/telemetry.js · test/telemetry.test.js
 Ran: 11 commands
 In its words:
   "Endpoint flipped to the deployed worker. The package ships a URL and
    zero credentials — a test enforces that."

 — session 100% full at commit · praxis v0.6.0
```

`praxis trace on` adds one line to your post-commit hook (existing hooks are
never touched). Every commit after that carries its AI context in
`refs/notes/praxis` — no server, no vendor, works on any git host. Review a
teammate's AI-written PR with the *reasoning*, not just the diff:
`praxis trace <hash>` · `praxis trace log` · share notes with
`git push origin refs/notes/praxis`. Secrets are redacted; files outside the
repo are counted, never named.

## What PRAXIS does not do

Two things people ask for are already done better elsewhere, and pretending
otherwise would waste your time:

- **Token costs and spend reports** → [**ccusage**](https://github.com/ryoppippi/ccusage).
  It reads the same local files PRAXIS does, covers Codex and other agents too,
  and is genuinely excellent. px ccusage\n- **Live session monitoring** → [**cctop**](https://github.com/stefanprodan/cctop).
  A proper top-style view of every running session.

praxis cost, praxis roi and praxis hud still work today, print a pointer
to those tools, and are removed in 0.11.0. We would rather do one thing that
nobody else does than five that somebody else does better.

## Receipts — proof, not vibes

"Done! All tests pass, pushed to origin." — did it, though? Every session now
seals a **receipt**: a hash-chained, Ed25519-signed record of what the AI
*actually did* — every command it ran (from every channel it ran them
through), every file it touched, whether tests really executed. Written
silently by the same Stop hook, zero model calls, zero seconds added.

```
 $ praxis receipt

 PRAXIS receipt   r-4e91ac07   ✓ VERIFIED
 ────────────────────────────────────────────────
 work       23 commands · 6 files · tests run · git activity
 channels   Bash, PowerShell
 integrity  chain intact · signature valid

 claims   3 TRUE · 1 FALSE · 1 UNVERIFIABLE
   ✓  all tests pass
   ✗  updated the docs   ← FALSE
```

- **`praxis receipt`** — read the latest receipt (`--list` for all).
- **`praxis receipt verify <file>`** — proof, offline and free: recomputes the
  hash chain and checks the signature against the key the receipt carries. No
  network, no model call, exits 0 or 1 so CI can gate on it. This is what
  someone runs on a receipt *you* handed *them*.
- **`praxis receipt --verify`** — opt-in: one model call has an adversarial
  judge rule each of the AI's claims **TRUE / FALSE / UNVERIFIABLE** against
  the recorded evidence. Absence of evidence is never treated as a lie, a
  missing judge never invents a verdict — an unjudged receipt says
  `UNVERIFIED`, honestly.
- **`praxis receipt --html`** — a self-contained card you can attach to a PR
  or send to whoever asked "is it actually done?". Opens offline, no tracking.

Receipts are tamper-*evident*, not tamper-proof: the final line signs the
whole chain, so nothing can be quietly rewritten after sealing. The format is
an open spec — [RECEIPT-SPEC.md](RECEIPT-SPEC.md) — verifiable with nothing
but sha256 and Ed25519, no praxis install required. Like everything else:
local files in `.praxis/receipts/`, never uploaded.

## The platform: commands that disappear

`praxis init` also registers PRAXIS as an **MCP server** (`.mcp.json`), so
Claude Code hands the model the praxis tools directly: `praxis_receipt`,
`praxis_verify`, `praxis_receipts`, `praxis_recall`. The AI checks its own
receipt before telling you it finished; asks memory what it knew last week —
no command typed, by you or by it. The CLI stays for humans and scripts; the
intelligence works behind the platform either way.

## Your Obsidian vault, auto-fed

Already keep a second brain in Obsidian? Point praxis at it once:

```bash
praxis vault "D:\path\to\your vault"
```

From then on, everything the AI does writes itself into your vault as plain,
wiki-linked markdown — no typing, no pasting: a hub note per project, a live
mirror of the project memory, **one note per session** (what you worked on,
files touched, where the context ended), and **one note per traced commit**
(the AI's reasoning). Your graph view becomes the visual history of your AI
work. Obsidian is where you write what *you* think; praxis fills in what the
*AI* did — from a live session stream no notes app can see. Notes are
redacted like everything else, and `praxis vault off` disconnects any time
(your notes stay).

## AI Orchestration & Evaluation

The CLI uses native JavaScript orchestration, memory retrieval, and evaluation
with zero runtime dependencies. Agent execution and optional model calls have
their own latency and cost. Optional LangGraph.js is a PRAXIS Live presentation
adapter; it does not replace the native verifier or Workbench's Python pipeline.

### 1. Native DAG Engine (`praxis flow`)
Orchestrates complex, multi-step agentic workflows where dependent tasks are topologically sorted via Kahn's algorithm and independent tasks execute concurrently.
- **Dependency ordering:** Steps have explicit inputs and dependencies. Coding-agent execution follows the selected adapter's permission mode; a DAG node is not itself an OS sandbox.
- **Recorded outcomes:** Supported jobs retain execution evidence. Agent completion, available receipt evidence, and a verified claim remain distinct.
- **Zero Framework Bloat:** No external dependencies, custom Python runtimes, or complex graph DSLs. Defined in clean, declarative configuration.

### 2. Advanced Context Retrieval (BM25)
Standard LLM workflows pass static files or rely on slow, expensive cloud vector databases. PRAXIS builds an embedded, zero-dependency **BM25 index** (TF-IDF with exponential recency decay) directly over `.praxis/memory.md`.
- **Local retrieval:** Queries use local records without an embedding API. Historical microbenchmarks are shown below; runtime depends on the corpus and machine.
- **Recency-Weighted Ranking:** Recent architectural decisions and constraints are prioritized over older historical records, keeping the agent grounded in current project realities.

### 3. Evaluation Harness (`praxis eval`)
Deterministic scoring of execution outcomes, expected file scope, and available claim rulings. Running an evaluation can invoke a coding agent; deterministic scoring does not make that execution offline or free.
- **Evidence limits:** An exit code, a claim ruling, and a valid receipt signature answer separate questions. Use Verify's independent claim checks for committed changes; evaluation scoring alone is not cryptographic proof of implementation correctness.
- **Regression Testing:** Integrates directly into CI/CD pipelines to catch agent performance regressions before deployment.

### 4. Historical microbenchmarks
Earlier synthetic measurements are shown for context, not universal latency or coverage guarantees. Current regression counts must come from a fresh test run.

| Benchmark / Operation | Verified Performance | Latency Ceiling |
|---|---|---|
| **1,000-Node DAG Topological Sort** | **1.80 ms** | `< 10.0 ms` |
| **Local BM25 Context Retrieval** | **0.26 ms** | `< 1.0 ms` |
| **Earlier core regression run** | **430 passing assertions (0 failures)** | Not a coverage percentage |
| **External Runtime Dependencies** | **0 added** | `0` |

## Safety

- **Redaction** — before writing, Praxis strips common secrets (API keys, tokens,
  private keys). Best-effort, not a guarantee; the real defense is that Praxis is told
  never to write secrets.
- **Never auto-commits** — `init` adds `.praxis/` to `.gitignore` by default. Commit
  the memory deliberately if you want shared team context.
- **Explicit network boundaries** — memory capture and offline signature checks
  use local files. Workbench model review sends bounded, redacted source context
  to configured providers; GitHub intake and advisory lookup use the network.
  Live agents, judge/extraction calls, and MCP evidence sources have separate
  access requirements. Submitted-project network permission is independently
  controlled. Anonymous usage counts are sent only after setup opt-in
  (`praxis telemetry show` prints exactly what).

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
- Trace v0: the AI's decision trail on every commit, in plain git notes — `praxis trace`.
- Checkpoint: save the whole session to markdown (+ Obsidian), `/compact`, continue in the same session — `praxis checkpoint`.
- Receipts v0: a signed, tamper-evident record of what the AI did every session, with an opt-in adversarial judge for its claims — `praxis receipt` · [RECEIPT-SPEC.md](RECEIPT-SPEC.md).
- MCP server: the praxis tools (receipt · verify · recall) live inside Claude Code automatically — registered at init, no command typed.
- **Native AI Orchestration:** Run complex, multi-step Agentic workflows using the built-in, zero-dependency Directed Acyclic Graph (DAG) execution engine (`praxis flow`).
- **Advanced Context Retrieval:** Sub-millisecond BM25 local index to accurately feed historical project memory into ongoing agent sessions with recency weighting.
- **Evaluation Harness:** Offline, deterministic benchmark scoring for agent fidelity tests using `praxis eval`.

**Still inside v0**
- Tray companion for macOS and Linux.
- Receipts everywhere claims travel: PR comments, share links, the judge's voice tuned.
- The HUD as the *primary* way to watch a session, not a sidecar.
- Deep health for the other tools (Gemini CLI, Codex), richer summarization.

**v1.0 — the line**
v1.0 is not a feature list. It ships when real users say PRAXIS is something
they wouldn't work without. Until then, everything is v0.

## Develop

The optional workbench accepts local paths, GitHub URLs, and browser folder
uploads. Core jobs support Claude Code, Codex, Gemini CLI, OpenCode, and explicit
adapters for other CLIs. See [agent workflow and setup](docs/AGENT-WORKFLOW.md)
for permissions, model access, and evidence boundaries.

```bash
git clone https://github.com/vaishak-v-nair/PRAXIS.git && cd PRAXIS
npm link          # optional: puts `praxis` on your PATH; hooks use npx
npm test          # node --test "test/*.test.js"
```

Manual npm release from the full source checkout:

```bash
npm run release:check
npm login --registry=https://registry.npmjs.org/
npm publish --access public --registry=https://registry.npmjs.org/
```

The prepublish gate runs before upload; a tag push alone does not publish.
See [manual release setup](docs/MANUAL-NPM-RELEASE.md) for development tooling,
package inspection, authentication and the optional manual CI provenance route.

## License

MIT — [LICENSE](LICENSE).

<div align="center">
<sub>🦎 regenerate lost context.</sub>
</div>

Official MCP evidence and evaluation gates: [docs/VERIFY-EVIDENCE.md](docs/VERIFY-EVIDENCE.md)
