# PRAXIS Opportunity Portfolio and Category Launch Plan

**Date:** 2026-09-22  
**Goal:** Incorporate every ranked opportunity without weakening PRAXIS, breaking existing contracts, or launching an incoherent collection of products.

## Strategic decision

All seven opportunities can belong to the same long-term company. They cannot launch as seven equal products.

```text
                         PRAXIS OUTCOME NETWORK

   PRAXIS Verify                         PRAXIS Control
   code acceptance                       authority + action policy
          |                                     |
          +------------------+------------------+
                             |
                   Outcome Authority Core
        action contracts | evidence | outcome oracles
        settlement receipts | compensation | disputes
                             |
          +------------------+------------------+
          |                                     |
   PRAXIS Evidence                       PRAXIS Meter
   compliance packages                   cost per verified outcome
                             |
                  Later network applications
             Proof-of-Human API | Care Operations OS
```

The public promise remains singular:

> PRAXIS proves that an AI agent was authorized to act, verifies what actually changed, and settles the outcome with portable evidence.

Memory, orchestration, routing, governance, compliance, identity, and care are capabilities or applications of that promise. They are not separate launch messages.

## Portfolio mapping

| Ranked opportunity | Platform role | Timing | Decision |
|---|---|---|---|
| Agent transaction and outcome assurance | Core protocol and runtime | Now | Primary company thesis |
| AI-generated software acceptance verification | PRAXIS Verify | Now | Initial wedge and distribution |
| General agent governance | PRAXIS Control | After wedge | Integrate IAM/policy vendors; own outcome settlement |
| AI compliance evidence automation | PRAXIS Evidence | After reliable receipts | First enterprise monetization layer |
| Agent cost and model routing | PRAXIS Meter | Later | Optimize cost per verified outcome |
| Proof-of-human internet identity | Credential extension | Much later or partner | Consume credentials; do not build identity first |
| Family eldercare agent operating system | Vertical application | Last, dedicated team | Build on proven authority and evidence core |

This keeps every opportunity while sequencing execution.

## Why this is the fundable position

YC already funds the obvious adjacent categories: Agentic Fabriq and Multifactor cover agent identity and permissions; Alter covers scoped credentials and access control; Superagent covers coding-agent security; Fabraix covers red-teaming; TectoAI covers AI-worker governance; Tolmo covers security across code, CI, and cloud.

PRAXIS should integrate with those control layers and own the independent outcome layer they do not naturally own.

**Investor pitch:**

> PRAXIS is the outcome authority for AI agents. It converts every consequential action into an authorized transaction, verifies the real-world result independently, and issues evidence that software, security teams, auditors, and insurers can rely on.

**YC interview opening:**

> Teams deploying coding agents use PRAXIS to stop false “done” claims from merging. We bind the task to the exact commit, verify every required claim independently, and block unsupported work.

The expansion story follows only after demonstrating the working product.

## Shared core

Every product surface uses five stable primitives:

1. **Action Contract:** principal, agent, delegated authority, intended outcome, allowed side effects, preconditions, postconditions, evidence sources, budget, deadline, and compensation.
2. **Authority Decision:** allow, deny, or escalate, bound to identity, policy version, state, and expiry. PRAXIS integrates with Okta, Entra, OPA, or Cedar rather than rebuilding IAM.
3. **Evidence Record:** immutable observation with source identity, method, timestamp, digest, provenance, and freshness. Agent statements remain claims.
4. **Outcome Verdict:** `verified`, `contradicted`, `unverified`, `partially_verified`, `compensated`, or `disputed`.
5. **Settlement Receipt:** asymmetric signature over intent, authority, action, observed state, outcome, versions, and linked evidence with selective disclosure.

The schemas and verifier should be open. Hosted verification, enterprise connectors, outcome intelligence, operations, retention, and SLAs remain commercial.

## Non-breaking integration contract

