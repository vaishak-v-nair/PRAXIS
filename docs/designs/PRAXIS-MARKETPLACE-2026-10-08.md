# PRAXIS marketplace product plan

Status: **superseded Option B alternative**, 2026-10-08. The user selected Option C, with this document's scoped transaction, acceptance, recheck and recourse safeguards retained in the [canonical open outcomes marketplace plan](PRAXIS-OPEN-OUTCOMES-MARKETPLACE-2026-10-08.md). This document remains as the reviewed B tradeoff and does not describe built marketplace features.

## Initial product bet

PRAXIS becomes a marketplace for **evidence-backed project remediation**. A builder runs a private project review locally. PRAXIS turns a selected finding into a bounded work request. The buyer can commission a vetted human specialist to deliver a pull request, then decide whether to accept it after an independent recheck against the original goal and current project state. The first paid category is one scoped fix on a GitHub-backed JavaScript/TypeScript project; the existing review product still supports local folders and other languages. Other paid categories require demonstrated demand and an evidence oracle. A listing without an order, fulfillment, recourse and settlement path is not a marketplace.

The local reviewer remains useful without an account, purchase, API key, or Docker. A hosted marketplace stores only the identities, listing metadata, scoped order records, consent, payment status, delivery references and disputes needed for transactions. Project source and `.praxis` memory remain local unless the buyer explicitly shares a bounded work packet. No transaction, agent completion, model verdict or signature is marketed as proof of production readiness by itself.

## Scope under review

1. Make the private review-to-work-request path dependable and concise.
2. Create a real two-sided transaction: vetted seller listing, buyer account, scoped request and quote, region-eligible payment, controlled fulfillment, delivery, independent recheck, buyer acceptance or dispute, refund/payout reconciliation.
3. Keep the public site and local Workbench as distinct clients of explicit, versioned contracts. Replace the eight-tab first-run experience with a short journey while retaining advanced evidence views.
4. Use optional low-cost AI routing for triage and matching only after a labeled evaluation shows value. Jev is a candidate early-access adapter, never the outcome authority.

Not in the first transaction: general agent marketplace, open self-serve seller publishing, automated source uploads, agent autonomy over payments, arbitrary production deployment, a generic crawler, trading or lead generation.

## Known existing foundation

`apps/workbench/backend/regen` provides the local FastAPI review and SQLite job store, source scanner, runtime harness, deterministic assessment, fix planning, agent/team coordination and source-apply gates. `apps/workbench/app` and `components` render the local Next.js Workbench. `web/test-your-project` is a browser-memory static trial, not a hosted backend. `src/lib/verify` has a separate commit-bound claim verifier and Ed25519 receipt. CLI `src` remains dependency-free. These are existing product pieces, not a marketplace backend.

## Research and visual references

Four user-supplied videos were sampled into contact sheets under ignored `.regen/autoplan-media`. Their dynamic routing and dense system views suggest that low-cost decisions can reduce unnecessary deep analysis. They are visual references, not evidence of costs, outcomes, revenue or production reliability. The first shows a purple niche/revenue graph; the second a System One decision graph; the third a trading-style GrokBot/Jev control room; the fourth raw crawler/browser material. None is an appropriate default PRAXIS customer dashboard.

