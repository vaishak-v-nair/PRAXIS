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

### Added

- **PRAXIS notices when PRAXIS breaks.** `capture` runs on the Stop hook of
  every session on every install, and it swallows every error so it can never
  take a session down with it. That part was right. What was missing was the
  other half: a swallowed error left no trace anywhere, so a broken capture and
  a working one looked identical — memory quietly stopped growing and the first
  person to find out was you, weeks later, asking Claude about last month.
  `praxis doctor` could only ever check that the hook *string* was present in a
  settings file, which proves it was installed, not that it ran.
  Failures now land in `.praxis/last-error.json` with the phase that broke, and
  `doctor` gained a **Capture ran** row directly under **Capture hooks** —
  because "installed" and "actually ran" are two different claims and reading
  them next to each other is the point. It also catches the quieter failure: the
  `state.json` breadcrumb is written at both ends of the capture loop, so an old
  `switching` means capture started and died in the middle, and finished
  sessions piling up past the last completed capture means the hook is wired but
  not firing. `status` shows the row only when something is wrong, and
  `status --json` carries `capture.ok` for scripts. A later clean run clears the
  fault — an alarm that can never clear is one people learn to ignore.
- **A leak guard in CI.** The `.gitignore` rule keeping the personal vault out
  of this repo has failed twice, both times because the folder was renamed and
  the pattern silently stopped matching. A filter can only fail open, so CI now
  asks the checkable question instead: is anything we *know* is private in the
  index right now. Matches on shape rather than spelling, so no rename dodges
  it, and stands down the confidential-branch rules when it runs there.
- **A coverage floor in CI.** Coverage was never measured, so it could only
  drift one way with nobody the wiser — and it had: fifteen of twenty-seven
  commands sat at 0% *function* coverage, their entry points never called by a
  test even once, while the libraries underneath were at 90-100%. Raising the
  floor is a deliberate commit; lowering it quietly is what this prevents.
- **The Windows tray host is finally gated.** `src/tray/tray.ps1` is the largest
  file in the product and shipped to every Windows user with no CI at all, while
  the macOS host — which there is no Mac here to run — had five checks. It now
  gets the same treatment: parses under Windows PowerShell 5.1, passes
  PSScriptAnalyzer, is verified pure ASCII (PS 5.1 reads a BOM-less file as ANSI,
  and four em dashes had already crept into comments), reports a state through
  `tray --once`, and has every icon present at both glow intensities.

### Fixed

- **`praxis deck --help` started a server instead of printing help** — it bound
  a port, opened a browser window, and then blocked forever on a promise that
  never settles, so asking what the deck does left you with a running server and
  a terminal needing Ctrl+C. A bad `--port` value also became `NaN`; it now
  falls back to the default.
- **`praxis uninstal` got no suggestion.** The `COMMANDS` list behind
  did-you-mean carries a comment promising it stays in sync with the switch, and
  it went stale in the very commit that added `uninstall`.

### Changed

- **The Stop hook reads the transcript once instead of six times.** Six things
  reduce a session line by line — the memory summary, recent asks, session
  commits, essence, health, receipt evidence — and every one re-split the same
  string. Measured on a real 39 MB session: 2801 ms before, 2235 ms after, and
  8 MB less resident. The bigger change is that `readFileSync(…, 'utf8')` throws
  above V8's 512 MiB string limit and that throw was swallowed, so the longest
  sessions produced no memory at all and said nothing. Streaming has no such
  ceiling. Every consumer still accepts plain text, so nothing else changes.
- **`ifMissing()` and `swallow()`** now say which kind of failure a `catch` is
  hiding. An audit found 81 silent catches across 30 files: 33 expected absences
  (no config yet, a half-flushed transcript line), 12 deliberate degradations,
  and the rest impossible to classify from the code. Real failures that are
  correct to survive — the vault mirror on an unmounted drive, a receipt that
  could not be sealed — are now recorded rather than discarded.

