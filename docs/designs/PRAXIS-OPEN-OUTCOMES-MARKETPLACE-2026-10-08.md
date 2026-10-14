# PRAXIS open outcomes marketplace — CEO product and system review

Status: **product direction selected; implementation not started**. 2026-10-08. This is the canonical Option C plan. It supersedes the Option B recommendation in [the earlier marketplace review](PRAXIS-MARKETPLACE-2026-10-08.md), retaining B's transaction discipline. No marketplace accounts, listings, orders, payments, or hosted verifier are claimed to exist today.

## Decision and product promise

PRAXIS becomes an **open marketplace for verifiable project outcomes**. A builder or team reviews a project privately, chooses a concrete result they need, compares eligible human specialists, human-led teams, and operated AI agents, then commissions one provider. The order freezes the goal, source revision, access, price, acceptance criteria, and evidence plan. Delivery is independently rechecked where possible; the buyer sees exactly what was and was not established, then accepts, asks for revision, or disputes. Payment and recourse follow the order contract, never an AI verdict alone.

“Open” means a person or organization can apply, create a draft listing, and qualify through published eligibility criteria. It does **not** mean arbitrary code can run in a buyer's machine or that every submitted listing is immediately trusted. An agent is a fulfillment method; an accountable person or organization is the seller of record, handles support and disputes, and receives any payout. The platform admits providers on capability and safety criteria, not by invitation-only curation. The first commercial cohort can be tightly scoped while this open-provider model is built from the start.

The user selected **Option C**, with **Option B's essential kernel**: bounded scope, transparent quote, accountable delivery, independent recheck, buyer control, immutable financial events, revision/dispute/refund, and honest support states. This rejects the earlier B end state of human-only managed fixes. It also rejects the unsafe interpretation of C in the earlier alternatives table: uploading arbitrary agent packs, executing them without isolation, or releasing money when a model says “verified.”

### The unit of trade

One listing is a **capability to deliver an outcome**, not a model name or a vague “AI expert.” Every published listing defines: eligible project/input types; concrete deliverable; time/price model; seller/operator identity; tool and data permissions; revision policy; a category-specific `AcceptanceTemplateV1`; and a testable evidence plan. The template describes which observations a future order must supply; it contains no buyer repository SHA or result. After the buyer's baseline is observed, the order instantiates `AcceptanceSpecV1` and snapshots the listing plus the particular task, source identity, exact revision, exclusions, acceptance examples, access grant, quote, currency, and due date. “Verified” is never a marketplace-wide badge: each claim carries its actual evidence scope.

Initial demand wedge: an AI-built, GitHub-backed JavaScript/TypeScript project with a **reproducible regression**. The buyer supplies expected behavior and an allowed test command or user journey; after explicit runtime trust, PRAXIS observes the failure at the base SHA. Launch category 1 is this narrow regression-to-PR fix. If baseline execution is refused or unavailable, the user can still request a human-reviewed consultation later, but PRAXIS does not sell an evidence-backed “fixed” outcome in this launch category. A second adjacent category (adding an independently observed test or user-journey check) is eligible only after its acceptance adapter and a paid pilot pass. The catalog and provider onboarding support multiple categories and provider modes from the start. The **open marketplace beta gate** is at least two independent providers, including one operated-agent route and one human or human-led route, able to complete the same eligible category under the common order contract. A concierge pilot is evidence of demand, not a claim that open supply exists.

For the operated-agent beta, the responsible operator can run their own agent in their own controlled workspace, submit a PR, and answer for its result. The operator **discloses** tools, data access, network and model use, but PRAXIS cannot enforce every tool used in the seller's own environment. Buyer-granted repository scope is enforced by GitHub permissions, not by that disclosure. PRAXIS does not accept arbitrary agent binaries or grant an agent a direct checkout or payout API. A later PRAXIS-hosted execution option is separately gated by enforceable sandbox, permission and incident-response tests; until then, label listings “operator-run agent, not platform-isolated.”

The first **paid pilot** is limited to public GitHub repositories, so an independent observer can read the repository identity, base/head commit and current ref without a buyer credential. Local reviews of private repositories remain supported, but no private-project marketplace quote is offered until the buyer installs a narrow, selected-repository **read-only GitHub App** for PRAXIS; its metadata/contents permissions, revocation and token storage need a separate security test. Seller repository access is a different buyer grant and cannot substitute for PRAXIS's read grant. If the public pilot does not produce qualified demand, revisit the cohort rather than misstate an unverified private SHA.

### Market hypothesis and validation

