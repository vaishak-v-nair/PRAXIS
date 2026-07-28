# TODOS

Deferred work with context. Added by /plan-ceo-review 2026-07-23 (receipts plan);
tracked publicly since v0.9.2 — receipts shipped and the direction is announced
in the README. The website stays frozen until the 1.0 loud launch.

## P2 — macOS/Linux tray port

- **What:** Port the tray (verdict glow, ambient presence) beyond Windows.
- **Why:** Tray is Windows-only (PowerShell NotifyIcon); most Claude Code users
  are macOS/Linux — the ambient-trust story is invisible to the majority.
- **Pros:** Ambient layer for the whole install base; the "glance, green, merge"
  story becomes universally true.
- **Cons:** Per-OS presence stacks (menu bar app / appindicator); real effort;
  receipts work fine without it.
- **Context:** Tray v0.2 lives in src/tray/ (tray.ps1 + icons). Receipt verdict
  glow lands in the Windows tray first (E6). Port when receipts prove demand.
- **Effort:** L → with CC: M
- **Priority:** P2
- **Depends on:** receipts Phase 2 shipped; catch-rate data justifying it.

## P2 — `praxis statusline`: the ambient surface every OS can see

- **What:** A Claude Code statusline renderer — verdict of the latest receipt,
  session fullness, and job/inbox counts on the prompt line. Wired with one
  `statusLine` block in `settings.json`, exactly like the tray is wired with a
  hook.
- **Why:** the tray is Windows-only, so the ambient half of PRAXIS is invisible
  to most users, and the macOS/Linux tray port is L-sized. The statusline is the
  same ambient job at a fraction of the cost, cross-platform on day one — and
  `statusLine` is an official, documented extension point, so it cannot break
  the user's terminal the way stdout interception would.
- **Evidence it is a real channel:** ccstatusline (github.com/sirmalloc/ccstatusline)
  is a pure statusline formatter for Claude Code — no memory, no receipts, no
  orchestration — and has ~12.1k stars, 530 forks, 361 commits, distributed by
  `npx -y ccstatusline@latest`. That is not a competitor; it is proof that this
  audience installs ambient tools eagerly through exactly this door.
- **Pros:** first cross-platform ambient surface; a verdict badge on the prompt
  line is the cheapest possible "receipts exist" reminder; nothing to keep
  running (Claude Code invokes it).
- **Cons:** a second render path for state the tray already shows (must read the
  same cached breadcrumb, never re-parse receipt JSONL); statusline real estate
  is contested — users who already run ccstatusline will not switch for a badge,
  so the honest framing is "add a praxis segment", not "replace your statusline."
- **Context:** raised 2026-07-28 while reviewing ccstatusline. NOT taken into the
  launch gate: the gate is fixed at four conditions and week 1 stays pointed at
  it (review-scope cap, D66). This is the first candidate for the week after.
- **Effort:** S → with CC: XS-S
- **Priority:** P2
- **Depends on:** nothing technically. Sequencing: after the launch gate is met.

## P3 — GitHub App for Check Runs

- **What:** Real GitHub Check Runs (required-check gating) via a GitHub App.
- **Why:** v1 ships commit STATUS via user gh auth; teams wanting receipts as a
  required PR check need an App.
- **Pros:** Receipts become enforceable in team workflows — first fleets brick.
- **Cons:** App hosting/queue = first cloud component; identity/permissions work.
- **Context:** E4 deferred this explicitly; plan's NOT-in-scope names it.
- **Effort:** M → with CC: S
- **Priority:** P3
- **Depends on:** a team asking for it; fleets tier decision.

## P3 — Third-party trust anchors

- **What:** Key registry / transparency log so receipts prove to strangers, not
  just tamper-evidence to the keyholder.
- **Why:** SPEC v0 threat model is honest: keyholder can forge own receipts.
  Third-party proof is the ladder rung toward the evidence rail.