- Preserve all current PRAXIS receipt formats and verification behavior.
- Never relabel historical HMAC receipts as publicly verifiable signatures.
- Add `settlement-receipt/v1` as a linked artifact instead of mutating existing fields.
- Preserve `.praxis` memory, hooks, MCP tools, CLI commands, tray behavior, and Workbench state.
- Keep Workbench evidence distinct until a versioned bridge links it.
- Keep the core CLI at zero runtime dependencies.
- Put optional browser, database, hosted, IAM, and policy capabilities in isolated packages or apps.
- Start every enforcement feature in observation mode.
- Never migrate, upload, reinterpret, or delete local evidence automatically.
- Do not write project startup configuration for an agent unless that client safely supports it; use `AGENTS.md` for portable instructions and leave client trust decisions explicit.

Proposed additive layout:

```text
spec/
  action-contract/v1.schema.json
  evidence-record/v1.schema.json
  outcome-verdict/v1.schema.json
  settlement-receipt/v1.schema.json
packages/
  outcome-core/
  receipt-signing/
  otel-adapter/
  mcp-action-gateway/
  github-verifier/
apps/
  workbench/          # preserved
  outcome-console/    # later
```

Before these modules are created, fix the known flow/eval correctness issues and Workbench provider regression. A proof product cannot depend on verdict logic known to be wrong.
## Product sequence and exit gates

### Phase 0 — credibility repair (weeks 0–4)

Resolve the known flow/eval correctness findings, restore Workbench provider-test compatibility, reproduce every published benchmark, and publish limitations beside claims. Exit only with a clean regression baseline and preserved historical receipts.

### Phase 1 — PRAXIS Verify (weeks 4–14)

Build one complete path: developer task → explicit claims → exact commit → independent checks → claim verdicts → merge decision → signed receipt. Ship it through the CLI, a GitHub App or Action, MCP, coding-agent adapters, and a public receipt viewer. The CLI shape should converge on `praxis verify-change` without removing existing commands.

Exit targets:

- 20 repositories use the product weekly.
- Five teams retain it after four weeks.
- PRAXIS catches at least three confirmed false-success events that ordinary CI or review missed.
- A new repository reaches its first useful proof in under 15 minutes.

### Phase 2 — PRAXIS Control and Evidence (months 3–8)

Add one consequential workflow such as deployment and rollback, database migration, refund approval, or privileged access. Run policy in observation mode before enforcement. Convert verified receipts into evidence mappings for SOC 2, the OWASP Agentic Security Initiative, and applicable EU AI Act controls. Describe these as evidence packages, never automatic compliance.

Exit targets:

- Two paid enterprise pilots and demonstrated willingness to pay above $25,000 annually.
- More than 80% of the selected workflow's postconditions verified by deterministic or independently sourced checks.
- An external security review and a tested compensation path.

### Phase 3 — PRAXIS Meter (months 6–12)

Measure cost, latency, correction rate, and risk per verified outcome. Route models only after outcome data exists. This is an outcome optimizer, not a generic model marketplace.

### Phase 4 — portable delegation (months 12–24)

Consume W3C Verifiable Credentials, passkeys, enterprise identity, and payment mandates such as AP2. Bind a person's delegated authority to action contracts. Do not own biometric identity, proof-of-personhood hardware, or a global identity network at this stage.

### Phase 5 — Care Operations OS (later, with a dedicated vertical team)

Apply the proven authority and evidence layer to care-plan coordination, appointments, transport, reminders, expense authorization, escalation, and family/provider handoffs. Keep diagnosis and clinical decisions outside the initial product. This vertical begins only after the platform has mature privacy, accessibility, audit, emergency-escalation, and human-supervision controls.

## Compatibility gates for every phase

Every new surface must pass the existing core suite, historical receipt fixtures, `.praxis` memory compatibility, privacy guard, and package budget. Workbench changes additionally require backend tests, frontend type checking, and a production build. New schemas need conformance fixtures across versions. Enforcement paths need failure injection for timeouts, stale state, forged claims, partial execution, budget exhaustion, cancellation, compensation failure, and unavailable evidence.

