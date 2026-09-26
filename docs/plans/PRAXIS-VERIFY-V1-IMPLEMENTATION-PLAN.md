<!-- /autoplan restore point: C:\Users\vaish\.gstack\projects\praxis\main-autoplan-restore-20260922-170315.md -->

# PRAXIS Verify — v1 Product Spec (the public, paid product)

**Date:** 2026-09-22
**Status:** Ready to build. This is the product referenced as "PRAXIS Outcome Authority, Phase 1" across the prior planning documents, made concrete enough to ship.
**Relationship to prior docs:** This spec implements the Phase 0–1 sequence from `OPPORTUNITY-PORTFOLIO-PLAN.md`, uses the pricing model and Action-Contract primitives from `BILLION-DOLLAR-PRODUCT-THESIS-2026.md`, and honors the PRAXIS identity decision and competitive positioning locked in `FINAL-VERDICT-COMPETITIVE-VALIDATION-2026.md`. Nothing here contradicts those; this is the buildable slice.

---

## The one sentence

**Your agent said it was done. This is the receipt that checks.**

PRAXIS Verify sits between an AI coding agent and the merge button. When the agent claims a task is finished, PRAXIS extracts the specific claims, binds them to the exact commit, independently checks each one against the real code and test behavior, and issues a signed receipt — or blocks the merge with a precise list of what it couldn't confirm.

---

## What it is not, stated first, because this is where competitors will try to blur the line