TypeSafe's [Jev introduction](https://typesafe.ai/blog/introducing-system-one-models-and-jev) and [documentation](https://docs.typesafe.ai/introduction) describe typed probabilistic decisions from supplied state, not crawling or long-form repair generation. The vendor says early access and publishes latency/cost claims, which PRAXIS must benchmark on its own review traffic. [Stripe's marketplace guide](https://docs.stripe.com/connect/marketplace) shows that a true marketplace requires seller onboarding, payment, payouts and liability for disputes/refunds under its sample configuration. Stripe's [India marketplace support note](https://support.stripe.com/questions/stripe-india-support-for-marketplaces) says accounts are invite-only and separate charges/transfers are unsupported there; the founder's legal-entity and seller countries are unknown, so no provider is selected for live checkout yet. Official [Razorpay Route](https://razorpay.com/route/) and [Cashfree Easy Split](https://www.cashfree.com/docs/api-reference/payments/latest/split/easy-split-overview) show India-focused marketplace alternatives, subject to account eligibility and exact use-case review. [GitHub Marketplace](https://docs.github.com/en/apps/github-marketplace) is a distribution channel for a PRAXIS app, not a substitute for PRAXIS's own multi-seller transaction platform.

The competitive bar is already high. [GitHub Copilot cloud agent](https://docs.github.com/en/enterprise-cloud%40latest/copilot/tutorials/cloud-agent/improve-a-project) can take an issue with acceptance criteria and produce a PR; [Vercel Agent Code Review](https://vercel.com/docs/agent/pr-review) says it validates suggested patches in secure sandboxes; [Upwork's Project Catalog](https://www.upwork.com/services) already sells scoped fixed-price services, including a current [AI-built-app repair listing](https://www.upwork.com/services/product/development-it-your-ai-built-app-fixed-hardened-and-production-ready-2102536546649853004). PRAXIS cannot win merely by adding AI review, listings or a contractor checkout. Its proposed difference is a **private review → evidence-limited work contract → accountable delivery → independent, accurately bounded recheck → recourse** loop that travels with the order. That difference is still a hypothesis: pilot buyers should compare it directly with using their existing agent and a generic freelancer on time, trust, price and outcome.

## Review sequence

CEO and scope -> design and all user states -> developer experience -> engineering and test plan -> final user decision. Record disagreements and open assumptions without claiming consensus from missing review voices.

## Phase 1: CEO and scope review

### Premise challenge and decision

The user wants a marketplace, but there is no observed buyer demand or seller supply in this checkout. The existing product already gives users findings, agent briefs and fix plans; a marketplace has to outperform sending the brief to the user's current AI agent. Adding listings, cards and payments without repeated, successful third-party deliveries would make the prototype look commercial while leaving its core result unchanged. The chosen framing is a **transaction and acceptance wedge** for PRAXIS's outcome-assurance thesis, not a claim that a broad labor marketplace already exists or that earlier enterprise ARR scenarios transfer to commissions.

The proposed first buyer is a solo founder or small engineering lead whose AI-built JavaScript/TypeScript GitHub project has one concrete blocker they cannot confidently fix. The first seller is a vetted human software specialist who may use AI but is accountable for a bounded pull request. The buyer receives a quote with exact scope, acceptance criteria and delivery window; they decide whether to buy, grant repository access, accept the result and merge. A plan-only deliverable is explicitly outside the first paid product because it cannot share the same acceptance test as a working patch. This narrow wedge does not demote developers or teams as eventual users; it defines one testable launch cohort.

The marketplace hypothesis fails if qualified users prefer their existing agent handoff or will not grant a third party source access. Before building self-serve seller onboarding, run 20 discovery interviews and at least 5 real, paid, manually brokered same-category orders. Compare with the current `AgentBrief` handoff: review-to-order conversion, time to quote, paid fill rate, delivery time, rework, dispute/refund rate, repeat purchase and contribution margin after provider, model, verification and support costs. These are proposed learning gates, not measured facts. Do not describe a concierge desk as a proven two-sided marketplace; the self-serve product milestone requires at least two independently viable sellers per category and successful repeat orders.

The economics are unproved. For scale context only, a $500 average order at a 20% platform take yields $100 gross platform revenue before payment, support, verification and acquisition costs; reaching $100 million annual gross platform revenue on that mix would require one million completed orders per year. This arithmetic is not a market forecast. It makes repeat purchase, average order value, contribution margin and a product moat beyond human brokering more important than headline GMV or seller-card count.

### Existing-code leverage and alternative approaches

| Problem | Reuse and boundary |
| --- | --- |
| Identify useful jobs | `scanner.py`, `reality.py`, `harness.py`, `review.py` and the source-linked `findings` data. Keep separate source, model, runtime and unknown states. |
| Define buyer intent | Existing goal input and `coordination.py` decisions/tasks. Freeze a new order-specific scope record; do not silently promote a mutable task to a contract. |
| Give a specialist context | Existing source map, `AgentBrief`, fix plan and bounded redaction. Sharing a work packet needs a new explicit consent and retention contract. |
| Assess delivery | Reuse local recheck and `src/lib/verify` exact-commit checks where applicable. The two receipts/assessment types remain distinct; neither automatically settles payment. |
| Deliver and manage order | New hosted identity, catalog, quotes, order ledger, billing, payout and dispute services. Local loopback `app.py` is not a public API and must never be deployed as one. |
| Render experience | Keep `web` public trial and `apps/workbench` local review; share a small versioned handoff schema rather than duplicating verification logic in the hosted UI. |

| Approach | Description | Effort / risk | Advantage | Limit | Decision |
| --- | --- | --- | --- | --- | --- |
| A. Curated catalog only | Publish reviewed agent workflows and allow local download or copy; no external seller/order settlement. | M / medium | Fastest visual change and low code access. | A storefront, not the requested marketplace; no accepted outcome or recourse. | Reject as end state; useful only as free educational catalog. |
| B. Verified-fix managed marketplace | Start with one Git-backed fix category and vetted human sellers. Broker initial orders manually, then implement accounts, quotes, payments, deliverables and disputes behind the same contract. | L / medium-high | Tests a real transaction and uses PRAXIS evidence. | Labor operations, code access and payment liability must be carried deliberately. | **Recommend**, conditional on pilot gates. |
| C. Open human-plus-agent exchange | Self-serve seller uploads, arbitrary agent packs, auto-matching, automated execution and payment on model verdict. | XL / very high | Largest theoretical selection and network scale. | Unsafe plugin execution, cold start, fraud and false settlement before evidence quality is proved. | Defer; preserve extensible seller type in data model, not open execution. |

The vision twelve months out is that a buyer can move from a genuine failed behavior to a scoped order, multiple accountable providers, a tested delivery and clear recourse without becoming an expert in verification infrastructure. The selected plan can get there if the first transaction proves demand and a new hosted commerce boundary is built. It moves away from that target if Jev, a crawler, glossy agent graphs or broad category coverage consume the first six months.

```text
CURRENT                               THIS PLAN                                 12-MONTH TARGET
local review + agent brief     ->      first paid fix + outcome/recourse log  ->  repeatable multi-seller acceptance network
eight diagnostic tabs                 one buyer journey, advanced evidence       many categories only with independent oracles
no transaction service               dedicated hosted commerce service         proven repeat demand and defensible supply
```

Selective expansion is appropriate: preserve the complete marketplace end state while refusing to ship empty multi-category supply. The minimum coherent transaction includes account identity, seller verification, scoped quote, payment, delivery, buyer acceptance or dispute, payout/refund reconciliation and an honest evidence record. Good later expansions are a seller reputation derived only from completed orders, a buyer's reusable work templates, automated seller matching, local companion pairing, and category-specific verification packs; none is required before the first paid order.

### Architecture, state and scale

```text
 Browser trial (web, no account)             Hosted marketplace (new; authenticated)
      |                                              | catalog, quote, order, dispute
      v                                              v
 Local Workbench UI -> loopback FastAPI       Marketplace API -> transactional Postgres
      |                    |                              |         |        |
      |                    +-> local review/SQLite        |         |        +-> audit/outbox worker
      |                              |                     |         +-> eligible payment provider
      +-> explicit order packet ---->|                     +-> GitHub metadata / exact SHA
                 buyer consent       +-------------------------------> hosted order
                 no implicit source sync                       |
                                                               v
                                                isolated verifier runner (later automation)
                                                reuse native checks; no seller self-attestation
```

Recommend a **separate hosted marketplace application** using Next.js/TypeScript, Supabase-managed Postgres/Auth and a payment-provider port, with an outbox-backed worker for external events. The current Vercel public site can link to it; Cloudflare remains useful for the existing site/edge, but a free Worker is not assumed to be an adequate commerce backend. Supabase's [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) requires grants and row policies to be tested for every exposed table; its elevated service role stays server-only. The hosted service owns its own auth, tenancy, audit log and migrations; it never calls the local FastAPI API inbound or gains access to `.praxis` memory. A versioned `OrderPacket` exporter/importer in the local app contains finding ID and description, intended behavior, source revision, allowed share fields, consent and hashes; an explicit buyer action creates a hosted draft. During the pilot, a seller gets access through an explicit buyer-managed GitHub invitation. PRAXIS records the grant/revocation request but must not claim GitHub enforces per-file access. A later GitHub App with installation-scoped repo permissions and an isolated runner may automate rechecks after its own security review.

**Implementation prerequisite found in code review:** GitHub intake in `scanner.py` currently makes a shallow clone and records a bounded source fingerprint, but it does not persist a Git commit SHA in the review job. `projects.py` reports remote-source freshness as `unknown` during status lookup. Packet export therefore must add immutable Git remote identity and exact HEAD capture at intake, store it beside the existing fingerprint, and validate the remote HEAD again (with an explicit network/auth failure state) before quote acceptance and delivery. A local folder that happens to contain Git metadata is not silently treated as a GitHub-backed, seller-accessible project. Existing review records without a trustworthy SHA remain reviewable but are ineligible for this first paid category until refreshed. This is additive: keep the current fingerprint for local snapshot freshness rather than reinterpreting it as a commit.

The local-to-hosted trust crossing is an explicit export, not a public route into loopback FastAPI. For the concierge pilot, `Get help` exports the reviewed packet to a local file and opens an authenticated hosted import screen; the buyer selects the file and confirms an exact field preview there. The hosted API validates account, schema, digest, expiry, size and nonce, stores an immutable submission, and makes a draft. The downloadable file is sensitive and clearly labeled; it can be discarded locally without deleting the review. A later one-click flow requires a short-lived, account-bound pairing protocol with PKCE or equivalent replay resistance and its own security review. Neither the hosted app nor a seller receives a direct network path to `127.0.0.1`.

The first paid pilot uses a **buyer-initiated local recheck** at the delivered PR head, independent of the seller's own test claims. The local app verifies the exact commit range and runs static observers; runtime and browser journeys run only with the buyer's explicit host/Docker trust choice, so their absence is recorded as not run. The buyer sends only the resulting bounded observation metadata with consent; the hosted order cannot fabricate a local check or mark a claim verified because the seller supplied a green build. A trusted isolated hosted runner is a later prerequisite for automated rechecks and a self-serve marketplace SLA; it requires separate permission, network and secret boundaries. Buyer acceptance may occur with an unavailable/partial check under disclosed policy, but the UI must never call that outcome independently verified.

The buyer-side result is bound to the reviewed repository and exact PR head, but a locally generated signature does not prove to a stranger that the buyer ran the check honestly; its key provenance and trust level remain visible. Workbench's project-readiness assessment and Verify's commit-claim receipt stay distinct. The paid category's acceptance criteria are a separate buyer contract: even a `VERIFIED` atomic claim does not certify every acceptance criterion or authorize payout. A malicious PR, relevant-test gap, refused runtime trust, changed base, or failed Git fetch produces an explicit partial/unavailable recheck and a human decision path.

Payment implementation is a separate go/no-go decision after identifying the operating entity and first buyer/seller countries. Stripe Connect is a candidate in supported configurations; an India-registered operation needs an eligible local marketplace provider, such as Razorpay Route or Cashfree Easy Split, if contracted for this exact service. Provider choice is an adapter plus operating policy, not a four-method abstraction that pretends all providers settle alike. The selected flow must specify seller eligibility/onboarding, authorization/capture, split or transfer timing, holds, refunds, reversals, chargebacks, fees/tax and reconciliation before schema or checkout is frozen. [Cashfree Easy Split](https://www.cashfree.com/docs/api-reference/payments/latest/split/easy-split-overview) can settle vendors automatically on capture, while [Razorpay Route](https://razorpay.com/docs/payments/route/transfer-funds-to-linked-accounts/) has transfer timing and currency constraints; neither should be assumed to implement escrow or a buyer-controlled release without a contracted supported flow. No live checkout or payout is offered until that legal/provider path is confirmed; a test-mode order is not described as a paid customer order.

Order state is multiple orthogonal fields, not one reassuring label:

```text
request: draft -> quoted -> quote_accepted -> active -> delivered -> closed
                                  |                         |          |
                                  +-> cancelled             +-> revision_requested
charge: none -> provider_pending -> captured / failed / cancelled
refund: none -> requested -> partial / full / failed (can follow capture or transfer)
seller transfer: not_eligible -> pending -> settled / failed / reversed
dispute: none -> opened -> responded -> won / lost (can follow transfer)
order recheck: not_requested -> running -> recorded / unavailable / stale
Verify claims, when applicable: {VERIFIED, CONTRADICTED, UNSUPPORTED, NEEDS_HUMAN_REVIEW}
buyer: undecided -> {accepted, revision_requested, disputed, cancelled}
```

The local Workbench assessment and the four per-claim Verify states retain their existing, different schemas. An order stores references to those observations and a separate buyer/mediator decision; it never invents a fifth Verify verdict. Evidence is an input to the decision, never the financial ledger. A seller's “done” message is an unverified claim. Financial events are immutable and independently correlated to provider objects so a paid-out transfer can coexist with a later partial refund or chargeback. Invalid transitions are rejected by server-side state/version checks and unique idempotency keys; amounts are derived from a locked quote and provider ledger, never browser values. Missing, empty or malformed packet fields leave an editable local draft; an upstream auth, GitHub or billing failure leaves an explicit pending/error state with a safe retry. At 10x load, the likely bottlenecks are human quote/fill and hosted verification capacity, not browser animation. At 100x, queue age, Postgres indexes, attachment storage and seller support dominate. The plan therefore avoids an all-source crawler and arbitrary agent runtime.

Critical cross-field invariants are enforced in one transactional order service: a quote cannot be accepted after expiry or against a changed packet/version; checkout uses the locked quote and an eligible seller/provider account; work authorization requires provider-confirmed captured funds or the selected provider's documented equivalent; delivery requires the agreed repo, exact base/head and seller role; buyer acceptance and dispute race under one order version; payout follows the published resolution and provider capability, never a green model verdict. Idempotency keys are scoped by account, operation and order, paired with a request-body hash and durable response replay. Each accepted state transition, audit event and outgoing provider action is committed with an outbox record atomically, while provider event IDs have unique constraints and are reconciled after duplicate, late or reversed delivery.

Rollback means disabling **new** order creation, checkout and matching behind independent feature flags while keeping active-order read, delivery intake, dispute and refund paths online. If delivery writes are impaired, operators use a documented manual fulfillment queue for already-paid orders; they cannot silently mark them complete. Hosted schema changes are additive before deployment, with old and new code able to read the same order version, and a replay drill covers late webhooks and dead letters after rollback. A payment or webhook incident requires pausing payouts where the provider flow permits, reconciling provider objects against the append-only transaction log, and manual support; `git revert` alone cannot reverse money movement. The local app keeps working even if the hosted marketplace is unavailable.

### Error and rescue registry

| Codepath and named failure | Recovery / user-visible state | Test |
| --- | --- | --- |
| Local packet export: `MissingFinding`, `StaleSnapshot`, `PacketTooLarge` | Refuse publication; identify finding/revision or limit; leave review intact. | Unit and local API fixture. |
| Login/session: `ExpiredSession`, `TenantMismatch` | Reauthenticate or return 403; never reveal another order by ID. | Auth integration plus IDOR test. |
| Catalog/quote: `ListingUnavailable`, `QuoteExpired`, `QuoteVersionConflict` | Prevent checkout, show latest quote and new confirmation. | Concurrent two-tab test. |
| Payment provider: `PaymentDeclined`, `PaymentTimeout`, `WebhookSignatureInvalid` | Pending or failed order; no fulfillment on timeout; reconcile through provider event ID. | Selected provider sandbox/test-mode integration, forged/duplicate webhook. |
| GitHub link: `PermissionDenied`, `HeadChanged`, `RateLimited` | Pause work or recheck; show exact repo/head and retry guidance. | Permission, stale SHA and 429 fixtures. |
| Seller delivery: `MissingCommitRange`, `ScopeViolation` | Do not mark delivered; request a corrected PR. | Contract and role-based API tests. |
| Recheck: `RunnerUnavailable`, `CheckTimeout`, `EvidenceIncomplete` | `UNSUPPORTED` or `NEEDS_HUMAN_REVIEW`, no fabricated pass. | Isolated-runner failure tests. |
| Payout/refund: `TransferRejected`, `RefundPending`, `ChargebackOpened` | Retain financial ledger, pause closure, expose support state and retry/reconcile manually. | Selected provider's event reorder/partial reversal tests. |
| Outbox: `DeliveryRetried`, `DeadLettered` | Idempotent retry with alert and operator replay; no duplicate emails or payouts. | Queue retry and replay test. |

Every error event records correlation/order ID, stage, provider code, retry count and redacted context. It never logs credentials or project contents. Unknown exceptions fail closed for the money or evidence transition; the buyer gets a stable support code and recoverable state, not an invented success. AI router malformed response, empty output, timeout, refusal or unavailable credits all bypass optional routing and enter deterministic/manual triage.

### Security, data flow and interaction risks

Threats include unauthorized order access (high likelihood/impact without tenancy), private-code disclosure (medium/high), malicious seller patch or prompt injection (medium/high), forged or repeated payment webhooks (medium/high), and misleading “verified” badges (high trust impact). Countermeasures are tenant-scoped queries, managed auth with secure sessions/CSRF protection, server-side role checks, strict request schemas and sizes, webhook signature verification, unique event/idempotency constraints, append-only audit events, and never executing seller/project code on the marketplace API. A sandboxed runner must have per-job ephemeral storage, no credentials from PRAXIS, no network by default, bounded CPU/memory/time and explicit network consent for exceptional checks. Security review must also cover source-retention terms, seller identity, permission expiration, IP rights and incident response before live payment.

```text
finding + goal + source head
  -> validate current snapshot / consent / limits
  -> immutable packet digest + editable buyer request
  -> quote [seller, scope, amount, expiry, acceptance]
  -> locked order + payment event
  -> seller PR at exact commit range
  -> independent recheck + limitations
  -> buyer accepts, asks for revision, or disputes
  -> reconciled payout/refund; order audit retained
```

For each arrow: absent input prevents the transition; an empty optional evidence set is labeled “not checked”; wrong types/oversize are 4xx with field-level guidance; upstream errors keep the prior durable state. Browser double-clicks or two tabs resolve through idempotency and optimistic order version. Navigation away does not cancel a paid order. A delayed webhook never lets the UI claim payment from a return URL alone. Zero listings show a clear request-for-help path, while large lists are paginated and filtered server-side. A buyer who never responds triggers a disclosed human-resolution queue, not auto-VERIFIED; cancellation after work starts follows a published policy and transaction record.

### Code quality, tests, performance and operations

The current `apps/workbench/backend/regen/app.py` explicitly checks loopback host/client and origin; making it remotely reachable would violate its security model. The new commerce service must be a separate bounded context, using the local review output via a versioned packet schema. Do not add another verdict implementation to a hosted route or copy UI calculations into it; the authoritative checks remain in current review/Verify modules until a tested headless runner adapter can call them. Source sharing, order creation and settlement are separate named services to avoid one handler with many branches and mixed trust levels.

Tests begin with pure packet and state-transition properties, then tenancy and billing integrations, then a small end-to-end path in the selected provider's sandbox/test mode. Hostile QA cases include another user changing an order ID, a seller swapping the PR head after review, a “passing” irrelevant test, double checkout, reordered/duplicate webhooks, partial refund or chargeback after transfer, disappearing seller, empty catalog, long filename/Unicode, stale local snapshot and no market connectivity. The full coverage map is in `docs/testing/PRAXIS-MARKETPLACE-TEST-PLAN-2026-10-08.md`. Run the existing core suite, Promptfoo CONTRADICTED gate, backend tests, TypeScript, production build, privacy guard, tarball budget and package smoke whenever their touched boundaries change. A live payment release additionally needs provider test-mode events, buyer-initiated exact-SHA recheck, accessibility/viewport tests and a real but low-value controlled transaction after legal/account readiness. An isolated hosted runner is required only before promising automated self-serve rechecks. No new code was written in this planning pass, so existing regressions were not rerun as a claim of implementation quality.

Performance budgets are hypotheses to verify: catalog p95 under 300 ms from a nearby region, order-state read p95 under 500 ms, quote submission under 2 s excluding provider delays, and local first useful finding unchanged relative to current baseline. Index tenant/order/seller/status/created-at and provider-event IDs. Paginate listings and order timelines; cap work packet size rather than storing project trees in Postgres. Cache only public catalog data; never cache per-user order rights or payment state. Track queue age, fulfillment time, quote-to-purchase and verification wait as user-facing latency. Load-test 100 concurrent checkout attempts including idempotent retries before inviting a wider beta; these targets are proposed, not measured current performance.

Production telemetry should answer “where is my order?” without exposing code. Carry an order correlation ID through API, outbox, provider event, seller delivery and recheck. Measure conversion, available sellers, quote SLA, paid orders, successful delivery, rework, dispute/refund, gross margin, provider failures and false acceptance. Alert on paid-without-order, delivered-without-commit, payout-without-acceptance, webhook age, dead letters and assessment/receipt mismatch. Provide an operator-only reconciliation and dispute queue with an audit trail, not a general customer observability dashboard.

Rollout order: freeze `OrderPacket` schema and retention policy; validate paid concierge demand; confirm legal entity, first geography and eligible payment provider; stand up hosted auth and additive database migrations in staging; integrate provider test mode and event reconciliation; add seller/order client; verify one controlled end-to-end order; launch private beta with payouts manually reviewed; enable broader seller choice only after buyer outcomes. Rollback flags disable listing, new checkout and automated fulfillment independently, with manual delivery/refund/dispute service for paid orders. New checkout may be disabled while existing paid orders remain serviceable. The twelve-month risk is that transaction labor and code-access operations become the entire company; if acceptance evidence does not improve outcomes or repeat rate, return focus to project assurance rather than buying traffic for an undifferentiated agency.

### CEO review outcome and deferred scope

An independent GPT reviewer flagged seven issues; no Claude-model review was available, so this is not cross-model consensus. Its two critical findings were an unresolved strategic pivot and an undefined first billable order. This plan now treats marketplace as a narrow distribution wedge, specifies the first buyer/seller/deliverable, puts paid concierge validation ahead of infrastructure, and does not borrow ARR math from the older enterprise thesis. Independent demand remains unproved. The founder-level choice is whether this deliberate wedge is the intended pivot; implementation should not imply that decision has already been validated by sales.

Not in scope for the first live order: agent sellers running arbitrary code; automated patch application or merge; per-file GitHub ACL claims; seller rankings based on model opinion; trading, lead crawling, broad “AI agent store” categories; production deployment on the buyer's behalf; Jev as a verifier; governance dashboards; moving local evidence/memory to the cloud. These are deferred because they increase permission or evidence risk without proving the first transaction. Existing local review, CLI, receipt, memory, hooks and tray contracts remain preserved.

## Phase 2: Product design review

### Screen hierarchy and navigation

The local first screen answers one question: **What project should I check?** Keep the existing local path, folder upload and GitHub URL, with source-only review as the default. A returning user sees recent projects and their last checked state, never an agent console. Before an account exists, the browser trial stays honest: source inspection and a copyable prompt, not a cloud build or seller recommendation based on fabricated data.

The local review screen answers **What needs attention, why, and what can I do next?** Its first viewport has a one-line project status, one prioritized finding (or a clear no-blocker state), the evidence limit, and a primary action appropriate to the state: `Run checks`, `Draft fix plan`, or `Get a specialist quote`. The quote action appears only when the buyer deliberately selects an eligible, concrete issue. All current eight views remain accessible under `Details` or `Advanced` with stable deep links: Findings, Execution, Evidence, Changes, Workspace, Source map and Activity. No data or capability is deleted to make the first screen look simpler. Model identities, tool calls, DAGs and orchestration live behind the detail disclosure unless they explain a failure or cost the user must decide about.

The hosted buyer experience has four destinations: `Find help` (vetted specialists for the selected work category), `Request` (scope/quote and consent), `Order` (delivery/evidence/decision), and `Account`. A seller has `Requests`, `Work`, `Payouts`, and `Account`; role-specific navigation is server-authorized, not hidden only in CSS. The public landing page uses one hero action, `Test your project`, plus a secondary `See how fixes work` path. A marketplace promise is added only when real sellers and a transactable flow exist; no fake “completed jobs” badges or static seller inventory.

```text
PUBLIC SITE -> BROWSER TRIAL -> LOCAL REVIEW
                                  | project + finding + evidence limit
                                  +-> fix with own agent (existing)
                                  +-> run authorized checks (existing)
                                  +-> choose eligible finding -> explicit share scope
                                                                 |
                                                                 v
MARKETPLACE: seller choices -> quote comparison -> confirm price/permissions -> order
                                                                  |
                    <----------- delivery PR + recheck + buyer decision <-----------+
                                  | accept / request revision / dispute
                                  v
                            order history + recourse
```

Use the existing Geist/warm paper-slate-peach token vocabulary in `apps/workbench/app/tokens.css` for the local app and map it to a small, shared commerce token file; keep dark mode if currently selected. The `web/_src.html` marketing site and the local workspace are a hybrid, not one giant dashboard. The marketing hero is brand and one real example of “issue → scope → delivery → checked result”; the app is calm, task-focused and dense enough for code evidence. The videos' neon graphs, animating agent nodes and trading balances stay reference material for backend routing, not UI motifs. No decorative 3D scene, score confetti, generic three-card grid or invented seller metric belongs in a trust transaction.

### Buyer, seller and emotional journey

| Moment | Buyer needs and feels | Interface response | Seller needs |
| --- | --- | --- | --- |
| First five seconds | “Is this for my project, and is it safe?” | Plain `Test your project` and “source-only in this browser”; local setup is available without a card. | Clear category and eligibility, not a vague “join network” CTA. |
| After first review | “Can I trust this finding?” | One concrete finding with path/check source, impact and `not checked` where appropriate. | An immutable request packet, exact source revision, no hidden acceptance rules. |
| Before sharing | “Who gets my code and what will it cost?” | Separate consent screen naming the selected seller, GitHub access model, quote, deadline, limitations and revocation responsibility. | Confirmed access and a delivery window before work starts. |
| During work | “Is anyone actually progressing?” | One status line, next expected action/time, messages tied to order and a visible help path. | Work queue with scoped requirements and safe way to raise ambiguity. |
| Delivery | “Did this fix my issue?” | Diff/PR link, task-specific checks and their gaps, then distinct `Accept`, `Request revision`, `Dispute`. | Exact commit range, rejection reason and payout state. |
| Return after months | “What was decided?” | Order timeline, acceptance/recourse record and any signed evidence with its narrow meaning. | Completed-order record and transparent fee/transfer history. |

At five minutes, the buyer should understand the first finding and either continue with their own coding agent or submit a scoped request. At five years, the order history should explain what was asked, delivered, observed and accepted without relying on model prose. The interface builds confidence by exposing limits at decision points, not by flooding the first viewport with every check.

### Visible states, including failures

| Surface | Loading | Empty | Error | Success | Partial / stale |
| --- | --- | --- | --- | --- | --- |
| Project review | Source/job stage and elapsed time; cancel only where safe. | “Choose a folder, path or GitHub repo to inspect” plus the three input choices. | Named intake/network/model failure and retry action; no generic green badge. | Top finding or “No blockers found in inspected scope,” with check limits. | “Source reviewed; runtime not run” and a check action; stale snapshot asks for a fresh review. |
| Specialist search | Skeleton rows preserving filter controls. | “No specialist covers this issue yet”; copy existing fix brief or request human help. | Search service unavailable; local review still works. | Real eligible sellers with verified completed-order history only. | Seller unavailable/quote expired shown before checkout. |
| Quote and consent | Pending quote with expected response window. | Show exact scope fields and an example, never a pretend quote. | Validation highlights missing acceptance criteria or inaccessible repo. | Locked amount, deadline, access terms and buyer confirmation. | Changed source/head invalidates quote or asks for seller re-quote. |
| Checkout | Disable repeated pay, show “confirming with provider.” | No payment method: secure provider handoff. | Declined, timeout, or unknown; do not say paid on redirect alone. | Provider-confirmed paid order ID and next step. | Payment pending stays pending; no seller work authorization. |
| Work/delivery | Stage, owner and last update; no animated agent theatrics. | Awaiting seller action with agreed response deadline. | Seller delay/access failure and escalation route. | PR, exact SHA range, changed files and requested buyer action. | Recheck unavailable, stale or incomplete stays visibly unknown. |
| Assessment and dispute | Check progress, bounded time and cancellation rules. | No checks: “Nothing independently run yet.” | Test/runner failure with retry or human review; never auto-green. | Per-claim observations and buyer acceptance remain separate. | Contradicted/unsupported claims remain distinct; dispute entry is always available within policy. |
| Seller work | Invite/onboarding progress and prerequisites. | No eligible requests: explain category and availability settings. | Permission revoked, stale head, delivery rejected or account issue with next step. | Quote or PR submitted with exact version, buyer notified. | Revision, dispute or payout pending stay visible with dates and support path. |

Interaction rules: all pay/deliver/accept buttons show in-flight state, have stable idempotency keys, remain keyboard reachable and announce result/errors with live regions. A browser back action returns to the durable order, never creates a second charge. A seller or buyer can resume after closing the tab. Currency and total are visible before entering payment details; all model or verification spend that can be charged is stated separately. A 47-character project name wraps; code paths and hashes use monospace and safe overflow; 10,000 findings are never rendered in one DOM list.

### Responsive and accessible specification

At 1440px and 1024px, use a primary reading column plus a narrow context rail for price, next action and evidence status. At 768px, the rail moves below the decision content and the order timeline uses a single column. At 390px and 320px, keep one visible primary action, a short project title, key status and a `Details` disclosure; long paths wrap or scroll within their code container without page overflow. Do not hide the distinction among `not run`, `unsupported`, `contradicted` and `verified` behind color alone. Test light and dark contrast at >=4.5:1 for body text, 44px touch targets for decisions, visible labels outside fields, logical focus return after dialogs and full keyboard navigation for findings, quotes and dispute forms. Motion is nonessential and honors reduced-motion preferences.

The design hard-rule check rejects a dashboard-card mosaic on first arrival: the current eight-tab layout is an expert surface, so it becomes progressive detail. Cards earn their place only for selectable findings or sellers; the review narrative itself is a document-like workspace. Visited links differ from unvisited, including external PR links. Seller profiles show only measured categories, response window, completed-order counts and explicit “new seller” status; no model-generated reputation number or vendor logo implies certification.

The seller flow is specified independently of the buyer's: apply to a curated category -> identity and payout onboarding -> inspect a redacted request -> decline, ask for clarification or quote -> wait for payment confirmation and buyer-granted access -> work against recorded head -> flag changed head/access loss or deliver a PR bound to exact SHAs -> answer a revision request or dispute -> see payout pending, completed or failed with fee detail. Quotes expire; a change in scope or price creates a new version requiring buyer consent. A seller cannot see full source or contact the buyer off-platform just because they can view a redacted request. The beta sets and discloses a quote response target, revision cap and dispute evidence requirements before checkout; founder/legal review fixes the actual durations and cancellation terms before launch, not a frontend placeholder.

The design reviewer inspected source only, not a rendered UI. Its starting plan scores were information architecture 4/10, buyer journey 5/10, seller journey 3/10, state completeness 4/10, evidence/trust 8/10, responsive/accessibility 3/10 and copy/visual discipline 6/10. The screens, seller flow and state table above address those specification gaps; none is evidence of shipped interface quality. It also flagged `ReviewWorkspace.tsx:46-47` as eight peer tabs with keyed view replacement and `ReviewOverview.tsx:20-25` as language that can overstate a source-only review. Implementation must test stable focus/deep links and make source-only limits explicit before surfacing paid help. Open design decisions at the final gate are the first paid buyer segment, whether a local-only project can purchase before moving to GitHub, and what source access policy is acceptable. The recommendation is Git-backed first orders with explicit buyer-managed access; local-only users retain the free review and own-agent path until safe sharing is built.

## Phase 2.5: Developer experience review

The primary developer persona is a solo builder or engineering lead using an AI coding agent on a real GitHub-backed JavaScript/TypeScript project. They can run Node 22 but may have no Docker, payment account or model API key. Their goal is to discover one credible issue, understand what PRAXIS actually checked, and either use their current agent or request accountable help. The seller persona is a vetted developer who needs a stable contract and repository revision before quoting; the operator persona needs to reconcile orders without reading private source by default. Today the browser trial, local review and own-agent handoff exist; marketplace checkout, sellers and paid fixes are proposed and must be labeled `planned/private beta` until a real live order works.

The first “magical moment” is not a signed receipt or a spinning agent graph. It is seeing a specific, source-linked concern beside “checks not run” and a usable next action within the first review. The second is receiving a scoped quote for that exact concern with a named seller and an acceptance rule. The plan does not assert either timing has been measured. Target a browser source preview with no install and a local first useful finding in under five minutes on a representative small repo after prerequisites are present; report actual p50/p95 cold and warm times during beta, including initial dependency downloads. The release candidate named in README is not yet a published consumer command.

| Stage | What the developer does now | Target experience and measurable friction |
| --- | --- | --- |
| 1. Discover | Opens the public site and sees `Test Your Project`. | Headline states that the browser scans source only; no account or install needed. Measure trial starts from landing, without tracking private file names. |
| 2. Try | Selects files for `web/test-your-project`. | Source-only findings plus a copyable agent prompt; “No tests or app code were run” next to results, not hidden in FAQ. |
| 3. Install | Uses checkout `node src/cli.js review`; published users would use `npx praxis-memory review` after release. | One copyable command per OS, Node 22 prerequisite, exact package/version status, initial download/progress and retry if setup fails. No Docker requirement for first review. |
| 4. Connect project | Chooses local path, GitHub HTTPS URL or upload. | Clear source boundary, exclusions and Git auth/network errors. A GitHub URL never silently becomes a seller-access grant. |
| 5. First result | Reads the review summary. | One finding or honest no-blocker-in-scope state, source revision, what ran/did not run, one next action. |
| 6. Act locally | Copies brief to their agent, drafts plan or authorizes checks. | Existing paths stay one click away; trust and budget gates state what leaves the machine and what commands can do. |
| 7. Hire, if needed | Selects a concrete finding and seeks a quote. | Account requested only at order/quote submission; consent previews the precise packet and access method. If no seller exists, free own-agent path remains. |
| 8. Debug/decide | Views payment/work/recheck failures and delivery. | Stable order ID, event history, exact next step, human help path and independent evidence limits. No redirect-based “paid” or seller-based “verified” claim. |
| 9. Return/upgrade | Reopens saved project, upgrades app or revisits an order. | Local evidence remains untouched, order records remain accessible, packet schema is versioned, and old review/receipt formats are not migrated automatically. |

Five concrete error examples must improve in UI and docs. (1) A GitHub clone timeout is currently a local intake failure: show `GIT_NETWORK_UNREACHABLE`, the host, whether Git credentials were even reached, and retry/local-folder paths; never instruct a user to rotate credentials when the server could not connect. (2) A source-only review can finish while runtime is untested: show `RUNTIME_NOT_RUN`, with an action to select host or Docker execution and the relevant trust statement, not “all good.” (3) A browser folder upload excludes a critical file over 2 MiB or crosses the 100 MiB total cap: show `INSPECTION_INCOMPLETE`, affected counts/names where safe, and the local-path option; do not imply the finding covers the whole project. (4) A buyer returns from checkout before the payment webhook: show `PAYMENT_PENDING`, the order ID and a safe refresh; do not grant seller access or call the order paid. (5) A repository HEAD moves after quote: show `SOURCE_REVISION_CHANGED`, old and new short SHAs and the action to rerun review/requote while preserving the draft. Error codes should map to a short explanation and one recovery action, with developer details expandable and secrets redacted.

CLI and API naming remain scoped: `verify` checks a commit-bound agent claim; `review` starts local project review; `Test your project` on the web is a source preview; `Get help` begins a marketplace request. Marketplace mutations use versioned JSON over an authenticated hosted API with idempotency keys, typed client contracts, pagination and correlation IDs. The local packet's version and SHA are visible to the developer. Documentation has three entry points: a 60-second source preview, a copy-paste local review quickstart, and an order walkthrough that explains access, price, evidence, revisions, dispute and payout. Reference docs specify packet schema, state transitions, provider failures, and which data is shared. Tutorials should show real example output and limits, not dummy sellers or fixed success text.

The package upgrade path is opt-in and reversible. An existing CLI install, hook, `.praxis` file, HMAC receipt or Verify receipt keeps its behavior. New marketplace support is an optional Workbench capability, not a dependency of the zero-runtime-dependency CLI. The hosted API accepts a documented range of packet schema versions and returns a migration-required response for older clients without altering local evidence. Seller and buyer web sessions are separate from local PRAXIS memory. Windows is a primary test platform in this checkout, but support claims for macOS/Linux require clean-machine tests; desktop tray packaging is not a prerequisite for commerce.

The buyer can report an incorrect finding, misleading seller claim or confusing order state from the exact screen, attaching a redacted order ID but no source by default. Offer a public changelog, runnable example repos, a clear support response policy and transparent fees. Measure time to first useful finding, review-to-request, request-to-quote, quote-to-paid, and failed setup reasons with opt-in, privacy-preserving product events; never instrument private filenames, source excerpts, `.env` contents or model prompts as general telemetry. Do a monthly friction audit of the nine stages. The community path is documentation and examples first, not an open plugin registry before seller screening exists.

An independent GPT DX reviewer scored the starting proposal 5/10 for first useful review, 4/10 for naming, 5/10 for docs and errors, 4/10 for compatibility, 5/10 for cross-platform support, 6/10 for tooling and 3/10 for community/feedback. These are source-review judgments, not measured user behavior. Its priority fixes are now explicit: publish an availability/entrypoint comparison; give a worked `OrderPacket` example and older-client behavior; test clean installs on Windows/macOS/Linux; show excluded upload scope; and make private-beta support safe to use without uploading code by default. The known developer gap is that the consumer `0.14.2` managed-release command is still a release candidate and commerce has no live path; the plan cannot claim a five-minute real order today.

### Versioned handoff contract and worked example

The smallest new contract is `OrderPacketV1`, exported by the local Workbench after the user selects one current finding. Its required fields are `schema_version`, `packet_id`, `nonce`, `project_source` (`github`, repository identifier and exact 40-character head SHA), `review_snapshot_digest`, `finding_id`, `finding_summary`, `buyer_goal`, `acceptance_criteria`, `observed_checks`, `unperformed_checks`, `share_scope`, `consent_at` and `expires_at`. `share_scope` is a field-level and recipient-level allowlist, not a blanket permission: the candidate seller first sees a redacted work summary and acceptance criteria; the operator sees order metadata; the buyer sees the full packet. No source excerpt, full diff, `.env`, `.praxis` memory or runtime log is included by default. If an excerpt is needed to price the work, the buyer separately chooses its exact range and recipient; a later scope expansion requires fresh consent. The exporter validates the finding against the saved snapshot, computes a canonical packet digest, shows the complete payload and recipient visibility in a preview, and requires an explicit `Share this request` action. Existing `AgentBrief` and regex secret redaction are not suitable publication allowlists. The hosted API checks version, size, user identity, expiry, nonce replay, digest and repository revision before creating a draft; unsupported old versions return a documented `PACKET_VERSION_UNSUPPORTED` response without modifying local data. A buyer-managed GitHub invitation after payment is separately disclosed as potential **full repository access**, regardless of the packet's narrower fields.

A **documentation fixture**, not a live listing or real customer result: a local review flags an unhandled network error in `src/api/profile.ts` at revision `H0`. The buyer's goal is “show a retry action when profile loading fails.” The packet shares that summary, `H0`, the fact that only source inspection ran, and acceptance criteria “a network failure produces a recoverable error state; a successful response still renders the profile; tests exercise both paths.” It excludes source text by default. A vetted seller quotes one pull request and one revision against `H0`; after payment confirmation the buyer grants repository access. The seller delivers PR `P1` spanning exact commits `H0..H1`. The local recheck binds its observations to `H1`, discloses which tests were actually run, and records unsupported checks. The buyer then accepts, requests a revision or disputes under the published policy. If the repository moves to `H2` before quote acceptance or delivery, the order displays `SOURCE_REVISION_CHANGED`, preserves the draft and requires re-review or an agreed new base; it does not present the stale check as current.

### Optional Jev decision routing, with a quality gate

TypeSafe's [System One docs](https://docs.typesafe.ai/introduction), [quickstart](https://docs.typesafe.ai/introduction/quickstart) and [confidence explanation](https://docs.typesafe.ai/confidence) describe a direct typed choice/score API over supplied state. The candidate adapter would ask bounded questions such as `needs_deep_model_review: yes/no/abstain` and `eligible_fix_category: supported_category/other/abstain` using a redacted finding summary plus known evidence state. It does not fetch pages, inspect code by itself, write a fix, verify a claim, rank seller quality or decide payment. It never suppresses deterministic high-severity findings or source/runtime limitations. A low-confidence, malformed, unavailable or rate-limited answer routes to the current full/manual path.

Before enabling it, acquire an eligible API account and measure on a consented, labeled set of actual PRAXIS findings: missed actionable blocker rate first, then category precision, added latency, cost per completed review and privacy impact. Run in shadow mode against the existing route and retain per-decision provenance. Only enable a narrow route if blocker recall is non-inferior to baseline, abstentions have a safe fallback, and measured cost/latency justify the dependency. The vendor's speed/cost figures and probability-derived confidence are hypotheses for PRAXIS traffic, not product guarantees or proof of correctness. A direct HTTP adapter behind a feature flag is sufficient; neither LangGraph nor a crawler is necessary for this decision point.

## Phase 3: Engineering review

### Scope challenge, existing code and component ownership

The objective needs a multi-file, multi-service change: trying to squeeze payments, identity and seller permissions into the local Workbench to reduce file count would violate its loopback trust boundary. The bounded implementation keeps three owners. `apps/workbench/backend/regen` owns local source inspection, current-snapshot freshness, exact Git SHA capture and the export/recheck adapter. The existing `src/lib/verify` owns commit-bound atomic claim checking and its own receipts; it is called through a tested local adapter, never copied into a hosted route. A **new** hosted marketplace owns identity, catalog, request/quote/order lifecycle, ledger, provider events, support and outbox. Its UI reads server-owned order state rather than calculating verdicts or payments in React. The public `web` site supplies an accurate entry link and source-only trial; the zero-runtime-dependency CLI, legacy receipts, memory, hooks and tray keep their contracts.

Current `scanner.py` clones GitHub source and records a source fingerprint, not a commit SHA; `projects.py` cannot establish current remote HEAD from a status read; `app.py` enforces loopback and explicit execution trust. `ReviewWorkspace.tsx` exposes eight first-level sections, while `ReviewOverview.tsx` can sound more conclusive than source inspection warrants. `src/lib/verify/index.js` evaluates claims against a local Git target but is not an order-acceptance engine. These are code-observed scope findings, not speculative reasons to rewrite the reviewer. The new packet exporter, hosted order service and provider integration are additive; they do not migrate `.regen` or `.praxis` state. Distribution is explicit: the local capability rides a later tested npm release, and the hosted service needs a separate deployment pipeline, migrations, preview/staging, rollback and health checks.

```text
web source trial ---------------------> local review call-to-action
                                             |
local Next UI -> loopback FastAPI -> scan/job/snapshot + exact Git SHA
                              |                |
                              |                +-> buyer-run recheck -> native Verify adapter
                              v
                      OrderPacketV1 exporter -> explicit local file
                                                    |
                                                    v buyer import + account
hosted Next UI -> authenticated marketplace API -> Postgres/RLS + immutable events
                         |                                |         |
                         |                                |         +-> outbox/reconciler
                         +-> seller role/scoped view       +-> provider adapter/webhooks
                         +-> buyer order/recourse
```

The hosted schema begins with identity/roles, seller eligibility, requests, packet submissions, immutable quote versions, orders, order events, provider events, charges, refunds, transfers, disputes and outbox rows. Only provider-required token references are stored; payment instruments never enter PRAXIS. Every exposed row is tenant/role constrained, and server-only service credentials do not reach clients. Use transactional migrations with additive compatibility, a unique provider-event key, account/operation/order idempotency plus request hash, compare-and-swap order versions, and atomic state/audit/outbox writes. `coordination.py` already demonstrates request hashes and compare-and-swap in a different local workflow; reuse the pattern concept, not its SQLite store as a commerce ledger. Define provider-specific policy before implementing the adapter because payout timing and reversal capability differ.

### Code quality and complexity decisions

There must be one status vocabulary per domain: Workbench assessment, Verify per-claim verdict, order workflow, buyer resolution and financial ledger are separate types with explicit mappings. `VERIFIED` stays reserved for a supported Verify claim; UI copy may say “seller delivered” or “buyer accepted” without turning those into verification claims. The shared packet contract should be a small versioned schema fixture usable from Python and TypeScript with cross-language canonicalization tests; do not duplicate mutable business rules in both languages. Keep payment reconciliation in one server module and let the browser render durable states. Avoid a generic AI framework or crawler in a five-step order flow. Host app dependencies are allowed, but they must not leak into the dependency-free CLI tarball or exceed its package budget.

The minimum pilot is not permission to omit security or recourse: even a manually brokered order needs eligibility, identity, exact scope, quoted price, payment confirmation, seller access, delivery, buyer-side recheck, acceptance/revision/dispute and reconciliation. Self-serve seller listings, automated matching and hosted execution can follow only after this transaction works. The Jev adapter is lower priority than the existing source→finding→order path and remains behind a shadow evaluation. This is a complexity tradeoff in *when* components appear, not a proposal for an incomplete customer order.

### Test review and failure modes

The companion [marketplace test plan](../testing/PRAXIS-MARKETPLACE-TEST-PLAN-2026-10-08.md) maps each proposed path to unit, integration, E2E or eval coverage. Every marketplace path is currently a gap because no commerce backend exists. Existing Workbench and Verify tests cover their own behavior but cannot be counted as order or money tests. The compact diagram below is the release-critical subset:

```text
Git intake -> SHA/fingerprint -> packet allowlist -> consent -> hosted import
    |           |                   |             |          |
    +-- Git/HEAD tests              +-- privacy/version tests  +-- auth/RLS/replay E2E
quote/version -> provider captured event -> seller access -> exact PR SHA
    |                  |                    |                 |
    +-- stale/two-tab  +-- sandbox webhook E2E  +-- role E2E  +-- force-push E2E
buyer local recheck -> per-claim observations + explicit limits -> buyer choice
         |                         |                          |
         +-- static/trust tests    +-- false-success eval      +-- accept/dispute race E2E
financial ledger -> refund/transfer/dispute -> outbox/reconciliation/rollback
         |                    |                    |
         +-- state properties +-- provider events +-- replay/manual rescue E2E
```

| Failure mode | Current test/handling | Required prevention and visible rescue | Critical before |
| --- | --- | --- | --- |
| Git SHA absent, stale, force-pushed or dirty snapshot | Current review has fingerprints but no paid-order SHA contract. | Capture SHA and exclusion/dirty status; stale-state integration tests; stop quote/delivery and show re-review. | First order |
| Packet leaks private source or is replayed | No packet exporter, allowlist or import test exists. | Recipient-level preview, canonical digest, expiry/nonce, privacy canaries and hosted validation; reject with recovery. | First hosted draft |
| Cross-tenant order read or seller scope escalation | No marketplace auth/RLS exists. | Negative role/RLS/IDOR E2E and server-side authorization for every transition; return 403. | First hosted draft |
| Quote accepted after price, head or scope changes | No quote/order service exists. | Immutable quote versions, exact SHA and optimistic lock; prompt for a fresh quote. | Checkout |
| Redirect, duplicate or forged webhook reported as paid | No provider integration exists. | Signed provider events, unique IDs, captured-funds policy, durable replay and test-mode E2E; retain pending. | Checkout |
| Seller green CI or irrelevant test mistaken for fix | Existing checks distinguish some observations, no order recheck link. | Buyer-run native static/optional trusted recheck, exact head and acceptance separation; show incomplete/contradicted. | First delivery |
| Refund/dispute after payout loses money-state history | No commerce ledger exists. | Independent charge/refund/transfer/dispute records, reversals and reconciliation drills; show support status. | Checkout |
| Deploy rollback strands a paid order or late event | No hosted rollout path exists. | Additive migration, paid-order manual queue, webhook/dead-letter replay drill; retain buyer access. | Private beta |

All eight are **critical gaps today** because the proposed paths do not yet have implementations or tests; the plan assigns each to a gate before the first affected live action. The known baseline checks to preserve are `npm test`, `npm run test:workbench`, `npm run typecheck:workbench`, `npm run build:workbench`, privacy guard, package budget/smoke and the existing Promptfoo Verify gate when verification logic changes. No pass is claimed from the planning review. New tests must assert false-success and partial evidence, not merely a route returning 200.

### Performance, deployment and independent challenge

Catalog and order-read p95 targets in Phase 1 are proposed service goals, not a buyer-journey SLA. Instrument cold Git intake, first useful finding, request→quote, provider confirmation, delivery, buyer local recheck and settlement separately, including p95 and error rate. The main 10x risk is human seller capacity and support; 100x also stresses webhook/outbox queues, DB indexes and review concurrency. Paginate listings/events, bound packet size and never store project trees in Postgres. Load-test 100 concurrent checkout retries and a late-event backlog with financial invariant assertions; measure false acceptance and margin per completed order. Caching is only for public catalog, never order rights or payment state.

The independent GPT engineering review found seven high-confidence issues: missing SHA, undefined first recheck, incorrect money-state model, vague packet consent, unresolved trust crossing, implicit idempotency/invariants and rollback/load gaps. All seven are incorporated above or in the test plan. No Claude-model second voice was available, so the review has **one independent GPT voice plus the root engineering pass**, not claimed cross-model consensus. The architecture's separation is sound conditional on the new contracts; a live checkout is blocked until identity, country/provider, provider lifecycle and reconciliation are tested. Failure handling, security and deployment are incomplete in the current code because the marketplace has not been built.

| Engineering dimension | Root review | Independent GPT review | Resolution in plan |
| --- | --- | --- | --- |
| Architecture | Separate hosted context, explicit packet | Sound split; SHA and handoff gaps | SHA capture, import boundary and recheck contract |
| Tests | New flow needs full integration coverage | Critical gaps across packet, money and delivery | Dedicated test artifact and release gates |
| Performance | Human throughput before animation | Whole-journey and rollback waits missing | p95 stages, 100 retry/load and replay drills |
| Security | No public loopback; tenant/provider gates | Packet leakage and role escalation | Recipient allowlist, RLS, consent and role tests |
| Errors | Durable pending/unknown states | Idempotency and partial check gaps | Cross-field invariants and failure registry |
| Deployment | Staged beta and additive migrations | Paid-order rollback path missing | Manual rescue, late-event replay and flags |

Engineering completion: scope challenged against actual local and Verify code; architecture and failure/test diagrams produced; four review areas covered (architecture, code quality, tests, performance); eight critical current gaps assigned to implementation gates; independent reviewer findings incorporated. This review is a plan, not a production or test certification.

## Cross-phase themes and decision audit trail

Three issues recurred independently: (1) the buyer must understand what was **actually** checked before paying; (2) source sharing must be explicit and limited, while GitHub repository access is a separate and broader grant; (3) the full order must survive absent supply, partial rechecks and payment failures. CEO, design, DX and engineering reviews each identified a part of these concerns. The design-review scores and DX scores are source-level judgments; no rendered marketplace interface or usability study was performed.

| # | Phase | Auto-decision | Principle | Why this option; what was rejected |
| --- | --- | --- | --- | --- |
| 1 | CEO | Make one GitHub-backed JavaScript/TypeScript PR fix the first paid category. | Test an actual transaction. | Reject generic “all AI agent jobs” launch before supply/evidence. |
| 2 | CEO | Validate with interviews and five paid concierge orders before self-serve supply. | Demand before platform scale. | Reject catalog cards as proof of marketplace demand. |
| 3 | CEO/Eng | Keep commerce outside local loopback Workbench. | Preserve security boundary. | Reject exposing `app.py` to the internet. |
| 4 | Design | Present Review → Get help → Orders, keeping detailed evidence accessible. | Decision-first interface. | Reject eight equal first-run tabs or decorative agent graphs. |
| 5 | DX | Make browser source trial, local review and paid request three accurately named stages. | Honest first result. | Reject calling static browser inspection a runtime test. |
| 6 | DX/Eng | Use an explicit, versioned, recipient-scoped packet file import for the pilot. | Reviewable privacy crossing. | Reject silent sync or a remote localhost API; defer one-click pairing. |
| 7 | Eng | Capture/revalidate exact Git SHA before quote and delivery. | Bind evidence to source. | Reject treating a file fingerprint as a Git commit. |
| 8 | Eng | Require buyer-side local recheck in pilot with stated limits. | Seller cannot self-certify. | Reject promising an unbuilt hosted runner or green CI as proof. |
| 9 | Eng | Keep charge, refund, transfer and dispute as separate financial records. | Real provider semantics. | Reject one payment enum or a provider-agnostic escrow claim. |
| 10 | Eng | Keep Jev in measured shadow routing only. | Fast decisions need quality evidence. | Reject suppression of findings or verdict control by a probabilistic model. |

## Implementation tasks and gates

| Order | Priority | Deliverable | Gate that proves completion |
| --- | --- | --- | --- |
| 0 | P1 | Confirm first operating entity, buyer/seller geographies, lawful service terms and an eligible provider/settlement flow; interview 20 buyers and complete five paid manually brokered orders. | Recorded user needs, real invoices/outcomes and provider eligibility; if unavailable, keep commerce in test mode. |
| 1 | P1 | Add exact Git remote/SHA and exclusions to local review, with current-head validation; retain existing fingerprint and old-record behavior. | Backend tests for clean/dirty/force-push/offline; old reviews still readable. |
| 2 | P1 | Add `OrderPacketV1` validation, canonical digest, recipient-specific preview, consent and local export; add hosted authenticated import. | Cross-language, privacy, replay, expiry, version and tamper tests; no automatic source upload. |
| 3 | P1 | Build hosted identity/RLS, seller eligibility, catalog/request/quote/order API, append-only events and outbox with versioned transitions. | Role/IDOR/RLS, stale quote, idempotency and double-click E2E. |
| 4 | P1 | Implement one legally eligible provider integration and separate charge/refund/transfer/dispute reconciliation. | Official provider sandbox/test-mode flows including late/duplicate/forged webhook, partial refund and transfer failure. |
| 5 | P1 | Build buyer/seller journey screens, fulfillment PR reference, buyer local recheck import and dispute/support path. | Exact-SHA positive and false-success tests; full buyer/seller browser E2E and 320px/keyboard QA. |
| 6 | P1 | Run a controlled paid order and rollback/replay drill, then private beta with manually reviewed payouts. | Actual buyer receipt/PR/recheck/decision/financial reconciliation; no silent paid-order orphan. |
| 7 | P2 | Self-serve seller choice and automated isolated runner after repeat demand and security review. | Two viable sellers/category, repeat orders, sandbox/permission tests and measured service levels. |
| 8 | P3 | Evaluate Jev as an optional direct typed router, plus more categories only with their own acceptance oracle. | Shadow-mode blocker-recall/cost/latency gate; no change to Verify verdicts. |

Tasks 1 and the packet schema must settle before hosted import; provider policy must settle before checkout schema; fulfillment must wait for confirmed payment semantics. The local SHA/export lane and hosted identity/catalog lane can be developed in separate worktrees after the packet contract is frozen, with integration tests joining them before checkout. Provider and seller UX can proceed in parallel only after order states and provider policy are fixed. The first milestone is a real, bounded transaction, not a marketplace-themed redesign. The explicit deferred scope in Phase 1 and tasks 7-8 belongs in `TODOS.md` until its gates are met.

## Final decisions requiring founder input

1. Is the first paid wedge a **vetted human specialist delivering one GitHub JavaScript/TypeScript pull request**, with the buyer retaining merge control? This is the recommended narrow starting point for the requested broader marketplace.
2. What country is the marketplace operating entity legally registered in, and where are the first buyers and sellers located? This determines whether a marketplace payment flow is actually available; timezone and developer location are insufficient.
3. Is the buyer-managed GitHub invitation acceptable for the first paid orders, understanding it may expose the whole repository to the seller? If not, the first order needs a different, separately reviewed work-sharing mechanism before checkout.

Status at this gate: research and plan complete; marketplace implementation, user trials, provider eligibility and the new tests are **not complete**. No existing source, receipt, memory, hook or evidence was changed by this planning pass.