- **Pros:** Turns "trust me, it's signed" into "verify against the log" — the
  assurance ceiling depends on it.
- **Cons:** Infrastructure + governance; meaningless before receipts circulate.
- **Context:** Plan NOT-in-scope; outside-voice finding #3 documented the gap.
- **Effort:** L → with CC: M
- **Priority:** P3
- **Depends on:** receipts adoption; SPEC v1 stabilization.

## P3 — Non-JS/TS API-surface collectors

- **What:** Python/Go/Rust exported-surface diff collectors.
- **Why:** v1 API-surface heuristic is JS/TS-only; other ecosystems get
  judge-only coverage on surface claims.
- **Pros:** Deeper deterministic evidence per ecosystem.
- **Cons:** Per-language maintenance; judge already handles arbitrary claims.
- **Context:** Plan NOT-in-scope names the limit; spike showed claim types are
  heterogeneous anyway (browser-verified, deployed, links-checked).
- **Effort:** M → with CC: S
- **Priority:** P3
- **Depends on:** demand signal from non-JS users.

## Tray-art tarball split (deferred by CEO plan D21, 2026-07-27)
- **What:** Split the ~2.3MB of Windows tray animations out of the npm tarball; ship static icons, fetch animations on first tray launch with consent (~500KB tarball).
- **Why:** Every non-Windows install pays 2.3MB for art it can never render; npx cold-download is minute one of the demo conversion.
- **Pros:** Leanest possible first download; metered-connection friendliness.
- **Cons:** Adds a runtime fetch + consent path to stable tray code; contradicts the self-contained rule; today it is a 1-3 second problem.
- **Context:** CEO plan D21 (2026-07-27) chose budget-over-split: unpacked tarball budget <=3.5MB is enforced by the CI pack job (D14). This TODO fires only if the budget breaks or slow-network drop-off evidence appears.
- **Effort:** M -> with CC: S
- **Priority:** P3
- **Depends on:** the D21 budget actually breaking.

## Expire the Node-20 grace at 0.11.0 (eng review D58/D68, 2026-07-28)
- **What:** At 0.11.0, lift the D58 constraint (Node-22-only syntax becomes allowed); announce the grace expiry in that release's notes. Until then, 0.10.x PATCHES must also avoid 22-only syntax.
- **Why:** 0.10.0 advertises engines >=22 but stays Node-20-runnable as unadvertised grace, because 16 shipped hook/template files run unpinned `npx -y praxis-memory` and auto-pull latest onto old installs. The grace is deliberately ONE release; without this entry it either persists silently or gets broken accidentally by a mid-grace patch.
- **Pros:** The release-boundary commitment has an owner and an expiry; patch releases get an explicit warning.
- **Cons:** One more entry to groom.
- **Context:** CEO plan (2026-07-27) B2 row, D58 (eng review outside voice, 2026-07-28). Engines bump D22; matrix 22/24/26 per D37.
- **Effort:** XS (a release-notes line + lifting a constraint).
- **Priority:** P3
- **Depends on:** 0.10.0 shipped; fires at the 0.11.0 release ritual.

## Reserve praxis brand handles (CEO plan D30, 2026-07-27)
- **What:** Founder parks the brand names: X handle, GitHub org, domain sanity-check. Dormant - nothing posts from them (D5 launch is founder-voiced).
- **Why:** Launch visibility (B6) is exactly what alerts name-squatters; parking before launch is the only time the hedge works.
- **Pros:** ~30 founder-minutes prevents a squatter negotiation or rename later.
- **Cons:** One more account set to secure with 2FA; some handles may already be taken (partial coverage still helps).
- **Context:** D5 chose founder-led launch identity; this is purely defensive parking, best done before B6 (week 3, Aug 11-17).
- **Effort:** S (founder-only - account creation is a human task).
- **Priority:** P3
- **Depends on:** nothing; timing note: before B6.