No phase may turn an agent completion into a verified outcome, replace an unavailable check with success, or mutate old evidence to satisfy a new schema.

## Category launch: the False Done Challenge

No team can guarantee that a launch will break the internet or that investors will compete to fund it. PRAXIS can create a sharp, repeatable demonstration that makes the problem undeniable.

The launch scenario:

1. An agent receives a real bug and reports it fixed.
2. The diff looks plausible and an irrelevant or stale test passes.
3. The required postcondition still fails against hidden ground truth.
4. PRAXIS binds the claim to the exact commit, detects the contradiction, and blocks acceptance.
5. The agent repairs the work and PRAXIS issues a verifiable receipt for the supported claims.

Launch line:

> Your AI said it was done. PRAXIS checked reality.

Launch assets:

- An open action-contract and settlement-receipt specification.
- A one-command, offline demonstration with deterministic output.
- A GitHub sample repository that anyone can fork and challenge.
- A threat model, explicit non-claims, and reproducible benchmark methodology.
- A hidden-ground-truth benchmark for false completion, stale evidence, and misleading green tests.
- Five anonymized, independently confirmed failures found with design partners.
- A public receipt explorer and a 90-second product film.
- A factual comparison against CI, observability, IAM, agent security, and generic governance products.

Sequence distribution through design partners first, then GitHub, Hacker News, Product Hunt, relevant Reddit communities, X and LinkedIn, Indie Hackers, and standards communities. Tailor the artifact to each community. Do not buy engagement, invent testimonials, or advertise benchmark numbers without reproducible evidence.

## Fundraising proof

The credible YC story is evidence of a new category, not a promise that top funds are waiting. Before fundraising, target:

- 20 qualified interviews based on real failure artifacts rather than opinions.
- Five active design partners and two paid pilots.
- Eight consecutive weeks of usage and retention data.
- One repeatable acquisition channel.
- Median time to first proof below 15 minutes.
- A growing count of confirmed consequential failures caught.
- More than 80% independent postcondition coverage in the first workflow.
- A clear competitive distinction: PRAXIS settles outcomes while identity, policy, observability, and security products supply inputs.

The YC application should lead with the coding-agent wedge, observed usage, failures caught, and why the same transaction model expands. The broad platform vision belongs after the working proof.

## Operating rules

1. Earn the right to expand: verify code outcomes, control actions, package compliance evidence, optimize cost, add portable human delegation, then enter care operations.
2. Maintain one canonical outcome schema and shared verifier across every product surface.
3. Integrate with identity, policy, telemetry, payments, and coding-agent vendors rather than reproducing their whole stacks.
4. Start with observation, measure false positives and coverage, and enable blocking only after teams trust the evidence.
5. Price against prevented loss and verified workflows; keep the open verifier useful without the hosted service.
6. Treat security, privacy, accessibility, and evidence integrity as product behavior with tests.
7. Kill or pause an expansion when its exit gate fails. Preserving an opportunity in the roadmap does not require funding it before the shared core is ready.

## Dependency graph

```text
Repair credibility baseline
          ↓
Verify software outcomes
          ↓
Control consequential actions
          ↓
Package compliance evidence
          ↓
Optimize cost per verified outcome
          ↓
Bind portable human delegation
          ↓
Launch regulated vertical applications
```

This sequence incorporates the full opportunity ranking while keeping one product promise, one technical core, and measurable reasons to advance.

## Current category references

- [YC Request for Startups](https://www.ycombinator.com/rfs)
- [Agentic Fabriq](https://www.ycombinator.com/companies/agentic-fabriq)
- [Multifactor](https://www.ycombinator.com/companies/multifactor)
- [Alter](https://www.ycombinator.com/companies/alter)
- [Superagent](https://www.ycombinator.com/companies/superagent)
- [Fabraix](https://www.ycombinator.com/companies/fabraix)
- [TectoAI](https://www.ycombinator.com/companies/tectoai)
- [Tolmo](https://www.ycombinator.com/companies/tolmo)