Existing products already cover pieces of this job: [GitHub Copilot cloud agent](https://docs.github.com/en/enterprise-cloud%40latest/copilot/tutorials/cloud-agent/improve-a-project) can act on an issue and produce a PR; [Vercel's Agent Code Review](https://vercel.com/docs/agent/pr-review) validates suggested patches; [Upwork Project Catalog](https://www.upwork.com/services/) sells fixed-scope development services. PRAXIS's hypothesis is the **portable acceptance/evidence/recourse contract across human and agent providers**, starting from a real project review. That differentiation is unproved. Conduct 20 qualified buyer interviews before committing to a hosted build; seek at least five buyers willing to enter the same paid regression-fix pilot and two eligible supply candidates. After M1 establishes the contract and a lawful billing path, complete five real, paid, same-category brokered orders before declaring demand. A provisional expansion gate is at least four of five delivered within frozen scope, no more than one refund/dispute, a recorded buyer comparison against their own agent or freelancer alternative, and non-negative contribution margin on at least three orders after payment, model, recheck and support costs. This small sample is a directional gate, not product-market-fit proof; revise the offer rather than scale the catalog if it misses. Then test self-serve listing-to-order conversion and repeat buying. Do not count catalog traffic, AI mentions, or GMV as successful outcomes.

The market takes commission on completed orders under a disclosed fee schedule; pricing, take rate, acquisition cost, support cost, payment fees, verification cost, dispute loss, and contribution margin must be measured per category/provider mode. No revenue forecast is inferred from the videos or vendor benchmarks. Payments cannot launch until the operating entity and buyer/seller countries are known and a provider supports this exact funds flow. [Stripe Connect's marketplace guidance](https://docs.stripe.com/connect/marketplace) is a design reference, not proof of eligibility; country-specific restrictions require direct review. Reviews, ranking and search must not imply measured quality before real delivered orders exist.

### Visual research and Jev

The four supplied videos were frame-sampled in the earlier review. They show a graph/revenue concept, a typed decision graph, a trading-style control room, and crawl/source material. They suggest useful behind-the-scenes routing, not a customer-facing PRAXIS interface or evidence of sales, accuracy or P&L. The customer UI should show decision, scope, provider, delivery, and next action.

[TypeSafe's Jev introduction](https://typesafe.ai/blog/introducing-system-one-models-and-jev) describes an early-access typed probabilistic decision model over supplied state; it is not a crawler or verifier. An optional shadow adapter could rank listing relevance or route low-risk triage only after labeled measurements of missed actionable blockers, abstentions, cost and latency. It cannot suppress high-severity findings, authorize source access, certify a delivery, decide a dispute, or release payment. A deterministic/manual route remains available without an API key.

## What already exists

| Existing component | Reuse | Missing marketplace boundary |
| --- | --- | --- |
| `apps/workbench/backend/regen/scanner.py`, `reality.py`, `harness.py`, `review.py` | Local source/static/runtime observations and accurately bounded assessment | Immutable `AcceptanceSpec`, exact Git SHA at intake, order recheck adapter; keep source-only/unknown distinct from demonstrated behavior |
| `projects.py`, `coordination.py`, `agent_work.py` | Project identity, task/decision history, snapshot freshness, installed-agent plan on disposable copy | Hosted identity, seller-of-record, payout authority; a local agent's completion remains a claim |
| `src/lib/verify` | Separate exact-commit claim checks and Ed25519 receipt where applicable | Order acceptance and money state; historical formats cannot be relabeled |
| `apps/workbench/app`, `components` | Local intake, findings, evidence, fix plan and copyable brief | Review-to-request packet, buyer-side recheck and a simpler decision-first journey |
| `web` browser trial and public site | Anonymous source-only test and install education | Honest marketplace discovery CTA; no implicit private-project upload |
| None | — | Hosted catalog, onboarding, orders, auth, tenancy, payment, outbox, dispute, ranking and seller operations |

The local FastAPI API is loopback-only by design. It must never become the public commerce API. The dependency-free CLI in `src`, `.praxis` memory, hooks, MCP tools, receipts, tray and local review remain independently usable with no account, Docker, payment or model key for source review. `docs/WORKBENCH-INTEGRATION.md` and `docs/AGENT-WORKFLOW.md` define the present trust and setup boundaries.

Pre-review system audit: GitHub intake currently uses a shallow clone and source fingerprint but does not persist the exact commit SHA required for a paid order. The local project registry can report remote freshness as unknown. `ReviewWorkspace.tsx` exposes eight peer tabs, so a new buyer journey needs a decision-first view over the existing details. `agent_work.py` runs installed agents only for a **plan** on a disposable copy; it is not a seller runtime or trust boundary. The current source and Verify suites cannot be counted as hosted catalog, payment or delivery tests. These are code-inspection findings, not a live product QA result.

### Dream-state delta and chosen approach

```text
NOW                                THIS BUILD PATH                         12-MONTH IDEAL
local project review          ->    open provider + outcome contract   ->   trusted multi-category outcome network
copy a brief to own agent          buyer-selectable human/agent routes       repeat demand and accountable supply
no transaction lifecycle          quote -> fund -> deliver -> recheck        portable acceptance/evidence protocol
eight peer diagnostic tabs         one decision-first buyer journey          advanced evidence on demand
```

The minimum viable alternative was a curated human fix desk (the prior B plan). It is useful for demand discovery but is not the selected product. The ideal architecture is an open, multi-category, human-and-agent exchange with a common outcome contract and pluggable category acceptance adapters. We select that **architecture and product scope**, release it in gated cohorts, and preserve a complete transaction on day one. Building all categories or arbitrary agent execution on day one would decrease credibility and safety, not make C more complete.

## Scope decisions and twelve-month experience

| Scope item | Decision | Why |
| --- | --- | --- |
| Human, human-led team, and registered operated-agent provider modes | **Accepted by Option C** | Both people and agents can fulfill the same scoped outcomes; the responsible operator is visible. |
| Self-serve account, draft listing, eligibility review and public catalog | **Accepted by Option C** | Open supply is a product property; publish criteria are transparent and appealable. |
| Versioned scope/quote, captured-funds rule, delivery, independent recheck, buyer resolution and recourse | **Accepted from B** | Without this, the catalog is only a directory. |
| Buyer-owned local source until explicit packet preview and sharing | **Accepted from B** | Preserves the existing local-first trust boundary. |
| Provider-hosted autonomous execution and agent storefront visibility | **Accepted with gates** | Operator-controlled fulfillment can be sold; buyer credentials and source access require explicit grant. |
| Hosted execution of arbitrary uploaded agent packages | **Deferred** | Requires isolation, supply-chain checks, capability manifest and incident response. |
| More outcome categories | **Staged, not removed** | Publish only when the category can state and test its acceptance oracle. |
| Jev, crawler, auto-match or ranking by unvalidated AI | **Deferred** | Quality/cost benefit must beat simple ranking without missed blockers. |
| Auto-acceptance, automatic payout on `VERIFIED`, blocking-by-default merge gate | **Excluded** | Evidence is only one input to buyer and financial decisions. |

The ideal buyer feels that the next step is obvious: “Here is the specific problem, here are three accountable ways to solve it, here is exactly what I would share and pay, and here is how I know what happened.” Small delights worth designing once the transaction is solid: snapshot-age warning before a quote, one-click compare of provider scope and permissions, a persistent “who can see my code” preview, progress anchored to the exact PR head, and a receipt of the buyer's decision plus next action after a partial recheck. None should hide evidence limits behind animation.

## Section 1 — architecture and ownership

```text
anonymous web trial (source-only)         hosted marketplace web (buyer/seller/operator)
            |                                         |
            v                                         v
local Workbench/CLI -> local review + SQLite  [new hosted app + authenticated API]
      |            |       |                          | catalog/onboarding/orders
      |            |       +-> Verify (distinct)     +-> transactional Postgres + RLS/roles
      |            |                                  |      +-> audit/event + outbox worker
      +-> explicit, previewed WorkPacketV1 ----------->| import -> buyer-bound OrderPacketV1
      |                                                 |      +-> eligible payment provider
      |  (no implicit sync, no inbound localhost)      |      +-> GitHub metadata/access adapter
      +-> buyer-run exact-SHA recheck observation ---->|      +-> operator dispute console
                                                       |
seller's own workspace/agent -> exact PR/artifact ---->| delivery reference, never self-verdict
             [later isolated PRAXIS runner] ---------->| bounded independent observations
```

Use **one new hosted marketplace bounded context**, initially a Next.js/TypeScript application with transactional Postgres and one outbox worker, not a distributed agent framework. Supabase Auth/Postgres is a candidate, subject to RLS, service-role and data-location review; server-side authorization remains mandatory. The existing `web` site is a discovery entry, not a commerce database. Versioned packet fixtures are shared across Python and TypeScript; no hosted route duplicates the local verification algorithm. The payment adapter is implemented only for the eligible operating geography, because payout/refund semantics differ by provider. [GitHub Apps allow repository and permission selection](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party). Before admitting private repositories to marketplace quotes, a buyer-authorized selected-repository app needs only the read permissions required for identity/head validation and must support revocation; it cannot imply per-file isolation. Seller access remains a separate buyer-managed invitation in the first cohort, with exact scope disclosure and revocation guidance.

Domain ownership: `ProjectReview` and observations stay local; `WorkPacketV1` is the buyer-approved transfer artifact; `OrderPacketV1` is a separate, buyer-bound hosted wrapper created from an imported WorkPacket when an eligible order is assembled; `ProviderProfile` and `CapabilityListing` live hosted; `Order` owns an immutable contract snapshot; `Delivery` points to immutable Git/object revisions; `EvidenceObservation` records provenance and limits; `BuyerResolution` records acceptance/revision/dispute; `FinancialEvent` records provider-correlated money movement. Workbench assessment, Verify claim verdict, order progress, buyer resolution and payment state are distinct types and labels.

Minimum contract fields: `WorkPacketV1` has schema version, buyer-written goal, selected finding ID, repository identity, exact base SHA, local fingerprint and exclusions, allowlisted source-path/excerpt references, source-scope limits, random packet ID, created/expiry times and content digest. No API keys, `.env`, `.praxis` memory or raw project tree are allowed. The canonical bytes are UTF-8, normalized Unicode, sorted-field JSON with documented array order and integer timestamps; no floating-point fields. Python/TypeScript fixtures must agree byte-for-byte. The digest identifies the accepted snapshot **after import**, not the origin or trustworthiness of an offline file. Hosted import requires an authenticated buyer, exact field preview and explicit consent, then binds packet ID and digest to that account with a unique constraint; same-ID/same-digest retry returns the same draft, same-ID/different-digest fails. A stolen file may expose its allowed contents and can be imported elsewhere before consent; therefore the file is labeled sensitive and no pre-import recipient authentication or tamper-proof claim is made. Revalidate Git identity and SHA independently before quote.

`OrderPacketV1` is **not** another local export or an alias for `WorkPacketV1`. After the buyer imports a WorkPacket into an account-owned draft, chooses a current eligible listing, and the hosted service independently validates Git identity/base SHA and an instantiated acceptance spec, the service creates an immutable OrderPacket wrapper. It records the buyer account and draft IDs, WorkPacket version/ID/digest reference, listing version, acceptance-spec version/digest, source validation observation/time, and the buyer's scoped sharing consent. It does not duplicate source excerpts or grant repository access by itself. The quote and eventual order snapshot this wrapper's ID and digest; a changed WorkPacket, listing, SHA, spec, or consent requires a new wrapper and reconfirmation. Conversion is server-authorized and idempotent per buyer, draft and selected listing version; a digest is never an access credential. Keep distinct schema fixtures and negative cross-language tests for both types and their conversion, including tenant swap, stale SHA, missing baseline, cancelled consent, replay, and two-tab quote races.

`AcceptanceTemplateV1` for the first category requires a reproducible baseline failure, one exact command or browser journey, expected behavior, buyer-authorized runtime, post-delivery check and changed-path coverage, plus false-success probes (static response, silent mock and missing side effect). A published listing references that versioned template and can exist before any buyer request. The order-specific `AcceptanceSpecV1` instantiates it **only after** the buyer's failing baseline is observed, adding base SHA, baseline check ID/result, actual command/journey and environment, allowed dependency/network conditions, changed-path scope, explicit non-goals and unknowns. Missing or unobserved baseline means no eligible evidence-backed order or checkout; it does not unpublish the provider listing. At the delivered head: a still-failing, reproducible promised behavior or confirmed false-success is `CONTRADICTED` at the claim layer; a passed baseline-to-head behavior plus relevant changed-path observation can support `VERIFIED` for that *specific* claim; unavailable runtime, irrelevant passing tests, partial paths or changed environment remain `UNSUPPORTED` or `NEEDS_HUMAN_REVIEW` according to the existing Verify rules, never auto-accepted. Workbench's project assessment keeps its own statuses. The buyer can still make a disclosed contract decision with partial evidence; that is not a Verify verdict.

`ListingVersion` has seller-of-record, fulfillment mode, category/version, eligibility, **disclosed** permissions, price basis, revision terms and support channel. `Order` snapshots all of these plus quote, buyer consent and access-grant references. Schema definitions and fixtures are versioned; old records are not migrated or reinterpreted automatically. An older client receives an explicit unsupported-version response and upgrade path, not a silent best-effort reinterpretation.

Evidence has a provenance tier. Seller report and CI are supporting claims; buyer-run local recheck is independent of the seller but is **not** a third-party attestation to the public marketplace, because its key and environment are buyer-controlled. An `ObservationBundleV1` records order ID, repository/base/delivered SHA, check IDs and versions, observed result/exit status, environment and runtime-trust mode, skipped checks and limitations, event time, content digest and optional Verify receipt/key fingerprint. The buyer explicitly imports this bounded bundle into their authenticated order; the hosted service checks schema, order ownership and SHA match, and never treats an optional signature as platform attestation. It can guide that buyer's acceptance and be labeled as such. For a dispute, a mediator may request reproducible steps and separately consented source access or a trusted hosted recheck; if neither is available, the case is resolved under published commercial terms with evidence marked inconclusive. Public provider reputation cannot treat a buyer-uploaded receipt as externally verified without a trusted hosted recheck and provenance review. An Ed25519 signature proves integrity under its identified key, not that the execution environment was impartial or production-ready.

```text
Listing: draft -> submitted -> eligible/published -> paused -> archived
                       |            ^
                       +-> changes_required (resubmit)
Order: draft -> quoted -> funding_pending -> funded -> active -> delivered
          |          |           |            |                   |
          +-> cancel +-> expire  +-> failed   +-> cancel_by_policy+-> buyer resolution
Delivered -> accepted / revision_requested / disputed
Revision_requested -> active -> delivered (bounded by frozen revision policy)
Recheck: not_requested -> running -> recorded / unavailable / stale
Seller-hosted agent: operator accepts -> operator runs in own workspace -> artifact submitted
PRAXIS-hosted agent (later): proposed -> permission_granted -> isolated_running
                             -> artifact_submitted / timed_out / revoked / failed
Money: charge pending/captured/failed; refund none/pending/partial/full/failed;
       transfer not_eligible/pending/settled/reversed/failed; dispute independent.
```

| Transition | Actor and required guard | Forbidden shortcut |
| --- | --- | --- |
| Draft -> quoted | Eligible seller/operator; immutable listing, packet, base SHA, acceptance and price | AI match or browser value sets price/authority |
| Quoted -> funding_pending | Buyer accepts current version before quote expiry and after head recheck | Stale two-tab price or changed source head |
| Funding_pending -> funded | Verified provider event for the selected funds flow | Browser success redirect or timed-out charge |
| Funded -> active | Seller accepts; buyer separately grants agreed repo access; funds remain authorized | Seller starts on an unconfirmed charge or wider access |
| Active -> delivered | Seller provides agreed PR/artifact at exact immutable head and within scope | “Done” report, green CI or unbound artifact |
| Delivered -> accepted | Buyer explicitly accepts current delivered version after seeing recheck scope | Automatic acceptance on a timer or Verify result |
| Delivered -> revision_requested | Buyer within contract window; remaining revision count >0 | Unlimited silent rework or changed scope without quote |
| Delivered -> disputed | Buyer within contract/dispute window or human support escalation | Seller or model closes a buyer dispute |
| Accepted -> transfer_eligible | Order policy, provider capabilities, refunds/disputes and hold period reconciled | Direct model/CI/verdict-to-payout event |

Provisional first-category policy for implementation review: one included revision; buyer has seven calendar days from delivery to accept, request revision or dispute; inactivity enters a **human support queue**, never auto-acceptance. Cancellation before seller work begins seeks a full buyer refund subject to the published processor-fee rule; after work starts, a human mediator applies the published allocation terms. Transfer eligibility follows explicit buyer acceptance plus any provider/legal hold, with an open dispute blocking new transfer where the processor permits. These numbers and allocation rules must be finalized in customer terms and mapped to the actual provider before live checkout; null/unapproved policy fields block launch. The financial ledger continues to record later refund, reversal or chargeback independently of order closure.

Forbidden transitions also include publishing without an eligible accountable operator and supported acceptance contract, changing a submitted agent artifact during recheck, and silently turning partial evidence into acceptance. One transactional order service enforces version, role and amount; the browser never computes authority. Idempotency keys include account, operation and order plus request hash; accepted transitions atomically write state, audit and outbox. External provider events have unique IDs and are reconciled in their own ledger. At 10x, supply/quote and recheck capacity are first bottlenecks; at 100x, queue age, support, indexes and fraud/risk operations dominate. Payment provider, GitHub and hosted DB are critical external dependencies; local review remains usable if any fail.

For the M1 concierge pilot, a restricted operator-owned **manual order ledger** records order ID, buyer/seller legal identities outside Git, frozen scope and SHAs, quote/currency, lawful invoice and provider payment IDs, paid confirmation, access grant, delivered artifact, buyer recheck and decision, revision/dispute, refund and seller payment IDs, fees, timestamps and owner. The founder/operations owner verifies payment and reconciles invoices, refunds and seller payments against provider statements; an engineering owner records exact-head observations; a named mediator handles contested or inactive orders and cannot alter the underlying check result. A buyer receives the frozen terms, receipt, support contact and refund/dispute route before paying. The ledger lives in a restricted business system, not `.praxis` memory, source Git or general telemetry. M1 never equates an invoice sent with money captured, and the pilot is **unpaid discovery** if no lawful billing and recourse route exists. The published policy fields (decision deadline, included revisions, cancellation/refund allocation, payout hold and dispute response) must be populated before the first invoice; the provisional values above are not silently treated as legal terms.

For packet import, the database uniqueness and idempotency scope is `(authenticated_account_id, packet_id)`. Same account plus same digest returns only that account's prior draft; same account plus changed digest returns a conflict. A different account importing the same offline file gets an independent draft and receives no existence signal about the original account. The file is bearer-sensitive before import, so this behavior prevents cross-tenant leakage from the API, **not** exposure if somebody steals the file. Packet IDs and digests are never used as authorization credentials.

## Section 2 — error and rescue registry

| Codepath / named failure | Rescue and durable state | What the person sees |
| --- | --- | --- |
| Local intake `NoGitHead`, `DirtyOrExcludedSource`, `GitOffline` | Keep review; block eligible paid packet or request re-review; never synthesize SHA | “We can review this copy, but cannot bind a paid fix to a clean Git revision.” |
| Packet `MissingGoal`, `EmptyFinding`, `SchemaMismatch`, `Oversize`, `DigestMismatch`, `ExpiredPacket`, `ReplayConflict` | Reject import with field-level reason; retain local draft; digest mismatch is not an origin-authentication control | Exact field/size/version and retry path |
| Identity `SessionExpired`, `TenantDenied`, `RoleDenied` | Reauthenticate or 403; do not leak existence across tenants | Sign in or access denied, with support ID |
| Listing `OperatorIneligible`, `CapabilityUnsupported`, `ListingVersionConflict` | Keep private draft or pause listing; no public trust badge | Eligibility requirement or changed listing details |
| Quote `HeadChanged`, `QuoteExpired`, `QuoteConflict` | Requote under fresh snapshot; do not charge | New price/scope/head requires confirmation |
| Payment `Declined`, `Timeout`, `WebhookInvalid`, `EventOutOfOrder` | Remain pending/failed; signed event check and reconciliation; no work authorization | Payment pending or failed, no fake paid state |
| GitHub `GrantDenied`, `RateLimited`, `HeadMoved`, `AccessRevoked` | Pause access or recheck; preserve order and revision | Who needs to reconnect, grant or re-review |
| Seller artifact `ArtifactMissing`, `ScopeEscalation` | Reject delivery; preserve exact artifact reference and operator record | Correct the PR or request an agreed scope change |
| Later hosted agent `RunTimeout`, `SandboxViolation` | Stop isolated run, revoke capability and preserve redacted incident log | Run blocked with reason and operator escalation |
| Evidence `CheckUnavailable`, `PartialCoverage`, `FalseSuccess`, `UntrustedResult` | Record unavailable/partial/contradicted at the correct layer; never invent VERIFIED | Clear checked/unchecked/contradictory evidence |
| Resolution `StaleVersion`, `DisputeConflict`, `BuyerInactive` | Re-read current order; apply published inactivity policy via human queue | Current state and available decision, no double action |
| Ledger/outbox `TransferRejected`, `RefundPending`, `DeadLetter`, `Chargeback` | Reconcile with provider, alert operator, idempotent replay; retain all events | Payment/support status and reference, never “completed” prematurely |
| Optional AI `Empty`, `Malformed`, `Refusal`, `RateLimited`, `TimedOut` | Fall back to deterministic/manual route; flag quality telemetry | No invented match or suppressed finding |

Rescued errors carry stage, order/correlation ID, provider code and redacted details; private source and keys never enter general logs. Unknown exceptions fail closed for access, money and evidence transitions, with a stable support ID. Retry only idempotent operations with bounded exponential backoff; never retry a charge based on a timed-out response without provider reconciliation.

| Failure mode | Rescued by design? | Planned test | User sees | Logged |
| --- | --- | --- | --- | --- |
| Stale or missing Git head | Yes, packet/quote blocked | Git integration | Re-review needed | Revision/status only |
| Cross-tenant request or seller scope escalation | Yes, deny before read/mutation | RLS/IDOR negative E2E | Access denied | Redacted auth event |
| Seller-hosted agent uses undisclosed tool | Not fully enforceable in seller's workspace; contractual disclosure, bounded buyer grant and investigation | Disclosure and GitHub access tests | “Operator-run; PRAXIS did not isolate this agent” | Access/audit metadata, not private tool logs |
| Later platform-hosted agent exfiltration or undeclared tool | Yes, block via isolation and capability policy before enabling | Manifest/sandbox security test | Run blocked or access revoked | Redacted permission violation |
| Malformed/empty/refused model output | Yes, deterministic/manual fallback | AI adapter fault fixtures | Accurate unranked result | Provider code, no source |
| Duplicate or delayed payment event | Yes, idempotent reconciliation | Official provider test-mode E2E | Pending or reconciled status | Provider event ID |
| False success or partial recheck | Yes, separate observation/decision | True/false/partial golden cases | Checked and unchecked evidence | Check provenance/limits |
| Payout reversal after order closure | Yes, independent financial ledger and operator case | Reversal/chargeback drill | Support and refund state | Ledger correlation |

All seven rows are **current implementation gaps** because the marketplace code is absent; “rescued” describes required behavior, not a tested current feature. A release with any row unhandled, untested and silent is blocked.

## Section 3 — security and privacy threat model

| Threat | Likelihood / impact before controls | Required control and gate |
| --- | --- | --- |
| Buyer/seller cross-tenant order or source access | High / High | Server-side resource authorization plus RLS/IDOR tests on every query and mutation; seller sees only the agreed packet after grant. |
| Source/secret leakage through packet, model, listing or support logs | Medium / High | Allowlist and buyer preview before authenticated import; source excludes; retention/deletion policy; secret canary tests; no raw project in telemetry. |
| Untrusted agent/tool or submitted project exfiltration | Medium / High | Operator identity; declared tool/network/secret permissions; no arbitrary package execution in API or buyer host; isolated runner later with ephemeral storage, no network by default, CPU/memory/time bounds. |
| Buyer or seller prompt injection | High / Medium | Treat source, briefs, repo text and listing copy as data; tool authority comes from server-side roles and explicit buyer grants. |
| Payment fraud, webhook spoofing, duplicate transfer/refund | Medium / High | Provider signature/timestamp verification, unique event IDs, immutable ledger, idempotent commands, reconciliation and chargeback runbook. |
| Trust-washing by fake reviews or misleading “verified” status | High / High | Reviews only from actual resolved orders; published evidence scope; no composite green badge over unknown claims; moderation and appeals. |
| Agent/operator change after buyer selects listing | Medium / High | Snapshot listing version, operator identity, price, permissions and acceptance terms into quote/order; changes require buyer reconfirmation. |

The marketplace may retain identities, catalog, consent, scoped packet, order metadata, artifact references, financial events and support records under explicit retention terms. Project source and `.praxis` memory remain local by default. Seller source access is a separate, broader grant than sharing a bounded packet. A public GitHub app requires a permission review; official/vendor-maintained MCP integrations only, with separate review of new servers. Credentials are server-only and rotatable. Payment instruments stay with the processor. A support operator has a privileged, audited workflow, not blanket ordinary seller access.

## Section 4 — data flow and interaction edges

```text
Review: input -> bounded scan -> source fingerprint + exact Git SHA -> findings
        nil/empty: no eligible paid request; error: review survives with unknown freshness
Listing: operator -> identity/eligibility -> permission + acceptance validation -> publish
         nil/empty: draft only; error/conflict: private with stated remediation
Order: finding/goal -> preview + consent -> packet -> quote snapshot -> funded order
       nil/empty: draft; stale/conflict: requote; payment timeout: pending, no work
Delivery: seller artifact -> immutable revision -> independent recheck -> buyer choice
          missing/changed: blocked; partial check: disclosed buyer decision, no VERIFIED
Money: provider event -> signature/idempotency -> ledger/outbox -> reconcile -> display
       missing/out-of-order: pending; duplicate: no second effect; dispute: separate state
```

For every arrow, validate nil, empty, type, length, Unicode, secret-like content, duplicate and stale values. Persist only after authorization and version checks; never assume a successful browser redirect, seller test, or model response establishes truth. Double-click, two tabs, browser back, 10-second latency, aborted upload, expired login, no eligible listing, inaccessible Git repo, changed head, provider downtime, seller disappearance, mobile keyboard and resumed paid order each need a recovery state. A paid order cannot vanish because the hosted UI or local companion is offline. Old local review records remain readable but cannot produce a new paid packet without exact revision binding.

Temporal decisions for implementation: foundation work must fix exact-SHA and schema ownership before UI/API code; core logic needs provider eligibility and an explicit funds-authorization rule before defining checkout transitions; integration must decide how a buyer transfers bounded recheck observations without claiming third-party provenance; polish must measure real false-success cases and rehearse partial/failed refunds. Resolve these in that order, not inside a late frontend handler.

## Section 5 — code quality and contract shape

Keep `AcceptanceTemplateV1` on category/listing versions and `AcceptanceSpecV1` on orders as separate schemas; publication validates the template, while checkout validates the instantiated baseline-specific spec. Keep the local `WorkPacketV1` and hosted `OrderPacketV1` distinct; quote assembly validates their mapping and ownership rather than treating their names or digests as interchangeable.

Keep the CLI zero-runtime-dependency. The hosted app may use explicit dependencies, but no marketplace package enters the core tarball. Keep one canonical schema definition per contract for `WorkPacketV1`, `OrderPacketV1`, `AcceptanceSpecV1`, `ListingVersion`, `QuoteVersion`, `DeliveryRef`, `EvidenceObservation` and `Resolution`; test cross-language canonical serialization and WorkPacket-to-OrderPacket conversion rather than duplicating policy in Python and TypeScript. `coordination.py` already models idempotent local updates; reuse its pattern, not its SQLite store or human/agent actor IDs as hosted identity. Use named services for packet import, eligibility, order transitions, payment reconciliation and recheck import. No giant route handler, broad exception swallow, generic “agent orchestration” framework or second verifier. Functions with multiple authority-changing branches should delegate to transition policy; a payment callback must not also decide evidence.

## Section 6 — tests and release-critical failure modes

The [marketplace test plan](../testing/PRAXIS-OPEN-MARKETPLACE-TEST-PLAN-2026-10-08.md) is the implementation contract. **Every marketplace path below is currently a gap**; existing Workbench/Verify tests prove only their own behavior.

```text
NEW UX: review -> outcome -> provider compare -> consent -> quote -> checkout ->
        delivery timeline -> recheck -> accept/revise/dispute; seller apply/list/deliver
NEW DATA: exact SHA + fingerprint -> packet -> hosted tenant/order -> provider event;
          artifact -> observations -> buyer resolution -> ledger/outbox
NEW CODE: eligibility, listing versions, quote/transition rules, role checks,
          packet canonicalization, payment reconciliation, evidence mapping
ASYNC: provider webhooks, notifications, outbox/replay, later isolated checks
EXTERNAL: GitHub, auth/database, one eligible payment processor; optional Jev
RESCUE: offline/stale, forbidden, malformed, timeout, duplicate/reorder, partial,
        agent failure, dispute, refund/transfer failure
```

Use many pure contract/state tests; integration tests for auth/RLS, packet and provider adapters; a few browser E2E tests spanning buyer/seller/provider sandbox; separate fault/load and real controlled-order drills. Friday-at-2am confidence: a false seller claim stays unaccepted, the exact PR head is rechecked, duplicate webhooks cannot transfer twice, and a rollback leaves an already-paid order serviceable. Hostile QA: swap tenant/order IDs, mutate head after verification, hide a silent mock, replay an old packet, submit a malicious tool manifest, and reverse a payout after dispute. Chaos: kill the worker after database commit, reorder events, drop GitHub mid-delivery, revoke seller access, exhaust model credits, and restore service with all states intact. Inject clocks and IDs in tests to avoid flaky time/randomness. Any Verify extraction/verdict changes retain the existing Promptfoo golden CONTRADICTED recall/precision gate and periodic adversarial false-VERIFIED pass.

Every new category adds a labeled true/false/partial corpus for its acceptance adapter. A known false success must be caught before the category can sell an evidence-backed outcome; gate CONTRADICTED recall first and fail on regression, report precision and fail on a regression there too. A passing test name, seller-authored green CI or model explanation alone never counts as the independent check. Run red-team crafted “done” reports before any blocking or automatic agent workflow.

| Critical gap now | Release gate |
| --- | --- |
| No exact Git SHA in paid-order review contract | Capture, freshness and force-push/dirty tests before packet export. |
| No privacy-safe packet or hosted tenant boundary | Cross-language allowlist, replay and RLS/IDOR tests before any hosted draft. |
| No seller/operator eligibility or safe agent permission contract | Identity, role and truthful disclosure tests before publishing an operator-run agent listing; isolation tests before enabling any later platform-run agent. |
| No money state, reconciliation or recourse | Provider sandbox including late/duplicate/forged events, partial refund/chargeback and paid-order rollback before checkout. |
| No independent delivered-head recheck | Exact-SHA true/false/partial tests and buyer decision separation before first delivery. |
| No proven demand or economics | Interview/paid-pilot and contribution-margin gates before claiming marketplace scale. |

## Section 7 — performance and capacity

Proposed, unmeasured targets: public catalog p95 <300 ms near deployment region; authenticated order read p95 <500 ms; quote write p95 <2 s excluding provider latency; no regression in local time to first useful finding. Paginate listings and event timelines, index tenant/status/category/created-at and provider event IDs, and cap packet/excerpt sizes. Cache only public catalog metadata, never authorization, order or money state. The three slowest paths are likely Git intake/recheck, agent fulfillment, and provider confirmation; show their real queue/wait states instead of masking them behind API p95. A 100-concurrent-checkout idempotency test and large-catalog pagination test precede wider beta. At 10x supply matching and human support may dominate; at 100x queue, DB connection pool and fraud operations need measured capacity. No arbitrary crawler belongs in this critical path.

Chosen controlled-beta shortcut (7/10 coverage; decision `4317883f-f922-4fc3-8246-2e075636eaf9`): do not build account-level request quotas or a fairness scheduler for the first small buyer cohort. Restrict buyer requests to manually enabled pilot accounts, preserve upstream GitHub/model rate-limit and timeout errors as visible pending/retry states, and record per-account request volume, job queue age, and provider 429s without treating those signals as proof of completed work. This does **not** authorize an unbounded self-serve buyer launch. Upgrade to explicit account/global admission and concurrency limits before removing the cohort restriction, or earlier if a provider 429 loses an eligible request or one account's burst delays another account's job. The future implementation must label this temporary bypass with `gstack-shortcut(dec-4317883f-f922-4fc3-8246-2e075636eaf9): 7/10, upgrade when broad self-serve opens or a pilot fairness/rate-loss trigger fires` in a code comment; no such code exists yet.

## Section 8 — observability and operations

Carry a correlation ID across packet import, listing/quote, order, GitHub delivery, recheck, provider events, outbox and dispute. Structured logs record operation, stage, actor role, order ID, version, provider code, retry and outcome, with no project source or secrets. Operators need a restricted reconciliation view answering “where is this order and what can be safely retried?”; it is an operations surface, not a public governance dashboard. Day-one metrics: qualified review-to-request, request-to-quote, provider fill, funding success, exact-head recheck completed/partial, revision, refund/dispute, repeat purchase, time to first useful result, and contribution margin by provider mode. Alerts: paid order without fulfillment owner, webhook backlog, repeated reconciliation difference, runner isolation violation, cross-tenant deny spike, and high contradicted/unknown delivery rate. Each has a runbook and manual rescue owner. Three weeks later, the immutable event trail plus versioned contract must reconstruct an order without raw source in logs.

## Section 9 — deployment and rollback

Deploy additive schema and RLS policies to staging first; run role-negative and provider test-mode E2E before code rollout. Feature flags separately control listing publication, new checkout, automated fulfillment and payouts. Release order: schema -> authenticated draft/catalog -> quote/order in test mode -> processor and webhooks -> delivery/recheck -> controlled paid beta. The first five minutes after each deploy check auth/tenancy denies, no unintended public source, webhook signature rejection, order read and idempotent dry-run. First hour checks queue age, reconciliation, pending orders and support errors. Rollback **disables new checkout and listing publication** while keeping paid-order reads, delivery intake, disputes, refunds and reconciliation online; a code revert cannot reverse funds. Migrations are expand/contract, with old/new readers compatible and a rehearsed late-webhook/dead-letter replay. Operating entity, eligible provider and support owner are hard gates for live money.

Hosted distribution is a deliverable, not an implementation afterthought. Keep the new marketplace app, its database migrations, and the outbox worker in separately buildable paths outside the dependency-free CLI package. A required hosted CI workflow must typecheck and build the app and worker, apply migrations to an isolated test database, run RLS/tenant-denial and contract fixtures, exercise provider webhooks in official test mode, and run buyer/seller browser journeys before promotion. The release workflow applies compatible migrations to staging, deploys the versioned app and worker, runs authenticated and forbidden-access smoke checks, then promotes the same artifacts to production only after the money and support gates pass. Record artifact versions, migration IDs, environment, and rollback owner for each release. Choose the production host, database, and worker runtime during M2 using a staging spike that proves the actual Next.js build, transactional outbox claim/replay, secret handling, and paid-order rollback; Cloudflare and Vercel are candidates, not assumed-compatible targets. No hosted commerce launch occurs without a repeatable build, deploy, update, and recovery path. Prototype work may proceed in parallel with this release-contract work, but cannot bypass it.

```text
Deploy: compatible schema -> role/RLS tests -> draft/catalog -> test-mode order ->
        webhook/reconciliation -> delivery/recheck -> controlled live cohort
Incident: detect money/access/evidence fault -> freeze NEW orders and payouts as allowed
          -> keep paid-order reads + support + refund/dispute -> reconcile provider
          -> replay idempotently -> restore new checkout only after audit passes
```

## Section 10 — trajectory and reversibility

The common outcome contract can later support more languages, agent providers, project teams, workflow checks and category-specific observers without changing what “buyer accepted” means. Adding an acceptance adapter is a product-quality decision, not just a schema enum. The irreversible decisions are live payment jurisdiction, private source retention and seller access terms (reversibility 1–2/5); catalog layout, ranking and provider adapter are more reversible (4/5). Main debt risks: dual local/hosted schema drift, support labor, agent sandbox maintenance, reputation gaming and category-specific false assurance. Keep schema fixtures, threat model, provider policy and runbooks close to code so a new engineer can understand why outcomes and money are separate. Twelve-month success is repeated buyer choice between accountable people and agents with measured resolution and recourse, not a large agent-card count.

## Section 11 — buyer and seller experience

```text
Public site: Understand PRAXIS -> source-only trial -> local review (no account)
Local app:   Review project -> one-page decision -> choose outcome -> preview share
Hosted buyer: Explore outcomes -> compare provider scope/permissions/price ->
              quote -> checkout -> order timeline -> recheck -> decide/recourse
Hosted seller: Apply -> create draft capability -> eligibility -> receive request ->
               clarify/quote -> deliver exact artifact -> revision/dispute/payout
Advanced local evidence and source map remain reachable from the decision page.
```

Make the first screen answer: *what is this project trying to do, what did PRAXIS actually observe, and what should happen next?* Findings are plain-language, source-linked and prioritized; a “get help” action appears only where a supported outcome contract can be written. The hosted catalog offers filters by outcome, project fit, human/agent fulfillment and access requirements. Provider cards show real delivered-order history when available and “new provider” when not. The buyer sees a side-by-side scope/permissions comparison; the seller sees only the consented packet, never the local memory vault. The order page has a single next action and an expandable evidence trail. Keep the existing warm paper/slate/peach token foundation if it passes contrast and rendered review; avoid dense neon agent-control-room visuals and fake activity. Run a dedicated design review and usability test before frontend implementation.

| Interaction | Loading | Empty | Error | Success | Partial |
| --- | --- | --- | --- | --- | --- |
| Local review | Stage and time estimate | No project yet | Offline/unsupported with retry | Findings + limits | Source-only or excluded files labeled |
| Provider catalog | Skeleton with preserved filters | No eligible provider; own-agent path | Retry, no fake listings | Comparable declared scope, access and price fields | New/unrated providers labeled |
| Packet sharing | Preview calculation | Missing goal/finding | Stale/oversize/privacy block | Explicit recipient consent | Redacted/excluded fields shown |
| Quote/checkout | Locked quote/pending payment | No quote yet | Expired/declined/unknown | Provider-confirmed funded | Reconciliation pending, no fulfillment |
| Delivery/recheck | Exact head and running checks | No artifact yet | Head changed/runner unavailable | Observations and buyer actions | Unknown checks conspicuous; buyer choice remains |
| Dispute/refund | Durable case progress | No dispute | Support/reconciliation error | Resolution recorded | Refund/transfer pending independently |

At 320px, long paths/hashes wrap in dedicated metadata areas; provider comparison becomes stacked cards with sticky comparison labels, not truncated claims. Keyboard and screen-reader users can complete filter, consent, checkout, recheck and dispute; status changes use appropriate live regions, focus returns to the action that caused an error, and color is never the sole signal. Motion is restrained and respects reduced-motion; it cannot imply verification before evidence arrives. The emotional path is uncertainty → clear project problem → informed provider choice → bounded access/payment → visible work → honest outcome/recourse.

## Build sequence and decision gates

| Milestone | Deliverable | Evidence needed to advance |
| --- | --- | --- |
| M0, truth baseline | Freeze local source/Verify semantics; measure buyer jobs and human-vs-own-agent alternative; review operating geography | Existing regression suite; 20 interviews, five willing paid-pilot buyers and two supply candidates before full hosted build; none is a current fact |
| M1, shared contract and paid pilots | Exact Git SHA/fingerprint, narrow reproducible-regression `AcceptanceTemplateV1` and buyer-instantiated `AcceptanceSpecV1`, versioned previewed packet, source consent, agent operator/disclosure schema; five public-repository, legally invoiced brokered orders using the restricted manual ledger after this contract works | Clean/dirty/stale/force-push, baseline fail, no-baseline order refusal, true/false/partial delivery, privacy/replay, cross-language fixtures, invoice-to-payment/refund reconciliation; at least four of five in-scope deliveries, no more than one refund/dispute, and non-negative fully costed margin on at least three before M2 investment |
| M2, open catalog | Self-serve operator signup and draft listings; eligibility workflow; searchable public catalog; buyer request/quote; selected-repository read-only GitHub App before private-project eligibility | Role/tenancy/RLS, GitHub permission/revocation, listing-version, no-supply and new-provider UI tests; one human and one operated-agent route each completes at least two blinded same-category benchmarks, catches planted false-success, responds to requests within the published pilot SLA, and has an accountable support owner |
| M3, real transaction | Eligible processor, captured-funds rule, exact delivery, buyer-run local recheck, buyer resolution, refund/dispute/outbox | Official provider test-mode matrix, false-success test, full browser E2E, reconciliation/rollback drill; one controlled live order after legal gate |
| M4, scale C | More category adapters, measured provider ranking, isolated hosted recheck and optional automated agent execution | Category-specific oracle, sandbox/red-team, support capacity, two viable sellers per category, repeat orders and positive contribution margin |

M1 local-contract work and an M2 hosted identity/catalog **prototype** can proceed in separate worktrees after the schema fixture is frozen; public self-serve launch and full transaction investment wait for the M1 paid-pilot threshold. Checkout cannot precede provider policy and tenancy tests. “Viable provider” means both benchmark completion with correct false-success handling and sustained ability to quote, deliver/revise and support a real order; a listing draft alone does not count. The first public marketplace claim is gated by M2 **and** M3: visible, independently viable human and operated-agent provider paths plus a complete order. A demo catalog or test-mode payment is labeled as such. Baseline Workbench backend tests, frontend TypeScript and production build, core suite, privacy guard, package budget/smoke, and applicable Promptfoo Verify evals remain mandatory for touched boundaries. No software tests were run as part of this plan-only review.

## Review completion and diagram audit

The selected mode is scope expansion within the user's explicit Option C choice, with B's full transaction kernel. The system audit found no current commerce service, no exact Git SHA in the paid-order contract and no basis to equate local agent completion with delivery proof. The 11 review sections above cover architecture, 12 named error/rescue rows, seven threat classes, five data paths, code quality, test categories, performance, observability, deployment, trajectory and buyer/seller design. The failure registry has eight rows and the release table identifies six critical **implementation** gaps, all before the affected live action. The architecture, data-flow, state, error, deployment and rollback diagrams are included. The earlier Option B diagrams remain historically accurate for B but are **not** current architecture; this document's diagrams are the current proposed C state. The open-provider TODO and C test plan have been updated; no product code or software tests were changed in this review.

An independent fresh-context spec reviewer ran three passes: 7/10, 8/10 and 9/10. It identified the seller-hosted-agent enforcement limit, packet account scope, private-repo read access, pilot money runbook and a listing-template/order-instance mismatch. The first four were reviewer-confirmed resolved on subsequent passes. The final template/instance distinction was corrected after the third pass; the correction has not had a fourth independent pass because the review loop stops at three. This is a planning-quality score, not validation of working software.

## NOT in scope

- Arbitrary third-party agent/MCP installation into buyer projects or the hosted API: requires a separate dependency/sandbox security review.
- Auto-deployment, auto-merge, auto-accept or payout on AI/CI claims: buyer authorization and provider settlement rules are separate.
- Private source or `.praxis` memory migration/upload by default: explicit bounded packet sharing only.
- A generic crawler, trading bot, Jev-based verdict, LangGraph/CrewAI rewrite or new formal-proof engine: no need in the order path.
- Enterprise SSO, broad governance dashboard, 3D control-room frontend or decorative agent activity: no demonstrated buyer value for the launch journey.
- More categories without measurable acceptance and a credible evidence oracle: the platform supports extension but must not sell unsupported assurance.
- Selecting or integrating a specific payment gateway before operating geography, seller terms and a lawful funds flow are known: preserve the transaction-state contract and recourse tests without treating a vendor integration as the product's center.

## Remaining founder facts, not permission to claim live commerce

Before choosing a payment provider or enabling checkout, record the operating legal entity/country, first buyer and seller countries, permitted service/refund/transfer terms and support owner. Until then, payment stays in test mode. Before widening a category, record demand, provider availability and category-specific false-success performance. These are factual gates; the selected Option C direction does not depend on prematurely guessing them.

## Engineering review implementation lanes

The scope remains the full Option C marketplace. Split work only at stable contracts; no branch may invent a second verifier or weaken the local trust boundary.

| Step | Modules or directories | Depends on |
| --- | --- | --- |
| Demand, operator and legal facts | `docs/designs`, research and restricted operations records | — |
| Exact-revision and WorkPacket contract | `apps/workbench/backend/regen`, `apps/workbench/backend/tests`, shared contract fixtures | Existing Workbench evidence behavior |
| Hosted build and staging spike | `apps/marketplace`, database migrations, hosted CI | Stable packet fixture for import test |
| Buyer and seller journey design | design specifications and `web` entry contract | WorkPacket/OrderPacket semantics; no product code dependency |
| Account-bound OrderPacket, catalog and listing eligibility | hosted API, schema, browser tests | Stable WorkPacket fixture and tenant model |
| Exact-delivery, recheck and buyer resolution | hosted order state, local recheck adapter, integration tests | OrderPacket, listing and acceptance contracts |
| Controlled cohort and observable capacity | hosted buyer admission, queue/worker metrics, browser states | Authenticated buyer request path |
| Live transaction and wider release | hosted state/worker, operator runbooks and release workflow | Legal facts, staged recovery proof, two viable providers and real pilot results |

Lane A: local exact-SHA and WorkPacket contract -> cross-language fixture (sequential, shared Workbench contract). Lane B: hosted build/staging spike can start after the fixture is frozen; catalog/auth and OrderPacket then proceed sequentially in the hosted app. Lane C: buyer/seller journey design can proceed beside Lane A and B once packet and trust semantics are stable. Merge the shared contract before integrating A, B and C. Exact delivery/recheck and controlled-beta operations follow hosted identity. Avoid parallel edits to `apps/marketplace` routes or the same schema migrations; those would create merge and state-transition conflicts.

## Implementation Tasks

Synthesized from this engineering review and its test coverage map. These are future build tasks, not completed code. Keep the first review useful without an account, Docker or model key.

- [ ] **T1 (P1, human: ~2 days / AI: ~4 hours)** — Workbench revision binding — persist and revalidate exact Git identity/SHA alongside source fingerprint; old/dirty/offline reviews cannot mint eligible paid packets. Files: `apps/workbench/backend/regen/scanner.py`, `projects.py`, backend Git tests. Verify: clean, dirty, shallow, force-pushed and historical-review real-Git fixtures plus Workbench regressions.
- [ ] **T2 (P1, human: ~3 days / AI: ~6 hours)** — Contract handoff — define separate versioned `WorkPacketV1` and `OrderPacketV1` schemas, preview/consent, canonical bytes, owned import and immutable conversion. Files: shared fixtures, Workbench packet exporter, hosted import/conversion modules and tests. Verify: byte-equal Python/TypeScript fixtures, canary/privacy, cross-tenant, replay, stale SHA and two-tab cases.
- [ ] **T3 (P1, human: ~4 days / AI: ~1 day)** — Open accountable supply — implement hosted identity, operator modes, eligible listing drafts/versioning, public catalog and buyer comparison without invented ratings. Files: `apps/marketplace` API/UI/schema and negative role/browser tests. Verify: one human and one operated-agent route complete the same blinded eligible category.
- [ ] **T4 (P1, human: ~5 days / AI: ~1–2 days)** — Delivery and buyer decision — bind artifact to exact head, import buyer-run observations with truthful provenance, distinguish false/partial/unavailable checks, and implement accept/revise/dispute transitions. Files: hosted order state, Workbench recheck adapter, integration/browser tests. Verify: real-repo true/false/partial fixtures and stale two-tab resolution.
- [ ] **T5 (P1, human: ~3 days / AI: ~1 day)** — Hosted distribution — build app/worker artifacts, test migrations and tenancy, prove staging deployment, recovery and paid-order rollback before live commerce. Files: `apps/marketplace`, migrations and required `.github/workflows` job. Verify: isolated DB and provider test mode, staging smoke, worker-kill/dead-letter replay and rollback drill.
- [ ] **T6 (P2, human: ~1 day / AI: ~3 hours)** — Controlled-beta capacity — limit buyer requests to manually enabled accounts; expose truthful provider 429/queue states and measure cross-account delay. Files: hosted buyer request path, queue/status UI and fault tests. Verify: ineligible buyer denied, 429 retry visible, queue recovery and prelaunch check for broader admission limits. Decision `4317883f-f922-4fc3-8246-2e075636eaf9` is a temporary 7/10 shortcut, not authorization for unbounded self-serve.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | ---: | --- | --- |
| CEO Review | `/plan-ceo-review` | Scope and strategy | 1 | Issues open | Option C chosen, B transaction kernel retained; six implementation gaps and two founder facts recorded |
| Independent spec review | Fresh-context subagent | Completeness and contradictions | 3 | 9/10 on third pass | Template/instance correction followed the final pass and was not independently rechecked |
| Eng Review | `/plan-eng-review` | Architecture and tests | 1 | Issues open | Full-scope review: one architecture, one code-quality and one performance decision; 18 unimplemented stage-level code/user paths mapped, zero silent unhandled paths in the plan |
| Design Review | `/plan-design-review` | Buyer/seller experience | 0 | Next | Design pass follows this engineering review; no rendered marketplace UI exists |
| DX Review | `/plan-devex-review` | Developer experience | 0 | Not run | No marketplace installer or hosted release exists yet |

**VERDICT:** The full Option C engineering plan is reviewable for implementation, with separate WorkPacket/OrderPacket schemas, a required hosted release path, complete proposed path tests, and a logged controlled-beta capacity shortcut. It is not a working marketplace or a production certificate. An independent nested Codex pass was skipped because this review already runs inside Codex; the earlier CEO spec pass is not a substitute for software tests. Design review is next. Core Workbench, Verify and hosted marketplace checks must pass as their modules are built.

**UNRESOLVED DECISIONS:**
- Operating entity, initial buyer/seller countries, lawful funds flow and support owner before live checkout.
- Which adjacent second paid category passes discovery and has an independent acceptance oracle.