- It is **not** a code review tool (that's CodeRabbit's and Qodo's sentence — they judge diff quality; PRAXIS judges whether a specific claim survived an independent check).
- It is **not** a formal-verification / "mathematically proven" product (that's Axiom's sentence, backed by $1.6B — never use that language).
- It is **not** a governance dashboard, an agent-memory tool, or a general AI-observability platform.
- It does **not** auto-repair code in v1. Repair comes after verification is trusted, not before.
- It does **not** block merges by default. It starts in observation mode on every repo until the team explicitly turns on gating.

---

## The core loop

```
1. TASK        — the original ask (GitHub issue, ticket, or prompt)
                        |
2. CLAIM        — the agent's "done" report is parsed into atomic,
   EXTRACTION     checkable claims: "added rate limiting to /login",
                  "fixed null pointer in checkout", "added coverage for X"
                        |
3. COMMIT       — every claim is bound to the exact commit SHA range
   BINDING        that supposedly implements it. No claim floats free
                  of a diff.
                        |
4. INDEPENDENT  — each claim is checked, never self-attested:
   VERIFICATION    a. static check — does the diff actually touch the
                       files/functions/paths the claim describes?
                    b. dynamic check — do the tests claimed to cover
                       this actually execute the changed code path,
                       or do they run past it?
                    c. false-success check — does the UI/API report
                       success with no real backend side effect; a
                       hardcoded static response; or a silent mock
                       fallback where a real API call should be?
                    d. supporting evidence — CI pass/fail is accepted
                       as corroboration, never as sole proof
                        |
5. VERDICT      — per claim, one of: VERIFIED, CONTRADICTED,
                  UNSUPPORTED, NEEDS_HUMAN_REVIEW.
                  States are never collapsed into one green check.
                        |
6. RECEIPT      — an Ed25519-signed, publicly verifiable record
                  binding: task, commit range, claims, verdicts,
                  evidence, verifier version, timestamp.
                        |
7. MERGE GATE   — comment-only by default; blocking is opt-in per repo.
```

This loop is the entire product. Everything below is interface, packaging, and pricing around it.

---

## Interfaces

The front door is one command. Everything else is something a user adds *after* it has already proven itself on their own code — never a requirement before that first moment.

```
npx praxis verify
```

Zero install, zero account, zero config. Run inside any repo, checks the most recent AI-agent-authored commit, returns a verdict in under a minute. The single most important product decision in this spec is that nothing stands between a new user and their first real catch — no signup wall, no setup wizard. If it can't prove itself in one command, it hasn't earned the right to ask for more.

| Surface | When a user reaches for it |
|:---|:---|
| **CLI (`npx praxis verify`)** | Day one, zero-friction, the only required step. |
| **GitHub App** | Added once the CLI has already caught something real — turns the same check into a PR gate. |
| **MCP proxy** | Added once a team wants verification inline during the agent session, not only at PR time. |
| **PRAXIS Companion** | Added once daily use is established — the visible, habit-forming surface described below. |
| **Public receipt explorer** | Automatic from the first run — every receipt gets a shareable link, no separate setup. |

---
| **MCP proxy** | Sits in front of Claude Code, Cursor, or any MCP-compatible agent so verification runs *during* the session, not only at PR time — catches a false "done" before the developer ever sees it. |
| **Public receipt explorer** | A shareable link per receipt (e.g. `praxis.dev/r/<hash>`). Doubles as the trust artifact and as free distribution — every shared receipt is a product demo. |
| **PRAXIS Companion** | A lightweight, always-open daily surface (desktop tray + optional terminal panel) that turns the verification loop from something that happens *behind* the agent into something the developer watches happen *with* them, live, every session. Detailed below. |

---

## PRAXIS Companion — the visible daily surface

A GitHub PR comment is correct, but nobody forms a habit around a PR comment. Cursor's $2B ARR in 2026 is the clearest evidence in this whole research trail that developers pay for and live inside tools they *open and watch*, not tools that quietly check their work from the background. PRAXIS Companion is the answer to that, without inventing new research: it makes four capabilities already inside the verification loop visible instead of hidden. None of these are new frontier-AI research — each is a UI decision applied to a mechanism that already exists in this spec.

| Concept | What it already is in the engine | What becomes visible in the Companion |
|:---|:---|:---|
| **Theory of Mind** | Claim-extraction already separates what the agent believes it did from what the task actually asked for. | A live divergence indicator — "you asked for X, the agent is claiming Y" — shown as it happens, not only at merge time. |
| **True Causal Reasoning** | A CONTRADICTED verdict already has a specific reason inside the evidence chain. | The reason is surfaced as a one-line causal trace ("test at line 47 exercises path A, not the path this diff touches") instead of a flat red X. |
| **Self-Aware / Reflective** | The evidence hierarchy already refuses to mark something VERIFIED on an LLM's self-report alone. | An honest, visible confidence readout per claim — the one tool in the daily workflow that says "unable to confirm" instead of faking certainty. |
| **Neuro-Symbolic Integration** | Causalyn's κ-engine/Z3 checks already exist for checkable properties (types, schemas, injection patterns). | A per-check badge showing *how* it was verified — symbolic proof, pattern match, or needs-human — so confidence is never presented as uniform when it isn't. |

The mascot (the axolotl already designed for the original PRAXIS tray app) becomes the glanceable embodiment of all four signals at once — idle, working, warning, contradiction — the same at-a-glance habit as a build-status icon, but honest about uncertainty instead of binary pass/fail. This is a revival of the tray app's *interface*, not the memory tool it used to represent — the identity retired in the prior planning section stays retired; what returns is the visible surface, now attached to the verification engine instead of to session memory.

**Companion ships in every tier, including Free.** It is the growth engine, not a paywalled feature — receipt history, blocking gates, and audit export remain the paid layer behind it, per the pricing table above.

---

## Why PRAXIS is not an agent and not an orchestrator, and stays that way

Two adjacent categories are tempting to drift into, and both are now occupied by well-capitalized incumbents, so this is a deliberate, permanent boundary, not a temporary one:

- **AI coding agents** (Claude Code, Codex, Cursor, Windsurf, Devin, Antigravity) are built by frontier labs on top of their own foundation models. Competing here means competing with Anthropic, OpenAI, and Google on their own ground — the same category error already ruled out for research capabilities, relocated to a different layer.
- **AI agent orchestrators** — running several coding agents in parallel and watching status from one dashboard — are also now a live, funded category (Superset, Conductor, Tembo), and as of May 2026 Anthropic ships this natively inside Claude Code itself ("Agent View": every parallel session, who's waiting on input, launched alongside 20-specialist multi-agent orchestration). Building an orchestrator means racing a platform owner's free, zero-marginal-cost feature — the same platform-risk pattern already on record for agent memory (Cloudflare) and agent governance (Microsoft).

What none of Claude Code, Codex, Cursor, Superset, Conductor, Tembo, or Agent View do: tell you whether a "done" status is *true*. Every one of them reports session state — running, waiting, idle, complete. Not one independently checks a completion claim against reality. That gap is untouched, it is the entire reason this product exists, and it is bigger than a per-repo feature — it is the one axis that stays valuable no matter how many new agents or orchestrators ship, because it is orthogonal to all of them by construction: agent-agnostic, orchestrator-agnostic, sitting across whatever fleet of tools a developer is already running.

## PRAXIS Truth Board — the command-center version of the Companion

The Companion above levels up from a passive per-PR checker into a standalone surface built to be opened as often as Agent View or Superset's dashboard — same prestige tier, orthogonal function:

- **Live claim board** across every agent and orchestrator in use — not "5 agents, 3 running, 2 idle" but "12 claims made today, 9 verified, 2 contradicted, 1 unsupported," refreshed as sessions complete.
- **Natural-language query against the evidence graph** — "what's actually proven working today versus just claimed?" — answered from receipts already on file, not a fresh guess.
- **Cross-agent reconciliation** — when Claude Code claims X is done and Codex claims Y is done on the same repo, the Truth Board is the one place showing what's actually verified across both, since neither agent has any structural reason to check the other's work.
- **A visible trust score per repo/session** at a glance, functioning like a build badge that is allowed to say "unverified" instead of always showing green.

This is still the same engine, the same Action Contract data model, the same pricing tiers above — it is a bigger, more central surface for the identical underlying receipts, not a new product line.

---

## Pricing — public, paid, live from day one

Priced deliberately in the same band as CodeRabbit and Qodo so it reads as a real, in-market product rather than an experiment, while keeping the open core that the defensibility strategy depends on.

| Tier | Price | Includes |
|:---|:---|:---|
| **Free / Open** | $0 | Unlimited public repos. Verifier and receipt format are open-source and self-hostable. Community support. This is the distribution and trust layer — the open verifier stays useful with or without the hosted product. |
| **Pro** | $29/seat/month | Private repos, hosted receipt history, GitHub App + CI check, MCP proxy, unlimited claim-extraction, Slack/email alert on any CONTRADICTED verdict. |
| **Team** | $79/seat/month | Everything in Pro, plus multi-repo dashboard, opt-in blocking-mode gates, weekly false-success digest, audit-log export, priority processing. |
| **Business** | From $25,000/year | Private/self-hosted deployment or customer-managed keys, SSO, custom postcondition packs, SLA, security-review support. Not actively sold at launch — this tier exists to catch inbound enterprise interest and is the doorway into Phase 2, not the v1 focus. |

The Free tier is not a funnel gimmick — it is a structural requirement. Open-sourcing the verifier is what makes "independent" credible (a closed verifier that only the vendor can run is a weaker trust claim than one anyone can audit), and it is the distribution engine the launch sequence below depends on.

---

## Build plan — mapped to what already exists

**Reuse directly:**
- PRAXIS's existing Node.js CLI and its zero-runtime-dependency discipline
- The receipt-signing module — upgraded from HMAC to Ed25519 (per the correction already on record: HMAC only proves integrity to parties sharing the secret, it is not a public signature)
- `scanner.py` / `reality.py` / `harness.py` from the ReGen workbench backend — this is already most of the static-check and false-success-detector logic the loop needs, ported into the claim-verification engine rather than left as a separate "workbench" product

**Build new:**
- GitHub App (webhook receiver + PR check API)
- Claim-extraction pipeline (LLM-assisted parsing of a "done" report into atomic, checkable claims)
- Public receipt explorer (a simple hosted page, not a dashboard product)
- MCP proxy adapter for Claude Code / Cursor / Codex / Gemini

**Explicitly deferred, not deleted:**
- Causalyn's κ-engine and Z3 formal verification. Not required for v1's loop, which is deterministic pattern-matching plus LLM-assisted claim parsing, not formal proof. It re-enters later as an optional, narrow postcondition class ("no SQL injection introduced in this diff") — a feature, never the headline, and never marketed as "mathematically proven."
- Auto-repair. Comes after the verification trust is established, not before — repairing before the checker is trusted is the specific failure mode the thesis document's kill criteria warn against.

---

## Launch sequence — dogfood first, distribution as equal effort to the build

2026 data on solo-builder outcomes is blunt about the actual failure mode: for a quarter of Y Combinator's Winter 2025 batch, 95% of code was AI-generated — building collapsed in cost across the board, and the founders who got real users were the ones who spent as much effort on distribution as on the build, not the ones who built more. Paid ads and "launch on Product Hunt" alone do not produce that outcome; build-in-public and founder-led content do, because they cost time instead of money and compound instead of decaying. This sequence is built around that finding, not around a generic launch checklist.

1. **Dogfood before any outside user sees it.** Run PRAXIS Companion daily against real, already-in-progress agent-built work — Ingot, Gurutva, Nimbus, PRAXIS itself. This is both the cheapest possible validation and the source of every piece of distribution content that follows. If it doesn't earn a place in a daily workflow for its own builder, it isn't ready to ask that of anyone else.
2. **Every caught false-success becomes a post, not a private bug report.** The public receipt explorer already produces the exact artifact this needs — "agent claimed X, here's the receipt showing it didn't" — posted where builders already are (X, Indie Hackers, relevant subreddits), consistently, not as a single launch moment. This is authentic byproduct content, not manufactured marketing.
3. **The demo is founder-led, not a generic product tour — this is a requirement, not a style choice.** Founder-led content is one of the two channels proven to compound for a solo builder; a faceless demo video is marketing, the same demo run live by the person who felt the problem is evidence.
   - **Short cut (60–90 seconds, for X/Indie Hackers):** cold open on camera — *"I asked my agent to fix a bug. It said done. I almost shipped it."* — cut to terminal, run `npx praxis verify` against a real project, show the claim extracted and the contradiction caught live, unedited. Close on the receipt and one line: *"It doesn't just believe the agent. It checks."*
   - **Long cut (3–5 minutes, for Hacker News):** same opening, then narrate the full loop against a real repo, including a claim that verifies clean — not only failures, so it's evidently not staged — and close with the pitch paragraph from the founder narrative document, delivered in your own words.
   - Both cuts run against Ingot, Gurutva, or Nimbus — real, already-shipped, agent-built work — never a synthetic demo repo built only to look good on camera.
4. **Five design partners**, recruited from that same audience once the daily-use pattern is real, each contributing one genuine false-success or duplicate-action incident as the seed evidence set for the public "False Done Challenge" demo.
5. **Broader distribution follows the audience, not a launch calendar** — Hacker News, Product Hunt, Indie Hackers, and dev-focused subreddits and X/LinkedIn communities get the same receipt-based artifacts, tailored per community, once there is a real daily-use track record to show rather than a plan to describe.
6. No purchased engagement, no invented testimonials, no benchmark numbers published without a reproducible workload attached — unchanged from the standing rule.

Expect the distribution side to take months of consistent posting before it compounds — there is no AI shortcut for that part specifically, even though the build itself can now happen in days.

---

## Success criteria (same exit gates already defined — restated as the launch scorecard)

- 20 repositories using it weekly
- 5 teams still active after 4 weeks
- At least 3 confirmed false-success events caught that ordinary CI/review missed
- Time to first useful verdict on a new repo under 15 minutes
- 30%+ of installed repos still active weekly after 4 weeks

Miss these and the kill criteria already on record apply — that discipline doesn't relax just because the product is now concrete enough to ship.

## AUTOPLAN PHASE 1 — CEO REVIEW

### Review mode and evidence

Mode: **SELECTIVE EXPANSION**. UI scope: yes. Developer-facing scope: yes. Base branch: `main`.

The review inspected `src/lib/receipt/{store,record,judge,collectors,render}.js`, `RECEIPT-SPEC.md`, CLI dispatch, Workbench `scanner.py`, `reality.py`, `harness.py`, backend security rules, package metadata, tests, prior strategy documents, and repository history. The gstack snapshot helper could not run because this installation lacks `bun`; the source spec and restore copy were read directly instead.

Codex outside review: unavailable because this session is already running under Codex (`CODEX_THREAD_ID` present), so spawning a nested Codex review would violate the harness boundary. Independent in-host reviewer: completed with 14 findings.

### Premise challenge

| Premise | Assessment | Evidence | Disposition |
|---|---|---|---|
| Receipt signing must be upgraded from HMAC to Ed25519 | **Clearly wrong** | `store.js` and `RECEIPT-SPEC.md` already implement Ed25519 v2 with an embedded SPKI public key | Final-gate challenge; do not rewrite existing receipts |
| `npx praxis verify` is an ownable zero-install command | **Feasibility blocker** | npm package is `praxis-memory`; `praxis` is only its installed bin alias | Final-gate challenge |
| The most recent AI-authored commit is reliably detectable | **Unsupported** | Git has no standard AI provenance; existing adapters support only specific transcript formats | Final-gate challenge |
| Any repository can receive a useful dynamic verdict in under one minute | **Overbroad** | projects may need dependencies, services, browsers, databases, secrets, or long suites; execution requires trust | Final-gate challenge |
| Every receipt can automatically receive a public URL | **Security/privacy conflict** | current contract keeps receipts local and makes sharing explicit | Final-gate challenge |
| Claim accountability is a distinct wedge from generic code review | **Sound** | existing receipt judge already separates claims from deterministic evidence | Retain |
| Observation mode precedes merge blocking | **Sound** | reduces false-blocking risk while the evaluator is calibrated | Retain |
| Workbench false-success checks can be reused directly | **Partly sound** | Python AST checks exist, but they are language-limited heuristics and use a separate evidence ledger | Reuse through a versioned adapter, not direct receipt relabeling |

### What already exists

| Sub-problem | Existing implementation | Reuse decision |
|---|---|---|
| Tamper-evident public signature | `src/lib/receipt/store.js`, schema v2, Ed25519 + embedded public key | Reuse unchanged |
| Receipt verification | `verifyEntries`, `verifyFile`, `praxis receipt verify` | Reuse unchanged |
| Claim-source extraction | `collectClaimProse` and command/commit-message harvesting | Extend through canonical claim normalization |
| Evidence collection | session-scoped command/file collectors and shared repo-state collector | Extend with command outcomes, SHA binding, and check observations |
| Independent judge | neutral working directory, injectable command, strict JSON parser, bounded retry | Keep as advisory normalization/classification; deterministic policy owns final state |
| Honest verdict rollup | existing TRUE/FALSE/UNVERIFIABLE/NOT_A_CLAIM and headline states | Preserve for compatibility |
| False-success signals | Workbench `reality.py` Python AST checks | Adapt as optional observation providers |
| Safe model file tools | Workbench `ExecutionHarness` with path bounds, hashes, and evidence | Reuse patterns; verifier does not receive repair tools |
| Untrusted project intake | Workbench snapshots, exclusions, runtime-trust gate, budgets | Preserve for optional deep mode |
| Agent integration | Claude/Codex adapters, generic agent adapters, MCP server | Reuse evidence handoffs where transcript support is established |
| Tray surface | existing cross-platform tray machinery and mascot states | Retain as later surface pending gate decision |

### Dream-state delta

```text
CURRENT
  session transcript -> attempt evidence -> optional LLM judge -> signed receipt

THIS PLAN
  task + explicit handoff -> canonical claims -> exact SHA range
  -> policy-selected observations -> deterministic sufficiency rules
  -> compatible signed receipt -> observation/merge decision

12-MONTH IDEAL
  portable action contract -> independently sourced observations
  -> policy/versioned outcome oracle -> settlement receipt
  -> enterprise identity, audit history, disputes, compensation, cost optimization
```

The v1 engine closes claim identity, SHA binding, evidence sufficiency, and reproducible check execution. It does not establish third-party signer identity, universal behavioral proof, or hosted enterprise governance.

### Implementation alternatives

| Approach | Human effort / agent effort | Advantages | Risks | Decision |
|---|---|---|---|---|
| Rewrite verification as a hosted Python service | 8–12 weeks / 2–3 days | Direct Workbench reuse | Splits the zero-dependency CLI, forces account/network, duplicates receipt semantics | Reject |
| Add a zero-dependency Node outcome engine with optional Python observation adapter | 4–7 weeks / 1–2 days | Preserves CLI and receipt compatibility; uses Workbench heuristics without coupling core installs | Cross-runtime adapter needs strict schemas | **Selected** |
| Keep the existing LLM judge and only rename `receipt --verify` | 1–2 weeks / hours | Fastest demo | Cannot bind exact diffs, execute predicates, or support reliable merge gating | Reject |

### Full architecture

```text
Developer / supported agent adapter / CI
                |
                v
       Verification Intake
 task + report + base/head SHA + trust/budget
                |
                v
       Canonical Claim Engine
 source text -> atomic predicate -> scope -> stable claim id
                |
                v
       Verification Planner
 policy + repo facts -> required observation DAG
      /             |                 \
 static providers   trusted runner     external evidence
 git/diff/AST        tests/probes       SHA-bound CI/checks
      \             |                 /
                v
       Evidence Sufficiency Engine
 deterministic rule per claim + explicit coverage gaps
                |
                v
 Existing receipt v2 recorder and Ed25519 signer
                |
       +--------+--------+
       |                 |
 local CLI result   observation-mode GitHub check
                         |
                  opt-in merge gate

Optional later adapters: hosted receipt store, explicit sharing,
MCP proxy, Companion, Truth Board. All consume the same claim/evidence schema.
```

Before: transcript collectors call the receipt judge directly. After: existing receipt capture remains unchanged; `verify` becomes an additive path that can link a verification run to a receipt without changing historical files.

### Four data paths

```text
HAPPY: task/report/SHA -> validate -> normalize claims -> plan checks
       -> collect observations -> apply policy -> sign -> render

NIL:   missing task/report/SHA -> stop before model/check execution
       -> exit 2 + field-specific guidance; no receipt claiming verification

EMPTY: present but no atomic claim -> NO_CLAIMS result
       -> signed evidence record may state no claims; merge gate remains neutral

ERROR: provider/check/CI unavailable -> record typed observation failure
       -> affected claims UNVERIFIABLE/PARTIAL; never substitute success
```

### Verification-run state machine

```text
CREATED -> VALIDATED -> CLAIMS_READY -> PLANNED -> RUNNING -> EVALUATED -> SEALED
   |          |             |             |          |          |
   +->REJECTED+->REJECTED    +->NO_CLAIMS +->CANCELLED+->PARTIAL
                                            \->TIMED_OUT

SEALED is immutable. A retry creates a linked attempt/version.
Blocking is invalid before EVALUATED + policy sufficiency + SEALED.
A failed or unavailable observation cannot transition a claim to TRUE.
```

### Section 1: Architecture review

**Finding:** the spec treats claim extraction, evidence collection, interpretation, signing, and publishing as one loop without a versioned boundary. **Auto-decision:** create four explicit schemas: verification handoff, canonical claim, observation, and verification result. The existing receipt remains the signed container. This keeps LLM output untrusted until schema validation and policy evaluation.

**Finding:** direct reuse of Workbench evidence would merge two ledgers with different guarantees. **Auto-decision:** use a subprocess adapter emitting bounded JSON observations and adapter version; PRAXIS signs only what it observed and labels the source. Workbench jobs are never silently converted into receipts.

Scaling: at 10×, dynamic runners and model claim extraction saturate first. At 100×, queue fairness, per-tenant budgets, and hosted receipt retention become the limits. V1 local mode bounds concurrency to one verification run per repository and caps file count, bytes, claims, model tokens, subprocess duration, and observation count.

Rollback: the new command and GitHub status run in observation mode behind additive configuration. Rollback disables the adapter and removes the new command dispatch; existing receipt schema, hooks, memory, Workbench, and historical data remain readable.

### Section 2: Error & Rescue Registry

| Codepath | Failure | Typed result | Rescue | User sees |
|---|---|---|---|---|
| intake | not a Git repository | `NOT_A_REPOSITORY` | stop before extraction | exact path guidance |
| handoff loader | missing/empty task or report | `INVALID_HANDOFF` | list missing fields | no verification receipt |
| SHA binder | invalid, missing, or reversed range | `INVALID_RANGE` | reject; never guess silently | base/head correction command |
| SHA binder | dirty tree conflicts with selected head | `DIRTY_TREE` | static mode may continue only if explicitly scoped; dynamic mode stops | affected files and remedy |
| claim extractor | model unavailable/timeout | `EXTRACTOR_UNAVAILABLE` | deterministic sentence splitter fallback marked low-confidence, or stop by policy | extraction method and limitation |
| claim extractor | malformed/refusal/empty JSON | `EXTRACTION_INVALID` | one bounded repair attempt, then unsupported | no invented claims |
| claim normalizer | duplicate/overlapping claims | `AMBIGUOUS_CLAIMS` | merge exact duplicates; retain conflicts for human review | candidate claims |
| planner | no provider for predicate | `NO_OBSERVER` | mark UNVERIFIABLE | missing observer named |
| static adapter | unsupported language/large file/parser error | `STATIC_INCOMPLETE` | record coverage gap | files/checks skipped |
| trusted runner | trust absent | `TRUST_REQUIRED` | do not execute | exact opt-in command |
| trusted runner | timeout/cancel/nonzero exit | typed execution observation | capture bounded redacted output and status | command, exit class, duration |
| CI importer | wrong SHA/stale/missing auth | `CI_NOT_APPLICABLE` | exclude from sufficiency | expected and observed SHA |
| evidence policy | conflicting observations | `EVIDENCE_CONFLICT` | NEEDS_HUMAN_REVIEW/PARTIAL | conflict sources |
| receipt linker | signing/write failure | `RECEIPT_FAILED` | verification result remains unsealed and cannot gate | retry path; no green status |
| share adapter | network/auth/storage failure | `SHARE_FAILED` | keep local receipt intact | local path and failure category |

No catch-all may convert these failures to success. Logs include run ID, claim ID, provider/check ID, phase, duration, and redacted category, never source contents or secrets by default.

### Section 3: Security and threat model

| Threat | Likelihood | Impact | Required mitigation |
|---|---|---|---|
| Malicious repository content injects the claim model | High | High | Treat repository/report text as data, use strict schemas, no tools for extraction, adversarial fixtures |
| Verifier executes submitted code without trust | Medium | High | Static mode by default; explicit trust and allowlisted commands for dynamic mode |
| Receipt shares paths, source, secrets, or private metadata | High if automatic | High | Local by default, redaction before persistence, payload preview, explicit sharing only pending gate |
| Attacker supplies another user's receipt ID | Medium in hosted mode | High | Tenant-scoped authorization, unguessable hosted IDs, object-level access checks |
| CI evidence refers to another SHA | Medium | High | cryptographically bind provider, repo, workflow, job, and exact head SHA |
| Agent modifies verifier policy or tests in same change | Medium | High | report policy/config diffs, protected baseline, independent checkout for deep mode |
| Local signer key is replaced | Low | Medium | display fingerprint continuity; Business mode later adds managed custody/rotation |
| Symlink/path traversal escapes repository | Medium | High | reuse Workbench resolved-path, symlink, reserved-name, and size checks |
| Hosted webhook replay/forgery | Medium | High | signature validation over raw body, delivery-id idempotency, timestamp bounds |
| Unbounded model/check use drains budget | Medium | Medium | one shared budget, reservation before calls, conservative ambiguous-failure accounting |

The signature authenticates the local key, not objective truth. Every result must bind policy version, verifier version, repository tree hash, base/head SHA, observation digests, execution environment, and signer fingerprint.

### Section 4: Data-flow and interaction edge cases

```text
HANDOFF -> schema validation -> claim normalization -> claim IDs
   | invalid/oversize       | duplicate/conflict
   v                        v
 reject before model      merge exact / human-review conflict

CLAIM -> observer DAG -> bounded observations -> policy evaluation
   | no observer       | timeout/nonzero/stale       | disagreement
   v                   v                             v
 UNVERIFIABLE       partial evidence             human review

RESULT -> existing signer -> atomic receipt/link write -> renderer/gate
   | signing error       | concurrent same run       | renderer failure
   v                     v                           v
 no gate success       idempotent winner           raw receipt retained
```

Concurrency rules: derive a run key from repo identity, base/head SHA, normalized handoff digest, and policy version. An in-process lock prevents duplicate local runs; hosted mode later requires a unique database key. Cancellation stops new observers and terminates owned subprocess trees. Completed observations remain recorded as partial evidence. A newer push makes an older PR result stale and non-blocking.

### Section 5: Code quality

Create small modules under `src/lib/verify/`: `handoff.js`, `claims.js`, `planner.js`, `policy.js`, `observations.js`, `runner.js`, and `result.js`, plus a thin `src/commands/verify.js`. Reuse `redact`, stable serialization, receipt signing, subprocess helpers, and current UI primitives. Keep provider adapters behind plain functions returning schema-validated objects. Avoid a general plugin framework in v1; an explicit observer registry is easier to audit.

No core runtime dependency is added. Optional Python checks remain inside `apps/workbench` and communicate by bounded JSON over stdio. The Node engine remains useful without Python.

### Section 6: Test map

```text
UX FLOWS
  local static verify -> unit + CLI integration
  trusted dynamic opt-in -> integration + Windows process-tree test
  observation GitHub result -> contract tests with recorded fixtures
  explicit receipt sharing (pending gate) -> auth/privacy integration

DATA FLOWS
  handoff -> claims -> observer DAG -> result -> receipt
  CI payload -> SHA validation -> observation
  Workbench JSON -> adapter validation -> observation

CODEPATHS
  nil/empty/oversize/malformed handoff
  ambiguous SHA and dirty tree
  valid/invalid/refused/timeout extraction
  observer missing/timeout/cancel/nonzero/conflict/stale
  policy sufficient/insufficient/contradicted
  signing/write/render failures

ASYNC
  cancellation during observer
  duplicate run
  head SHA changes during run
  budget exhaustion with queued observers

EXTERNAL
  model provider, git, project command, CI API, optional hosted store
```

Required eval corpus: supported success, contradicted claim, missing evidence, stale test, irrelevant green test, hardcoded success, silent mock fallback, partial implementation, ambiguous prose, prompt injection, unsupported language, malicious repository, timeout, cancellation, conflicting observers, stale SHA, and policy/verifier modification in the evaluated diff. Merge blocking remains unavailable until the false-contradiction floor is zero on the release corpus and deterministic sufficiency coverage is reported.

Friday-2am test: a malicious fixture claims tests passed, includes a green unrelated test, changes the verifier config, and times out the relevant probe; result must be non-green, signed, reproducible, and explain every skipped observation. Chaos test: kill the runner between observations and during receipt write; rerun must not mutate a sealed receipt or report verified.

### Section 7: Performance

Targets for local static mode: startup under 500 ms warm, claim extraction excluded from the deterministic baseline, 95th-percentile static plan under 30 seconds for 10,000 files/20 MiB staged input, and peak verifier memory under 256 MiB. Dynamic checks use an explicit timeout and stream bounded output. Hashes and parsed-file results may cache only by content digest plus observer version. Never cache a verdict across policy, task, claim, SHA, or environment changes.

Slowest expected paths: model extraction, repository graph parsing, and project test execution. Metrics report them separately so a fast static pass cannot hide an unfinished deep pass.

### Section 8: Observability and debuggability

Each run emits local structured events: `run_created`, `handoff_validated`, `claims_ready`, `observer_started/completed/failed`, `policy_evaluated`, `receipt_sealed`, and `gate_reported`. Common fields: run ID, claim ID where applicable, repo fingerprint, base/head SHA, observer/policy/verifier versions, duration, outcome category, and redacted error class. Source, prompts, command output, paths, and claims are not sent through telemetry.

Day-one metrics: time to first verdict, claims per run, verified/failed/unverifiable distribution, observer coverage, false-contradiction corrections, stale-run count, extraction failure rate, dynamic-trust opt-in, cancellation rate, and receipt-seal failures. Local `--debug` exports a redacted diagnostic bundle. Every non-green result explains whether the cause was contradiction, missing evidence, unsupported observer, stale state, or infrastructure failure.

### Section 9: Deployment and rollout

1. Ship schemas, engine, fixtures, and CLI behind an additive `verify` command.
2. Dogfood in observation mode on PRAXIS and real agent-built repositories.
3. Publish reproducible corpus scores and limitations.
4. Add GitHub status/comment adapter without required-check enforcement.
5. Enable per-repository blocking only after explicit opt-in and calibration thresholds.
6. Consider hosted sharing, Companion, MCP proxy, and Truth Board after final-gate and adoption evidence.

No database migration is required for the local engine. Historical receipt fixtures must remain green. Rollback removes the new dispatch and GitHub status while leaving new receipts readable through the existing verifier.

### Section 10: Long-term trajectory

Reversibility: 4/5 if schemas are additive and existing receipts remain canonical; 2/5 if the product renames verdicts, auto-uploads receipts, or couples core verification to the Workbench service. The canonical claim record is the platform asset: stable ID, source text, normalized predicate, scope, SHA range, evidence requirements, observations, verdict, policy, human override, and receipt linkage.

The v1 engine should later support action contracts and settlement receipts without making identity, policy, telemetry, or hosted storage mandatory for local use.

### Section 11: Design and UX

```text
run verify
   |
   +-> invalid input -> precise correction
   |
   +-> claim extraction -> review exact claims + SHA range
   |                         |
   |                         +-> ambiguous -> user confirms/edits
   v
observer progress -> per-claim evidence method and coverage
   |
   +-> contradiction -> causal trace + evidence
   +-> insufficient -> missing observer/check + next action
   +-> supported -> evidence source + freshness
   v
signed local receipt -> optional observation PR status
```

State coverage:

| Surface | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| CLI | phase + elapsed time | `NO_CLAIMS` | typed fix | per-claim table + receipt | explicit coverage gaps |
| GitHub | check pending | neutral | infrastructure failure separate from contradiction | observation success | neutral/action-required |
| Companion | working mascot | idle/no run | connection/problem state | supported claims count | mixed verdict count |
| Truth Board | skeleton | no receipts onboarding | source unavailable | cross-repo claims | stale/unverified filters |

Accessibility: verdict meaning is carried by words and symbols, not color; terminal output honors `NO_COLOR`; every graphical state has keyboard and screen-reader text; causal traces wrap without horizontal scrolling. Mobile receipt viewing is readable, while deep administration remains desktop-first.

### NOT in scope for the engine milestone

- Auto-repair, because verifier trust must precede repair.
- General agent orchestration or coding-agent execution.
- Z3/formal verification as a headline; later observers may use it for narrow predicates.
- Third-party identity proof or transparency log.
- General compliance automation, billing marketplace, or care workflows.
- Automatic execution of untrusted project commands.
- Claims of mathematical proof, comprehensive security, or AI authorship detection.

### Failure Modes Registry

| Codepath | Failure mode | Rescued? | Test? | User sees? | Logged? |
|---|---|---:|---:|---:|---:|
| handoff | missing/ambiguous provenance | Yes | Required | exact ambiguity | Yes |
| extractor | malformed/refusal/timeout | Yes | Required | extraction unavailable | Yes |
| SHA binder | stale/mismatched head | Yes | Required | stale result | Yes |
| static observer | unsupported/truncated parse | Yes | Required | coverage gap | Yes |
| dynamic runner | trust absent | Yes | Required | trust requirement | Yes |
| dynamic runner | timeout/nonzero/cancel | Yes | Required | typed observation | Yes |
| CI importer | wrong SHA/forged payload | Yes | Required | excluded evidence | Yes |
| policy | no sufficient evidence | Yes | Required | UNVERIFIABLE/PARTIAL | Yes |
| policy | contradictory observations | Yes | Required | human review | Yes |
| signer | key/write failure | Yes | Required | cannot gate | Yes |
| hosted share | privacy/auth/network error | Pending gate | Required if accepted | local receipt preserved | Required |
| webhook | replay/duplicate delivery | Required for App | Required | idempotent prior result | Required |

No row is allowed to remain `Rescued=No`, `Test=No`, and silent.

### Temporal interrogation

- **Hour 1:** add schema fixtures and compatibility tests before production code.
- **Hours 2–3:** build handoff, SHA binding, canonical claims, observation registry, and deterministic policy.
- **Hours 4–5:** add static observers, trusted runner, receipt linking, and CLI rendering.
- **Hour 6+:** dogfood corpus, GitHub observation adapter, hosted or visual surfaces only after core thresholds.

### CEO dual-voice consensus

| Dimension | Primary review | Independent reviewer | Consensus |
|---|---|---|---|
| Premises valid? | Four blockers | Same four plus trust-model gaps | Confirmed |
| Right problem? | Yes: claim accountability | Yes | Confirmed |
| Scope calibrated? | Too many surfaces before engine trust | Same | Confirmed, queued user challenge |
| Alternatives explored? | Node core + optional Python adapter selected | Same core-first direction | Confirmed |
| Market risks covered? | Generic CI/review positioning risk | Same | Confirmed |
| Six-month trajectory? | Canonical claim must be stable core | Same | Confirmed |

Outside Codex coverage remains unavailable due the active Codex host. Consensus above compares the primary review with the independent in-host reviewer, not a different provider.

### User challenges queued for the final gate

1. Replace or condition the launch command because `npx praxis verify` resolves a package PRAXIS does not own.
2. Correct the Ed25519 premise and preserve receipt v2 instead of performing a nonexistent HMAC migration.
3. Replace automatic public URLs with explicit sharing and payload preview.
4. Replace automatic AI-authored-commit detection with a versioned handoff plus visible ambiguity resolution.
5. Split the one-minute promise into bounded static and trusted/deep verification modes.
6. Narrow the first shippable surface to engine + CLI + GitHub observation check; phase Companion, Truth Board, and generic MCP proxy after verification quality is proven.

The original spec remains controlling until these challenges are explicitly accepted at the final gate.

### Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | CEO | Reuse receipt v2 and add linked verification artifacts | Mechanical | DRY | Ed25519 and portable verification already ship | HMAC migration |
| 2 | CEO | Canonical claim is the shared core object | Mechanical | Complete | Prevents CLI/GitHub/MCP/Workbench divergence | Surface-specific claim shapes |
| 3 | CEO | Node zero-dependency engine with optional Python observer adapter | Auto-decided | Explicit | Preserves CLI contract and isolates optional dependencies | Hosted rewrite |
| 4 | CEO | Deterministic policy owns sufficiency; LLM only extracts/classifies | Auto-decided | Complete | Model self-report cannot establish truth | Model-only verdict |
| 5 | CEO | Protected SHA-bound CI may be primary evidence when directly relevant | Auto-decided | Pragmatic | Repository-owned checks can be stronger than generic heuristics | Always-secondary CI |
| 6 | CEO | Build labeled eval corpus before blocking merges | Auto-decided | Complete | Gating amplifies classifier errors | Gate before calibration |
| 7 | CEO | Preserve runtime trust, shared budgets, redaction, and separate ledgers | Mechanical | Complete | Existing security contracts remain required | Direct Workbench ledger relabeling |
| 8 | CEO | Six spec conflicts go to final approval | User Challenge | User sovereignty | Both reviews recommend changing explicit product directions | Silent amendment |

### CEO completion summary

| Item | Result |
|---|---|
| Mode | Selective expansion |
| Premises | 3 sound, 2 partial, 5 challenged/blocking |
| Existing capabilities reused | 11 |
| Architecture decisions | 7 auto/mechanical |
| User challenges | 6 queued |
| Critical failure gaps after planned remedies | 0 |
| Outside provider | Unavailable: active Codex harness |
| Independent in-host review | Completed: 14 findings |
| Phase verdict | Ready for design and DX review after preserving challenges |

## AUTOPLAN PHASE 2 — DESIGN REVIEW

### Scope and system audit

Surface modes: CLI = **OPERATE**, GitHub check = **OPERATE**, receipt explorer = **READ**, Companion/Truth Board = **OPERATE**. No repository `DESIGN.md` exists. Existing usable vocabulary comes from `src/lib/ui.js` (80-column grid, fixed verdict column, word-first status, `NO_COLOR`) and Workbench (state banners, coverage view, responsive sidebar, explicit runtime confirmation).

Initial completeness: **4/10**. The spec names surfaces and concepts but leaves commit confirmation, claim-to-evidence hierarchy, partial states, narrow layouts, and accessibility to implementation.

### Pass 1: Information architecture — 5/10 → 10/10

Constraint: every result surface leads with only three things:

1. **What was checked:** task, exact base/head SHA, policy, freshness.
2. **What PRAXIS concluded:** claim counts and the highest-priority unresolved claim.
3. **Why:** strongest observation and missing checks per claim.

```text
VERIFY RESULT
├─ Scope bar: repo | base..head | policy | signed/stale
├─ Outcome sentence: “3/5 supported · 1 contradicted · 1 unverified”
├─ Required action: highest-priority contradiction or missing evidence
├─ Claim list (fixed verdict column)
│  └─ Claim detail
│     ├─ original words + normalized predicate
│     ├─ one-sentence causal reason
│     ├─ strongest observation + source + SHA
│     ├─ skipped/failed checks
│     └─ raw evidence disclosure
└─ Receipt details: signer, versions, digests, export/share
```

An aggregate green state is impossible while any required claim is FALSE/UNVERIFIABLE or any required observation failed.

### Pass 2: Interaction states — 3/10 → 10/10

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Scope selection | `Selecting range` + elapsed | repository has no commits | invalid/ambiguous SHA with correction | base/head, author, time, file count | low-confidence detection requires confirmation |
| Claim extraction | `Extracting claims` | report found but no factual claims | missing/unsupported/malformed report | editable atomic claim preview | vague/overlapping claims marked review-needed |
| Check plan | named observers being prepared | no applicable observer | policy or adapter invalid | command/check list + expected evidence | unsupported files/languages listed |
| Static verification | `Running check N of M` | no static predicate | parser/size/tool failure | observations by claim | completed/skipped/failed counts |
| Dynamic verification | trust preflight | no dynamic check required | timeout/nonzero/cancel | command outcome + duration | completed evidence retained, no verified aggregate |
| Result | evaluating policy/signing | `NO_CLAIMS` with manual-entry action | infrastructure failure separate from contradiction | supported claim set + signed receipt | exact missing evidence and recovery action |
| GitHub status | pending named phase | neutral/no claims | check infrastructure error | observation-mode conclusion | neutral/action required, never false green |
| Receipt viewer | verifying signature | missing/unparseable receipt | chain/signature failure | claim-to-evidence trace | stale policy or unavailable linked observation |
| Share | preparing preview | nothing eligible | auth/network/storage error | access/expiry/revocation shown | local receipt preserved if upload fails |

Progress uses named stages and elapsed time, never fabricated percentages. Cancellation says that completed observations are retained but cannot produce a verified result.

### Pass 3: Journey and emotional arc — 4/10 → 9/10

| Step | Developer does | Intended feeling | Design mechanism |
|---|---|---|---|
| 1 | runs one command | skeptical but curious | immediate repo/SHA preflight, no signup |
| 2 | reviews selected range and claims | in control | explicit source and confidence, editable claims |
| 3 | chooses static-only or trusted checks | safe | exact commands, cwd, environment/network/write policy |
| 4 | watches named observers | informed | stage, elapsed time, cancellation, no fake certainty |
| 5 | reads mixed verdicts | clarity, not punishment | claim-to-evidence chain and plain-language reasons |
| 6 | fixes/reruns or records human decision | agency | one primary recovery action per state |
| 7 | verifies/shares receipt deliberately | trust | offline signature check; preview before egress |

Five seconds: user sees exact scope and whether any required claim failed. Five minutes: user understands why and how to recover. Five years: old receipts remain readable with their original schema, policy, and evidence limits.

### Pass 4: AI-slop risk — 4/10 → 9/10

Hard-rejection audit: the existing Workbench landing screen uses a three-card “Bring / See / Fix” grid and marketing headings; none of that structure should become Verify’s result interface. Verify is a dense operating surface, not a marketing dashboard. The primary visual object is the vertical **claim → observation → reason** trace. Cards are reserved for a claim disclosure or user action, not used as page layout.

Litmus: brand unmistakable YES; one anchor YES (claim/evidence trace); headline scanning YES; one job per section YES; cards necessary only for disclosures YES; motion improves hierarchy only during stage transitions YES; premium without shadows YES.

Copy uses `Evidence supports this claim`, `Evidence contradicts this claim`, `Not enough evidence`, and `A person must decide`. Uppercase machine enums remain in exports/API, not as the only visible explanation.

### Pass 5: Design-system alignment — 5/10 → 9/10

Until a formal `DESIGN.md` exists, Verify inherits these tested primitives:

- `GUTTER=2`, `CONTENT=72`, `LABEL_W=12` and fixed `claimRow` alignment in terminals.
- Sage/rose/amber/blue/grey tones with symbols and words carrying meaning without color.
- `NO_COLOR`, plain-output, JSON, and screen-reader-equivalent text are first-class renderers.
- Existing Workbench state banners and disclosure patterns may be reused, but Verify gets a new claim-trace layout rather than scan/fix cards.
- One canonical action matrix drives CLI suggestions, GitHub links, viewer buttons, and Companion notifications.

A future design consultation can formalize tokens without blocking the engine.

### Pass 6: Responsive and accessibility — 2/10 → 10/10

Required acceptance criteria:

- WCAG 2.2 AA for browser surfaces; 4.5:1 body contrast; visible focus; semantic headings and landmarks.
- Full keyboard operation for claim navigation, disclosures, trust selection, reruns, and share preview.
- Status meaning uses label + symbol + explanation, never color alone.
- Meaningful stage changes announce through a polite live region; contradictions and blocking failures use a non-repeating assertive alert.
- Honor reduced motion; mascot motion stops; content never waits for animation.
- Minimum 44px pointer targets; no placeholder-only labels.
- At 320px: single claim column, identifiers wrap/copy, metadata collapses under disclosure, no sticky navigation.
- At 768px: single primary column with secondary evidence drawer below.
- At desktop: fixed claim index may accompany one evidence reading column; maximum text measure 75ch.
- Tables become labeled rows/cards on narrow screens; diffs and logs scroll inside clearly labeled regions.
- Test long Windows paths, 64-character SHAs, unbroken tokens, RTL and multilingual claims, 200% zoom, `NO_COLOR`, and screen readers.

### Pass 7: Unresolved design decisions

| Decision | Recommendation | If deferred |
|---|---|---|
| Mascot role in contradicted/blocking states | Ambient navigation/status only; precise standard icon and language carry failures | high-stakes result may feel playful or imprecise |
| Claim editing after extraction | edits create a new handoff digest before checks; never mutate after sealing | receipt may not match what user saw |
| Human-review override | record reviewer, reason, time, and policy; never rewrite machine verdict | audit history becomes misleading |
| Raw evidence defaults | strongest observation open; raw output collapsed and redacted | either overwhelm users or hide proof |
| Share placement | secondary action after local receipt review | accidental egress risk |

The mascot-role choice is a **taste decision** for the final gate. Structural items are auto-decided under the completeness rule.

### Canonical action matrix

| State | Primary action | Secondary action |
|---|---|---|
| FALSE / contradicted | inspect contradiction and return to code | mark evidence dispute |
| UNVERIFIABLE | run/add the named missing observation | record human review |
| human review needed | record decision with rationale | rerun with stronger policy |
| stale SHA | verify latest head | view historical receipt |
| trust required | review exact commands and authorize | continue static-only |
| execution failed | inspect bounded failure and retry | change check selection |
| signature invalid | stop relying on receipt | export diagnostic |

### Design dual-voice scorecard

| Dimension | Primary | Independent | Resolution |
|---|---:|---:|---|
| Information hierarchy | 5 | 5 | claim-first hierarchy added |
| Journey clarity | 4 | 4 | scope/trust/rerun flow added |
| State completeness | 3 | 3 | full matrix added |
| Distinctiveness | 4 | 4 | claim-to-evidence trace selected |
| Responsive behavior | 3 | 3 | explicit 320/768/desktop behavior added |
| Accessibility | 2 | 2 | WCAG/keyboard/live-region criteria added |
| Cross-surface consistency | 4 | 4 | canonical language/action matrix added |

Outside Codex unavailable under the active Codex host. Independent in-host reviewer completed 15 findings; all structural findings are reflected above.

### Design decisions added to audit trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 9 | Design | Claim-to-evidence trace is the dominant object | Auto-decided | Explicit | Expresses the product differentiator and avoids generic CI cards | dashboard card mosaic |
| 10 | Design | Aggregate success cannot hide required unresolved claims | Mechanical | Complete | Prevents false green merge status | optimistic rollup |
| 11 | Design | Add full loading/empty/error/success/partial matrix | Auto-decided | Complete | Makes failure behavior implementable | badge-only states |
| 12 | Design | Exact trust preflight precedes dynamic checks | Mechanical | Complete | Preserves untrusted-project boundary | silent execution |
| 13 | Design | One state-to-action matrix across surfaces | Auto-decided | DRY | Avoids conflicting recovery behavior | surface-specific actions |
| 14 | Design | WCAG 2.2 AA plus explicit viewport tests | Auto-decided | Complete | Accessibility becomes a testable contract | aspirational accessibility |
| 15 | Design | Ambient-only mascot in high-stakes states | Taste | Explicit | Keeps warmth without weakening failure clarity | mascot as verdict authority |

### Design completion summary

| Item | Result |
|---|---|
| Initial overall score | 4/10 |
| Final planned score | 9/10 |
| Structural decisions | 6 auto-decided |
| Taste decisions | 1 queued |
| User challenges | 0 new; CEO challenges preserved |
| External provider | unavailable: active Codex host |
| Independent in-host review | completed: 15 findings |
| Phase verdict | UI behavior is implementable; rendered design audit remains post-build |
## AUTOPLAN PHASE 3 — DEVELOPER EXPERIENCE REVIEW

### Primary persona and empathy narrative

The primary user is a repository maintainer who uses Claude, Codex, Cursor, or another coding agent and receives a confident completion report before merging. They understand Git and CI, but should not need to understand PRAXIS internals, receipt cryptography, transcript formats, or the Workbench split. They are skeptical, time-constrained, and willing to try one safe command for about two minutes. Their fear is merging a change whose stated tests, scope, or behavior never happened. The first run must show the exact repository, SHA range, report source, execution mode, and checks before it makes a judgment. The magical moment is a claim from their own agent report connected to a concrete observation from their own repository, with a plain explanation and a signed local artifact. If PRAXIS cannot establish provenance or lacks evidence, saying so precisely builds more trust than a green summary. Recovery preserves the same range and claim IDs so a retry cannot silently change the question. Sharing remains deliberate because the existing promise is local-first.

### Current-market benchmark

| Product | Fast path and strength | Gap PRAXIS can own |
|---|---|---|
| GitHub Copilot code review | Native PR review; GitHub says reviews are usually returned within 30 seconds | Portable claim-to-evidence artifacts tied to exact SHAs, rather than advisory comments ([official docs](https://docs.github.com/en/copilot/concepts/agents/code-review)) |
| CodeRabbit | GitHub/IDE/CLI review with integrated static analyzers | Testing completion claims and retaining signed evidence, rather than another suggestion bot ([official tool docs](https://docs.coderabbit.ai/tools/pmd)) |
| Qodo | Automatic PR review, suggestions, compliance and CI feedback; CLI requires install and login | Evidence sufficiency and unsupported claims as first-class states ([official review docs](https://docs.qodo.ai/qodo-documentation/qodo-merge/learn-more), [official CLI quickstart](https://docs.qodo.ai/qodo-documentation/qodo-gen/cli/setup-and-quickstart)) |

Competitive tier: differentiated wedge, immature activation. PRAXIS wins only if it stays focused on claims versus evidence rather than broad AI code review.

### Time to hello world

- **Current:** blocked. `verify` is not implemented and `npx praxis verify` can resolve a package this project does not own.
- **V1 target:** first local static result in under two minutes from a clean machine; trusted dynamic result in under five minutes for a small supported repository.
- **Definition:** a SHA-bound result containing at least one parsed claim, one observation, an explained verdict, and a signed local artifact.
- **Safe launch command until package ownership changes:** `npx praxis-memory verify`.

### Nine-stage developer journey

| Stage | Developer question | Required V1 behavior | Failure to prevent |
|---|---|---|---|
| Discover | Is this for my workflow? | Verify an agent's completion claims against a precise Git change | generic CI/security positioning |
| Invoke | What command is safe? | owned package invocation and no account for static mode | unrelated npm package execution |
| Scope | What will it inspect? | repo, base/head SHAs, report source, files, mode and budget | silent wrong-change selection |
| Parse | What did it understand? | original text, atomic claim, ignored prose and warnings | malformed report becoming success |
| Trust | Will it run my code? | static default; exact command/cwd/network/env/write/time/cost disclosure | hidden execution |
| Verify | What is happening? | named stages, elapsed time, cancellation and partial evidence | false one-minute guarantee |
| Interpret | Why this verdict? | evidence, gaps, provenance, scope and policy rule | conflicting vocabularies |
| Recover | How do I rerun it? | stable error and one action preserving range and claim IDs | question drift |
| Share/gate | What leaves my machine? | local first; explicit preview, upload and policy | accidental egress |

### Eight DX passes

| Pass | Initial | Planned | Required remedy |
|---|---:|---:|---|
| First five minutes | 3 | 9 | owned command, preflight, fixture demo, under-two-minute static path |
| Core workflow | 4 | 9 | stable range/report/trust/budget/rerun contracts |
| Errors and recovery | 2 | 9 | error code + cause + preserved work + exact next command |
| Docs/discoverability | 3 | 9 | one Verify quickstart with glossary and trust model |
| Upgrade/migration | 2 | 10 | preserve Ed25519 receipt v2 and add compatibility fixtures |
| Environment friction | 3 | 8 | dependency-free static path; opt-in runtime adapters |
| Community contribution | 3 | 9 | fixture-driven adapter/policy interfaces |
| Measurement | 2 | 9 | consented funnel with no repository content |

Overall: **2.8/10 current → 9.0/10 planned**.

### Error, naming and compatibility contracts

Every CLI error has `code`, `summary`, `cause`, `preserved`, and `next_command`; JSON uses the same fields. Required cases include invalid/ambiguous range, missing/malformed report, no claims, dirty-tree conflict, missing runtime, trust denied, dependency failure, timeout, budget exhaustion, cancellation, signature failure, stale receipt, provider failure and sharing failure. Progress goes to stderr; one stable JSON document goes to stdout. Exit codes distinguish contradiction, incomplete evidence, invalid input, infrastructure failure and cancellation.

| Inconsistency | Resolution in V1 |
|---|---|
| `praxis-memory` package vs `npx praxis` | document `npx praxis-memory verify`; retain `praxis verify` after installation |
| new claim verdicts vs `TRUE/FALSE/UNVERIFIABLE/NOT_A_CLAIM` | preserve compatible internal enum; map human labels |
| new headline vs existing receipt headlines | define aggregation mapping; never rewrite old receipts |
| HMAC migration vs existing Ed25519 v2 | remove migration; add golden compatibility fixtures |
| automatic sharing vs local-first | local/private default with explicit preview and upload |
| zero-config vs trust | zero-config static mode; trusted mode requires policy |

### Documentation, contribution and measurement checklist

- Link one five-minute Verify quickstart from CLI help and README.
- Cover report inputs, manual manifest, SHA flags, modes, verdicts, JSON/exit codes, privacy, CI and troubleshooting.
- Add positive, ambiguous, malformed, stale, adversarial and unsupported fixtures per adapter.
- Publish small report-adapter, observer and sufficiency-policy interfaces.
- With consent, measure command failures, time to first receipt, detection precision, parse yield, unsupported rate, trust acceptance, timeouts, rerun success, overrides and share opt-in; never collect source, claims, paths or logs.

### DX dual-voice consensus

| Dimension | Primary | Independent | Consensus |
|---|---:|---:|---|
| Persona fit | 3 | 3 | repository maintainer is the initial persona |
| Activation | 3 | 3 | package identity is a launch blocker |
| Workflow contract | 4 | 4 | scope, input, trust and rerun need public contracts |
| Error recovery | 2 | 2 | typed errors and exact actions required |
| Compatibility | 2 | 2 | reuse receipt v2 and map verdicts |
| Measurement | 2 | 2 | accuracy funnel required before more surfaces |

Outside Codex is unavailable under the active Codex host. The independent in-host reviewer completed 12 findings; all structural findings are reflected above.

### DX decisions added to audit trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 16 | DX | Use `npx praxis-memory verify` until package ownership changes | Mechanical | Safe | Prevents unrelated package resolution | unsafe invocation |
| 17 | DX | Static mode is the zero-config first run | Mechanical | Explicit | Project execution requires trust | hidden execution |
| 18 | DX | Stable JSON, error and exit-code contracts ship with CLI | Auto-decided | Complete | Future surfaces depend on them | scraped text |
| 19 | DX | Every retry preserves range and claim IDs | Auto-decided | Correct | Prevents question drift | fresh auto-detection |
| 20 | DX | Adapter development is fixture-driven | Auto-decided | Testable | Transcript inputs are hostile | prose-only guidance |
| 21 | DX | Telemetry is consented and content-free | Mechanical | Private | Preserves local-first | default content telemetry |

### DX completion summary

| Item | Result |
|---|---|
| Product type | local developer tool with optional GitHub integration |
| Persona | AI-assisted repository maintainer before merge |
| Initial/planned score | 2.8/10 → 9.0/10 |
| TTHW | blocked → <2 minutes static / <5 minutes trusted small repo |
| Competitive position | differentiated evidence wedge, immature activation |
| New user challenges | 0; CEO challenges reinforced |
| Phase verdict | contracts are implementable after final-gate decisions |

## AUTOPLAN PHASE 4 — ENGINEERING REVIEW

### What already exists and must be reused

- The dependency-free Node 22 CLI and its established human/JSON output split.
- Receipt schema v2: canonical hashing, append-only JSONL, Ed25519 signing, embedded public key, portable offline verification, immutable receipt versions and redaction before persistence.
- Existing verdict aggregation and compatibility vocabulary in `receipt/record.js`.
- Agent output envelope parsing for Claude and Codex in `jobs/receipt-link.js`.
- Safe argument-array resolution for agent launchers in `jobs/spawn.js`.
- Workbench scanner, reality checks, harness, runtime trust, shared model budgets, redacted excerpts and separate evidence ledger.
- Core test conventions with `node:test`, pack smoke, leak guard and tarball budget.
- Existing `praxisCmd()` already selects the installed `praxis` shim or the owned `npx praxis-memory` fallback.

### Architecture decision

```text
CLI / JSON / later GitHub adapter
              |
        Target resolver
 base SHA + head SHA + tree IDs + worktree state
              |
       Claim input boundary
 manifest <- transcript adapters <- optional LLM extraction
              |
 immutable normalized claims
              |
       Observation planner
       /                 \
static observers      trusted runner
       \                 /
     immutable evidence ledger
              |
 deterministic versioned sufficiency policy
              |
 separate decision record + causal trace
              |
 Verify payload digest linked from receipt v2
              |
 existing Ed25519 signer/store
              |
 human renderer / JSON / later GitHub conclusion
```

The LLM ends at candidate claim extraction or evidence classification. It cannot select the Git range, execute commands, alter observations, determine sufficiency, set the final verdict, or sign a receipt. The Workbench Python engine remains an optional observer provider across a versioned adapter; it does not become a dependency of the published core and its ledger is never relabeled as a core receipt.

### Core contracts

**Target identity (`verify-target/v1`)** records repository identity, base commit, head commit, base/head tree IDs, initial/final worktree status, submodule commits, whether untracked/ignored files influenced a check, and input digests. Automatic selection returns a confidence and candidate list; ambiguity is not success. Verification aborts or becomes incomplete if the observed tree changes.

**Claim manifest (`verify-claims/v1`)** requires schema version, stable claim ID, parent ID for decomposed claims, exact source text and location, normalized atomic predicate, scope, provenance, base/head binding, required evidence classes, and required/advisory status. It rejects traversal, duplicate IDs, unknown required fields, invalid ranges, compound predicates, excessive bytes/lines/nesting/counts, and control characters.

**Observation ledger (`verify-evidence/v1`)** is append-only. Each observation records observer/version, exact input digest, applicable predicate IDs, applicability reason, evidentiary strength, status, timestamps/duration, bounded stdout/stderr digests, environment class and failure. Evidence may remain unassigned. A repository-wide passing test never automatically proves every claim.

**Policy (`verify-policy/v1`)** is declarative and independently versioned. It defines applicable evidence types, freshness, required combinations, missing-evidence behavior, conflict precedence, aggregation and GitHub mapping. Evaluation emits a separate immutable decision record with policy digest and machine-readable reasons. Missing/failed/skipped observers never become positive evidence.

**Receipt compatibility** keeps schema v2 and the existing signed envelope. Verify produces a typed evidence/decision artifact whose digest is added as evidence before finalization, or a separately versioned receipt payload only if old-reader behavior and golden fixtures prove compatibility. Signer type and identity distinguish local self-attestation, CI and future managed issuers.

### CLI and middleware contract

`src/commands/verify.js` is a thin orchestrator over `src/lib/verify/*`. Supported initial inputs are an explicit manifest, an explicit report through a known adapter, manual claim text, and cautious automatic discovery that always displays the resolved source and range. Flags: `--base`, `--head`, `--report`, `--manifest`, `--claim`, `--mode static|trusted`, `--policy`, `--timeout`, `--json`, and `--yes` only with a previously reviewable trust policy.

stdout contains one final JSON document in JSON mode; progress/events use stderr. Exit codes are frozen before GitHub work: 0 supported/no required unresolved claims, 1 contradicted required claim, 2 invalid/ambiguous input, 3 incomplete evidence or trust required, 4 infrastructure/signing failure, 130 cancellation. Human labels map onto the compatible internal verdict model rather than inventing a second truth system.

### Trusted execution boundary

Trusted mode means host-trusted project code with controls; it is not a sandbox claim. It uses an isolated temporary Git worktree, argument arrays, an environment allowlist, exact command/cwd disclosure, wall/output/disk budgets, streamed bounded logs, platform-specific process-tree termination, cancellation escalation and final cleanup. Network denial is applied only where the platform can enforce it; residual access is disclosed. Secrets are not inherited by default. A before/after tree digest detects mutation. Static mode never executes project code.

### Implementation sequence

1. **Freeze fixtures and public contracts.** Add schemas, verdict/exit mappings, hostile fixtures and golden receipt compatibility cases before implementation.
2. **Build immutable core.** Implement target resolution, manifest validation, deterministic claim IDs/decomposition rules, observation ledger, policy evaluator and result schema as pure modules.
3. **Add static observers.** Changed-path/file existence, test-file association, package-script declaration and imported CI results, all with explicit applicability and strength.
4. **Link evidence to receipt v2.** Persist Verify artifacts under `.praxis/verify/`; append redacted digests and signer metadata through the existing store without changing prior receipt semantics.
5. **Ship CLI and JSON.** Preflight, static-first run, typed recovery, stable exit codes, `NO_COLOR`, cancellation and one-command fixture demo.
6. **Add optional AI extraction.** Provider-neutral injected adapter with schema validation, model/prompt/parameter/raw-response digests, temperature zero where supported, accepted-extraction cache by exhaustive input digest, and deterministic/manual fallback.
7. **Add trusted runner.** Only after process-tree, environment, mutation, timeout and cancellation tests pass on Windows and Linux.
8. **Calibrate observation mode.** Dogfood a labeled corpus; GitHub adapter consumes recorded core results and stays non-blocking.
9. **Enable opt-in gating.** Only after numerical quality and reliability thresholds are met per repository class.
10. **Phase later surfaces.** MCP proxy, Companion Verify state, hosted explorer and Truth Board consume the stable JSON contract; explicit sharing remains opt-in.

### Security and abuse review

| Threat | Control | Proof required |
|---|---|---|
| shell/argument injection | argv arrays, no interpolated shell, control-char stripping | hostile manifest/report tests |
| path traversal/symlink escape | resolve against repository root; reject escape before read | Windows/POSIX traversal fixtures |
| prompt injection | model output is candidate data validated by schema; deterministic policy owns outcome | adversarial report corpus |
| secret/env theft | allowlisted environment, static default, disclosed residual risk | sentinel-secret integration test |
| child survives timeout | platform process-group/tree termination and cleanup | misbehaving descendant test |
| worktree changes during run | immutable temp worktree and before/after tree digest | mutation race test |
| evidence forgery | append-only ledger, observer/input/policy digests and receipt link | tamper tests |
| stale cache | no cross-run cache in V1 except extraction keyed by all material inputs | cache-key fixtures |
| terminal spoofing | sanitize ANSI/control characters in human renderer | snapshot test |
| privacy regression | local diagnostics; remote telemetry/share explicit and redacted | leak guard and payload snapshots |

### Branch and user-flow test map

```text
Target resolver
├─ clean range ★★★
├─ merge/non-ancestor, shallow clone, missing base ★★★
├─ explicit overrides versus ambiguous auto-detection ★★★
├─ dirty/untracked/submodule/LFS state ★★★
└─ tree mutates mid-run [REGRESSION GATE] ★★★

Claim ingestion
├─ valid current + supported legacy manifest ★★★
├─ missing/no-claim/malformed/oversized/duplicate ★★★
├─ compound/ambiguous decomposition + human confirmation ★★★
├─ malicious paths/control characters/prompt injection ★★★
└─ LLM refusal/timeout/schema failure/nondeterminism ★★★ [→EVAL]

Observation and policy
├─ applicable/not-applicable/unassigned observation ★★★
├─ support/contradiction/missing/conflict precedence ★★★
├─ observer crash/output overflow/budget expiry ★★★
├─ global test cannot prove unrelated narrow claim ★★★
└─ same inputs produce byte-stable decision ★★★

Trusted runner
├─ trust grant/deny; exact preflight ★★★
├─ zero/nonzero/missing runtime/dependency failure ★★★
├─ timeout/cancel/output/disk cap ★★★
├─ descendant cleanup Windows + Linux ★★★ [→INTEGRATION]
└─ environment/network/write policy and residual-risk display ★★★

Receipt and interfaces
├─ v2-compatible Verify link + old reader ★★★
├─ local/CI signer identity and tamper/rotation cases ★★★
├─ human, NO_COLOR, piped and stable JSON output ★★★
├─ exit-code matrix and partial-result recovery ★★★
└─ GitHub idempotency, annotation cap and stale-pending reconciliation ★★★ [→INTEGRATION]
```

Every planned branch has a concrete test class. Highest-value gates are tree mutation detection, injection/path escape, descendant cleanup, deterministic policy output, old-reader compatibility, absence-not-success and LLM failure isolation.

### Performance budgets

| Stage | Static target | Hard behavior |
|---|---:|---|
| Git target and changed paths | p95 1 s on 100k-file repo | bounded Git queries; no full history walk |
| report/manifest parsing | p95 250 ms, max 2 MiB by default | reject with typed limit |
| static observation | p95 20 s | changed-path scoping, bounded concurrency |
| policy + signing | p95 100 ms | pure deterministic evaluation |
| total static | p95 <30 s, hard 60 s | honest incomplete result on expiry |
| trusted execution | policy-defined, default hard 5 min | timeout is incomplete, never support |

Hashing streams data; binary/generated/vendor ignores are explicit; stage timers and counts are local diagnostics. Cross-run observation caching is deferred until an exhaustive cache key can be proven.

### Observability and rollout gates

Each run has an idempotency key and persisted stage state. Local structured events include run/schema/policy/observer versions, counts, stage durations, failure enums and artifact digests. Source, claims, repository names, paths, commands and logs are excluded from opt-in remote telemetry. Publication failure is distinct from compute success, and immutable evidence can be replayed through policy/signing.

GitHub remains observation-only until a labeled sample meets all initial gates: target-selection precision ≥99%, false verification <0.5%, false contradiction <1%, required-claim unsupported rate reported by repo class, infrastructure failure <2%, static p95 <30 s, and 0 unresolved security/privacy regressions. Thresholds are versioned and revisited with real calibration; any threshold breach disables new merge-gate activations automatically.

### Worktree parallelization strategy

Implementation uses one integration owner because core contracts and receipt linkage are sequential. After schemas land, independent lanes may cover: (A) target/manifest, (B) observations/policy, (C) CLI/renderers, and (D) hostile fixtures/process control. Each lane uses isolated worktrees and cannot modify receipt schema or shared enums without integration-owner review. GitHub and Workbench adapters start only after core JSON fixtures freeze.

### NOT in scope for the first shippable milestone

- Automatic public uploads, hosted explorer, billing or account system.
- Merge blocking, auto-repair, autonomous command selection or hostile-code sandbox claims.
- Generic code review suggestions, formal verification claims, authorship proof or universal language coverage.
- Companion and Truth Board implementation.
- Direct dependency from published CLI core to Workbench Python.
- Cross-run dynamic evidence cache.
- Receipt schema replacement or HMAC migration.

### Failure Modes Registry

| Codepath | Realistic failure | Rescue | Test | User-visible |
|---|---|---:|---:|---:|
| target | wrong/changed tree | abort/incomplete with candidates | yes | yes |
| manifest adapter | malicious/oversized input | limits + typed reject | yes | yes |
| extractor | provider/refusal/schema drift | deterministic/manual fallback | yes/eval | yes |
| observer | not applicable/crash/truncate | explicit ledger entry | yes | yes |
| policy | unknown version/conflict | no verdict + trace | yes | yes |
| runner | descendants survive timeout | tree kill + cleanup diagnostic | integration | yes |
| signer | key/write failure | preserve artifacts; no gate | yes | yes |
| receipt link | old reader/new payload mismatch | golden compatibility gate | yes | yes |
| GitHub publish | duplicate/crash/stale pending | idempotent replay/reconcile | integration | yes |
| telemetry/share | secret or network failure | redaction, opt-in, local result retained | yes | yes |

No critical path is silent, and no infrastructure failure maps to supported.

### Engineering dual-voice consensus

| Dimension | Primary | Independent | Resolution |
|---|---:|---:|---|
| Architecture | 6 | 6 | immutable five-contract pipeline |
| API contracts | 5 | 5 | schemas, invariants, JSON and exit codes frozen first |
| Security | 4 | 4 | trusted runner explicitly not a sandbox |
| Testability | 6 | 6 | hostile branch map and labeled eval corpus |
| Performance | 5 | 5 | stage budgets and incomplete-on-expiry |
| Observability | 5 | 5 | local structured state, content-free opt-in metrics |
| Rollout | 6 | 6 | numerical observation gates and automatic disable |

Planned engineering completeness after remedies: **9.1/10**. Outside Codex is unavailable under the active Codex host. The independent in-host reviewer found 20 issues; all critical/high findings are incorporated.

### Engineering decisions added to audit trail

| # | Decision | Classification | Rationale |
|---|---|---|---|
| 22 | Bind verification to commits, trees, worktree state and input digests | Mechanical | SHA range alone can describe the wrong observed content |
| 23 | Keep claims, observations and decisions as immutable separate artifacts | Mechanical | prevents verdict-driven evidence mutation |
| 24 | Use declarative versioned sufficiency policy | Auto-decided | deterministic must also be inspectable and stable |
| 25 | Define trusted execution as controlled host execution, not sandboxing | Mechanical | avoids a false security claim |
| 26 | Keep receipt v2 envelope and link typed Verify artifacts | Mechanical | preserves public compatibility |
| 27 | Defer dynamic execution until cross-platform hostile-process tests pass | Auto-decided | highest host-risk boundary |
| 28 | Freeze CLI/JSON semantics before GitHub adapter | Auto-decided | GitHub rules would hard-code them |
| 29 | Require numerical observation gates before merge blocking | Auto-decided | prevents uncalibrated false gates |

### Implementation Tasks

- [x] **T1 (P1, human: 3h / agent: 2h) — Contracts** — Write versioned target, claim, observation, policy, decision and result schemas with invariants and golden fixtures.
  - Files: `src/lib/verify/schema.js`, `test/fixtures/verify/**`, `test/verify-schema.test.js`
  - Verify: malformed, hostile, oversized, duplicate and compatibility fixtures.
- [x] **T2 (P1, human: 4h / agent: 3h) — Provenance** — Resolve explicit/automatic Git ranges and bind trees, worktree/submodule state and input digests.
  - Files: `src/lib/verify/target.js`, `test/verify-target.test.js`
  - Verify: merge, shallow, dirty, ambiguous and mutation cases.
- [x] **T3 (P1, human: 5h / agent: 3h) — Evidence engine** — Build immutable ledger, static observer registry, declarative sufficiency evaluator and stable decision trace.
  - Files: `src/lib/verify/ledger.js`, `observers.js`, `policy.js`, `test/verify-policy.test.js`
  - Verify: missing/skipped/failed/conflicting/unassigned evidence never becomes support.
- [x] **T4 (P1, human: 3h / agent: 2h) — Receipt compatibility** — Link redacted Verify artifact digests through existing receipt v2 and retain old-reader behavior.
  - Files: `src/lib/verify/artifacts.js`, `src/lib/receipt/record.js`, receipt tests and golden fixtures.
  - Verify: old/new readers, canonical bytes, tampering and signer identity.
- [x] **T5 (P1, human: 4h / agent: 3h) — CLI/middleware** — Add `verify` command, preflight, static mode, stable JSON/errors/exit codes, cancellation and rendering.
  - Files: `src/commands/verify.js`, `src/cli.js`, `src/lib/verify/render.js`, command/JSON/UI tests.
  - Verify: stdout/stderr split, NO_COLOR, pipes, every recovery code.
- [x] **T6 (P1, human: 5h / agent: 4h) — Trusted runner** — Add isolated worktree execution, env allowlist, budgets, bounded streams and process-tree cleanup.
  - Files: `src/lib/verify/runner.js`, `test/verify-runner.test.js`, CI OS matrix.
  - Verify: injection, secret sentinel, timeout descendants, cancel, mutation and cleanup on Windows/Linux.
- [x] **T7 (P2, human: 4h / agent: 3h) — AI extraction** — Add provider-neutral candidate extractor and adapters after deterministic manifest path works.
  - Files: `src/lib/verify/extract.js`, `adapters/*.js`, `test/verify-extract.test.js`, labeled eval corpus.
  - Verify: refusal, malformed output, prompt injection, stable decomposition and fallback.
- [x] **T8 (P2, human: 3h / agent: 2h) — Docs/activation** — Ship owned invocation, fixture demo, trust/verdict/privacy docs and clean-install pack smoke.
  - Files: `README.md`, `docs/VERIFY-QUICKSTART.md`, `scripts/ci/pack-smoke.mjs`.
  - Verify: `npx praxis-memory verify` from clean packed install reaches hello world under target.
- [ ] **T9 (P2, human: 5h / agent: 3h) — Calibration/GitHub** — Add observation-only GitHub adapter, idempotency/reconciliation and quality dashboard only after core thresholds.
  - Files: `apps/verify-github/**` or a separately approved app boundary; recorded-output contract tests.
  - Verify: duplicates, stale pending, annotation caps, replay and no merge blocking.
- [ ] **T10 (P3, human: 4h / agent: 3h) — Later adapters** — Expose frozen result contract to MCP, Workbench, Companion and hosted surfaces after V1 calibration.
  - Files determined in later scoped plans.
  - Verify: contract fixtures shared across each adapter.

### Engineering completion summary

| Item | Result |
|---|---|
| Architecture issues | 20 independent findings; all critical/high remedies folded |
| Test review | full branch diagram; 8 highest-value gates identified |
| Security review | static-first; trusted runner honestly bounded, not sandboxed |
| Performance | stage budgets and hard incomplete behavior |
| Rollout | observation first with numerical gates |
| Existing contracts preserved | receipt v2, local-first, zero-dependency core, Workbench trust/budgets |
| Initial/planned score | 5.4/10 → 9.1/10 |
| Phase verdict | ready for final product decisions, then contract-first implementation |

## CROSS-PHASE SYNTHESIS

The four reviews agree on one dependency chain: trustworthy scope → atomic claims → immutable observations → deterministic policy → compatible signed artifact → stable interfaces → calibrated automation. Building any later surface before this chain is stable multiplies ambiguity and migration cost.

The strongest product opportunity is narrower and more defensible than the original platform launch: **PRAXIS is the independent claim-accountability layer for AI-generated code.** It complements GitHub/Coderabbit/Qodo review by answering whether the agent's stated completion claims are supported by execution evidence. The wedge is portable local proof, exact gaps and durable memory; the moat grows from a labeled claim/evidence corpus, observer ecosystem, policy history and receipt interoperability.

The implementation plan preserves every valuable current contract: Ed25519 receipt v2, local/private defaults, explicit model calls, runtime trust, shared budgets, the dependency-free core, existing Workbench separation, honest unverified states and all current CLI behavior. New work is additive and versioned.

### Final decisions requiring product owner input

1. **Launch command:** use the owned `npx praxis-memory verify` now, or first acquire/publish an owned package that makes `npx praxis verify` safe.
2. **Scope:** ship engine + CLI + observation-only GitHub check first, or attempt every named surface in V1.
3. **Privacy:** keep local/private default with explicit share preview, or accept automatic public receipt URLs.
4. **Provenance:** require versioned handoff/manifest and visible ambiguity handling, or permit silent automatic AI-commit/report selection.
5. **Runtime promise:** publish static and trusted budgets, or retain a universal under-one-minute claim.
6. **Design taste:** keep the mascot ambient-only in contradicted/blocking states, or make it part of the verdict display.

### Recommended approval profile

Approve the plan with all six recommendations: owned current command, engine/CLI/GitHub observation scope, explicit sharing, reviewable provenance, tiered budgets and ambient-only mascot. This reaches a credible launch sooner while keeping the larger platform roadmap intact.

## GSTACK REVIEW REPORT

| Review | Status | Findings | Decision |
|---|---|---|---|
| CEO | COMPLETE | 14 independent findings; 6 product challenges | claim-accountability engine first |
| Design | COMPLETE | 15 findings; 7 structural dimensions resolved | claim-to-evidence trace |
| DX | COMPLETE | 12 findings; 2.8/10 → 9.0/10 planned | owned command and frozen developer contracts |
| Engineering | COMPLETE | 20 findings; 5.4/10 → 9.1/10 planned | immutable contract pipeline |
| Outside provider | UNAVAILABLE | active Codex host; nested Codex prohibited by review harness | independent in-host reviewer used; missing cross-provider coverage disclosed |
| Implementation | ENGINE V1 COMPLETE | T1–T8 implemented and pressure-tested | GitHub observation and later adapters remain gated by calibration thresholds |

**Verdict:** APPROVED AND IMPLEMENTED — the local engine, CLI, trusted runner, AI extraction boundary, signed linkage, tests, and quickstart are complete. Observation-only GitHub work remains intentionally gated on the plan's quality thresholds.

**Artifacts**
- Active plan: `docs/plans/PRAXIS-VERIFY-V1-IMPLEMENTATION-PLAN.md`
- Restore point: `C:\Users\vaish\.gstack\projects\praxis\main-autoplan-restore-20260922-170315.md`
- Engineering test plan: `C:\Users\vaish\.gstack\projects\praxis\main-eng-review-test-plan-20260922-172500.md`
- Engineering task JSONL: `C:\Users\vaish\.gstack\projects\praxis\tasks-plan-eng-review-20260922-verify.jsonl`

Review telemetry and snapshot automation were unavailable because this machine lacks `bun`; the limitation did not alter repository code or the review findings.

