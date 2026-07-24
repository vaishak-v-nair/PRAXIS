# TODOS

Deferred work with context. Added by /plan-ceo-review 2026-07-23 (receipts plan).
NOTE: this file references the unannounced receipts direction — keep untracked
until the 1.0 loud launch (site/story freeze applies to this file too).

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