- **`praxis uninstall`** — takes PRAXIS out of a project, properly. Until now
  there was no answer to "I want this out of here", so the thing people reach
  for is `rm -rf .praxis` — which leaves the hooks firing `npx -y praxis-memory`
  at the end of every session against a directory that no longer exists. Doing
  it by hand meant six surfaces: `.praxis/`, the hooks in either settings file,
  the `praxis` server in `.mcp.json`, the managed block in `CLAUDE.md`, the
  `praxis-*` slash commands, and the notes written into an Obsidian vault. That
  last one needs you to know which half of your own vault a machine wrote.
  Nothing is deleted before it is copied. Memory, receipts, the archive and the
  vault notes go to `~/.praxis/removed/<project>-<date>/` first, because "I
  changed my mind" and "I ran that in the wrong project" are both ordinary and
  neither should cost anyone their history.
  Every removal is surgical and proves it: hooks belonging to other tools stay,
  other MCP servers stay, a `CLAUDE.md` holding the project's own brief is
  edited rather than deleted, and **only** the `Praxis/` subfolder of a vault is
  touched — never a note you wrote. A settings file or `.mcp.json` that PRAXIS
  created and nothing else uses is removed rather than left as an empty `{}`.
  Legacy bare-`praxis` hooks from 0.9.1 and earlier are recognised too, and so
  are `praxis-cost` / `praxis-roi` / `praxis-hud`, which 0.11.0 retired but
  `init` never deleted from projects that already had them.
  `--dry-run` shows the plan and changes nothing. `--yes` skips the prompt; with
  no TTY and no `--yes` it refuses rather than guessing. `--global` also removes
  the user-wide `/praxis-*` commands, which is opt-in because other projects may
  still be using them. The sentence `init` writes into `CLAUDE.md` ("This
  project uses PRAXIS…") comes out with the block — leaving it puts a false
  instruction in a file Claude reads at the start of every session.

## [0.11.1] — 2026-08-01

### Changed

- **The tray is opt-in now, per project.** `init` no longer starts it and no
  longer writes the `SessionStart` hook; new projects get `tray: false`. The old
  behaviour was one host per project, started automatically, which meant running
  PRAXIS in five repos put five axolotls by the clock without anyone asking for
  one — and the only way back was uninstalling PRAXIS from projects that were
  otherwise perfectly happy. An icon nobody chose is clutter, not ambience.
  `praxis tray` turns it on for a project and **remembers**: it writes
  `tray: true` and adds the `SessionStart` hook, so it comes back on its own
  next session. `praxis tray --stop` does the reverse — flag off, hook removed —
  so stopped means stopped rather than stopped-until-the-next-session.
  Capture, snapshots, receipts and the MCP tools are untouched: this turns off
  an icon, never your memory.
  **Existing installs keep their tray.** They already carry `tray: true`, which
  is exactly what the new opt-in check looks for, so nothing disappears on
  upgrade. Anyone who wants it gone now has a button that works.

### Security

- **`praxis tray` no longer force-kills a process it cannot prove is its own.**
  Both the `--stop` path and the upgrade-restart path read a pid out of
  `.praxis/tray/tray.pid` and ran `taskkill /PID <n> /T /F` on it — killing that
  process **and its entire child tree** — after checking only that the number
  belonged to something alive. A pidfile outlives the host that wrote it and
  Windows recycles pids, so after a reboot that number routinely belongs to
  something else entirely: an editor with unsaved work, a database, a security
  agent. No attacker is needed to trigger it; any code already running as you
  can also just write a pid of its choosing into the file and let PRAXIS swing
  the axe on the next session start. Reproduced by putting a sacrificial
  process's pid in a pidfile and watching `praxis tray` destroy it.
  The kill is now gated on `isHostCommandLine` (`src/lib/tray-host.js`), which
  requires the live process to actually be a tray host **for this project root**
  — compared argument-by-argument, so `E:\PA` never matches `E:\PA2`. Anything
  it cannot confirm is left alone, including when the identity check itself
  fails. A pid that is alive but not ours no longer blocks startup either: the
  stale file is cleared and a fresh host starts, where before the tray would
  have silently never come back in that project.
  `src/lib/demo/live.js` `killJob` has the same missing check on a much smaller
  blast radius (job metadata, `SIGTERM`, no tree kill) and is not changed here.

### Fixed

- **The extra axolotls.** Two bugs compounded into one visible symptom, and
  both are fixed.
  1. *Force-kill skipped the only cleanup path.* The host's single teardown is
     `$doQuit` — `Visible=false`, `Dispose()`, `Application::Exit` — and
     `taskkill /F` delivers no `WM_CLOSE`, so `$doQuit` never ran and
     `Shell_NotifyIcon(NIM_DELETE)` was never sent. Windows then kept drawing an
     icon owned by a process that no longer existed. One orphan per restart.
     Stopping is now cooperative: the stopper drops `.praxis/tray/stop.request`,
     the host sees it on its next tick and retires itself properly, and `/F` is
     only the timeout fallback. `$ni.Dispose()` was also added after
     `Application::Run()` returns, which covers the paths `$doQuit` never sees
     (the project-deleted guard, and logoff).
  2. *Two installs took turns restaging.* `stagedFresh` compared the staged
     `tray.ps1` byte-for-byte against the running install's copy, and **any**
     difference meant kill-and-restage. With a global `praxis` at one version
     and the `npx -y praxis-memory` that the SessionStart hook runs at another,
     each undid the other once per invocation, forever — six alternating runs
     produced four different host pids, and every respawn leaked an icon per
     bug 1. The staged script now carries a stamp
     (`.praxis/tray/staged.json`, `{version, sha256}`) and an **automatic**
     run only ever moves forward: an older install passing through leaves a
     newer stage alone. Typing `praxis tray` yourself still stages what you
     typed, so working from a dev tree is unaffected — and no longer gets
     silently reverted by the next session start.
- **The one-tray-per-project guard could not fail open any more.** The mutex was
  named from an MD5 of the project root, and on a machine with the FIPS
  algorithm policy enabled `MD5::Create()` throws. That throw landed in a
  `catch { $acquired = $true }`, so the duplicate-instance guard switched itself
  off — silently, with `$ErrorActionPreference = 'SilentlyContinue'` — and the
  symptom was two axolotls for a single project. The name now comes from SHA256,
  which is FIPS-approved, with a plain-arithmetic FNV-1a fallback that cannot
  throw at all. Because the name changed, a host started by an older PRAXIS is
  invisible to a new one; that resolves the first time the old host is replaced.
- **The tray stopped glowing red forever.** Memory fill no longer drives the
  axolotl's glow at all. It used to: `>=0.6` of `maxLogBytes` went amber and
  `>=0.9` went red. But the trimmer stops the instant the log is under the cap
  (`while (bytes > maxBytes) pop()`), so "just under" is exactly where every
  healthy project parks and stays — and returning to green needed `<0.6`, which
  would require the log to shrink 40% on its own. It never does. The practical
  effect was that one trim turned the axolotl red **permanently**, on every
  project at once, for the ordinary condition the tooltip itself calls "nothing
  is lost". An alarm that can never clear is not an alarm. Amber and red are now
  reachable only from a live session's fill — the one condition that is a real
  event and resolves on its own. Size still shows in the panel; it just no
  longer shouts.
- Fixed in **both** hosts. `src/tray/tray.ps1` computes the same rules inline,
  so a fix in `src/lib/tray-state.js` alone would have changed macOS and left
  every Windows tray red — the exact drift issue #3 exists to close.
- `praxis status` matched the same thresholds and is now calm too, so the two
  surfaces cannot disagree about the same project on the same machine. The
  memory row reads `at the cap, rotating` in sage instead of `near the cap` in
  red. The JSON `state` field (`healthy` / `filling-up` / `near-cap`) is
  unchanged — it is descriptive data for scripts, not an alarm.
- The suggestion text for `warning` and `limit` now talks about the session,
  since that is the only thing that can raise them.

## [0.11.0] — 2026-07-30

### Removed

- **`praxis cost` and `praxis roi` are gone. Use [ccusage](https://github.com/ryoppippi/ccusage)** —
  `npx ccusage`, or `npx ccusage monthly`. It reads the same local files, covers
  Codex and other agents too, and is simply better at it.
- **`praxis hud` is gone. Use [cctop](https://github.com/stefanprodan/cctop)** —
  `npx cctop`. Live session monitoring is a niche already served by seven
  maintained tools; ours was the weakest of them.
- All three were deprecated in 0.10.0 and printed a pointer for a full release
  before being deleted, which is the contract: sixteen shipped files run
  unpinned `npx -y praxis-memory`, so every release lands on every install
  automatically and a silent deletion would break somebody's script overnight.
  Running them now prints where to go and exits 1 — a removal is not a typo,
  and it does not deserve a "did you mean" guess.
- Why at all: keeping a weaker copy of somebody else's tool padded the tarball,
  padded the help, and diluted the one sentence this product exists to say. A
  real user called PRAXIS a side-project on the strength of them. PRAXIS is the
  evidence layer — receipts, the judge, the deck.

### Changed

- **Node 20 will no longer run PRAXIS.** `engines` has said `>=22` since 0.10.0,
  but the code stayed accidentally Node-20-runnable as an unadvertised grace
  period — deliberately one release long, because the auto-upgrading fleet
  means an old install pulls the newest version without asking. That grace ends
  here. Node 22, 24 and 26 are tested on every push, on all three platforms.

### Added

- **The tray companion now has a macOS host.** The axolotl lives in the menu
  bar, its glow tracking session health exactly as it does on Windows, with the
  same six emotions and the same precedence rules. Built on JavaScript for
  Automation driving AppKit — the scripting runtime macOS already ships, chosen
  for the same reason Windows uses PowerShell + WinForms: PRAXIS adds no runtime
  dependencies, and a menu bar worth installing must not cost more than the tool
  it decorates.
- **The tray's rules moved into `src/lib/tray-state.js`**, one implementation in
  plain JavaScript, unit-tested on any platform. Reimplementing the precedence
  ("a carry-over beats a live session beats the memory cap"; "a session idle for
  five minutes is history, not an alarm") a second time in a second language was
  the reliable way to end up with two trays that disagree. The macOS host asks
  this what to draw and draws it. Windows keeps its inline copy for now; where
  they differ, the JavaScript is right.

> **Not yet verified on macOS hardware.** This was written and tested on
> Windows: the state logic has 11 unit tests and its output was diffed against
> the shipped PowerShell host on a live project (identical). The AppKit layer —
> menu bar item, icon, menu, run loop — has never been executed on a Mac.
> Treat it as unproven until someone runs `praxis tray` on one.

## [0.10.1] — 2026-07-30

### Fixed

- **`praxis demo --live` never worked on macOS.** The throwaway sandbox is made
  under the system temp root, and on macOS that root is a symlink
  (`/var/folders` → `/private/var/folders`). The agent spawned with that cwd
  reported the resolved path while PRAXIS held the alias, so every lookup
  derived from the cwd — the transcript directory above all — computed two
  different names for one place. Live mode ended `nothing-sealed` with the
  agent's work sitting right there on disk. The sandbox path is now resolved
  with `realpathSync` before anything is derived from it. Windows and Linux
  were never affected; 0.10.0 shipped without this fix.

### Changed

- **Live judge certification no longer gates a release.** Running the shipped
  judge for real needs an API key held in CI, and this project does not keep
  one; a gate that cannot run — or that certifies some other model instead —
  is worse than no gate. The release chain is now test → pack-smoke →
  changelog gate → human approval → publish. The weekly drift monitor is
  retired for the same reason.
- Nothing about the judge itself changes. It is still opt-in, still one real
  model call on your own machine with your own login, and it still returns no
  verdict rather than inventing one. The seven iron-rule scenarios still run on
  every push against a recorded judge, CI still proves a canned stub judge
  *fails* them, and `node scripts/ci/run-live-evals.mjs` grades a live model on
  demand.

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
- **`demo --live` works on macOS.** The sandbox lived under a symlinked temp
  path, so the agent reported one cwd and PRAXIS derived the transcript
  location from another — live mode always ended "nothing was sealed" with
  the agent's work sitting right there. The sandbox path is resolved at
  creation now.

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
