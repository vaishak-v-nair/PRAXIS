# Changelog

All notable changes to `praxis-memory`, newest first.

This file is not a courtesy. Sixteen shipped files invoke `npx -y praxis-memory`
unpinned, so every release lands on every install automatically — this page is
the only notice an auto-upgrading fleet gets. The release workflow enforces
that: publishing a version this file does not name fails in CI
(`scripts/ci/changelog.mjs`), and the GitHub Release page is generated from the
entry here, so the two surfaces cannot drift apart.

Format follows [Keep a Changelog](https://keepachangelog.com); versions follow
[SemVer](https://semver.org) (0.x: minors may break, patches never do).

## [Unreleased]

## [0.10.0] — 2026-07-29

### Added

- **`praxis demo`** — proof in seconds, offline. Seals a genuine signed receipt
  onto your disk, verifies it in front of you, hands you the command that
  re-checks it, and only then replays the real session it is a receipt of —
  including the time our own judge got it wrong and the rule that fixed it.
  No agent, no account, no network. Every screen labels what is a recording
  and what is not.
- **`praxis demo --live`** — the same loop on work that hasn't happened yet: a
  real agent does a real task in a throwaway folder (never your project), and
  the judge rules its claims with nobody knowing the verdict in advance. Costs
  real tokens and says so before starting.
- **`praxis run` + `praxis jobs`** — the jobs engine. Agents work unattended;
  every job seals its own receipt, so *done* and *proven* are different columns.
- **`praxis approve`** — unattended agents write safe drafts; a human gates
  execution.
- **`praxis gov`** — one goal in, a governed fleet of human-gated jobs out.
- **`praxis deck`** — Mission Control in the browser.
- **`praxis doctor`** — checks this machine and names the fix, never a stack
  trace. Also available as a library so every command can point at it honestly.
- **Receipt schema v2** — `provenance` is sealed inside the signed record (a
  demo receipt can never be passed off as real work), the public key travels in
  `sig.pub` so receipts verify on a stranger's machine, and records without a
  provenance field (pre-0.10.0) are explicitly treated as real.
- **CI:** tests on nine runtimes (3 OS × Node 22/24/26) on every push, a
  tarball size budget, and a pack-smoke job that installs the real tarball
  into an empty project and runs the demo end to end.
- **Releases publish themselves** — a v-tag triggers test → pack-smoke → judge
  certification → human approval → `npm publish` with an OIDC provenance
  attestation. No long-lived npm token exists anywhere.
- **`--json` across the CLI** — `status`, `receipt` (view, `--list`,
  `verify <file>`, `--verify`), `jobs` and `doctor` emit one JSON document on
  stdout with stable keys; `ok` mirrors the exit code. For scripts, CI gates,
  and anything that reads with a parser instead of eyes.

### Changed

- **Install consent.** The capture hook now defaults to
  `.claude/settings.local.json` — your file, gitignored, nobody else touched.
  A repo with other contributors is asked once before anything is written where
  teammates would run it; a solo repo and non-interactive installs take the
  private default silently. Existing installs keep the file they already use.
- **The CLI got a design system** — one grid, one type scale, shared components
  (chips, rules, aligned rows) across demo, status and receipts. Terminal
  output is typography now, not printf.
- **An unknown command answers in two lines** — the nearest real command as a
  "did you mean", and the help pointer — instead of dumping the entire help
  screen at someone who mistyped one word. Gibberish gets no guess; a wrong
  suggestion is worse than none.
- **Scope honesty.** An overlap audit against what actually exists today found
  cost tracking, live session monitoring and generic memory each served better
  by dedicated tools — so PRAXIS stops competing there and says so. The work
  goes where the audit found nobody: receipts, the judge, the governor.

### Deprecated

- **`praxis cost`** and **`praxis roi`** → use `npx ccusage` — it reads the
  same local files, covers Codex and other agents too, and is far better at it.
- **`praxis hud`** → use `npx cctop` — live session monitoring is a crowded,
  well-served niche and cctop does it properly.
- All three keep working and print a stderr notice; they are removed in
  **0.11.0**. Nothing breaks in a patch, ever.

### Fixed

- **Vault path confinement compared strings, not paths** — a hostile repo
  could have steered vault writes outside the allowed tree. Now resolved
  against the real filesystem, with CI proving it.
- **A job could report finished before its receipt was linked** — watchers of
  `praxis run` saw a done job with no proof attached. The receipt link is now
  stamped before the exit code is visible.
- **A single unreadable job file could end a live watch early** — under load,
  one torn read of a job's metadata was believed as a terminal state, so a
  hung-but-alive agent was reported "nothing was sealed" instead of "timed
  out". An unsure status must now survive consecutive polls to be believed.
- **Tray hosts of deleted projects exit on their own.** Initialising PRAXIS in
  a short-lived directory (a test run, a scratch clone) used to leave a tray
  icon that outlived its project forever — ten identical axolotls in one
  system tray, observed. A host whose project directory is gone now retires
  itself within seconds.
- **The mascot only draws where truecolor can draw it.** On legacy consoles
  and pipes its pixels landed as literal escape codes; those terminals now get
  the same screen minus the art, and nothing else changes.

## [0.9.4] — 2026-07-27

- Meeting PRAXIS is as simple as using it: the no-args front door inits new
  projects and shows status everywhere else, and the story leads with proof.
- The judge now has to earn it: seven iron-rule certification scenarios run
  against the live model, 7/7 required.
- Judge independence written down as an architectural rule, not a detail.

## [0.9.3] — 2026-07-25

- Receipts on every surface: status, tray and the site say what was sealed and
  what the judge ruled.
- The judge survives its first real trial and learns the attempt-vs-outcome
  rule: the presence of a command in the record proves it was *attempted*,
  never that it *succeeded*.
- The roadmap file is public.

## [0.9.2] — 2026-07-25

- **Receipts.** Every session leaves a hash-chained, Ed25519-signed receipt of
  what actually happened, sealed by the Stop hook.
- The praxis tools go live over MCP: `praxis_recall`, `praxis_receipt`,
  `praxis_receipts`, `praxis_verify`.
- The tray updates itself; sharing the site shows a real card.

## [0.9.1] — 2026-07-20

- npx-only installs work end to end: hooks and slash commands always run
  `npx -y praxis-memory`, so nothing depends on a global `praxis` shim that
  may not exist. The front door repairs older bare-`praxis` hooks.

## [0.9.0] — 2026-07-18

- Nothing is ever lost: trimmed memory rotates to `.praxis/archive`, mirrored
  to the vault when one is connected.

## [0.8.0] — 2026-07-17

- `/praxis-checkpoint`: save everything, `/compact`, keep going — same session.

## [0.7.0] — 2026-07-17

- Launch hardening from a full review pass.

## [0.6.0] — 2026-07-15

- Ambient health: pre-compact snapshots, an always-on tray, and the panel type.

## [0.5.0] — 2026-07-15

- `praxis health`: real context fill plus directional switch suggestions.

## [0.4.0] — 2026-07-15

- The floating mascot overlay — the axolotl is the notification.

## [0.3.0] — 2026-07-15

- `praxis hud` and `praxis switch` — phase 1 of the terminal experience.

## [0.2.2] — 2026-07-14

- Republish: 0.2.1 on npm predated the quote/full-video/self-heal round.
  (npm versions are immutable; a stale publish costs a patch number.)

## [0.2.1] — 2026-07-14

- Republish: npm 0.2.0 was published from an earlier snapshot.

## [0.2.0] — 2026-07-14

- The axolotl in your system tray — Windows, zero dependencies.

## [0.1.4] — 2026-07-14

- User-wide slash commands, cross-platform docs, two-door install.

## [0.1.3] — 2026-07-14

- Two-column welcome banner, pixel mascot in the terminal, three new slash
  commands.

## [0.1.2] — 2026-07-14

- Claude-style terminal experience; footer tagline.

## [0.1.1] — 2026-07-14

- One-command install, smart CLI default, a professional README.

## [0.1.0] — 2026-07-14

- First release: local memory for Claude Code. `praxis init`, session capture
  on the Stop hook, and a CLAUDE.md block that loads it back.
