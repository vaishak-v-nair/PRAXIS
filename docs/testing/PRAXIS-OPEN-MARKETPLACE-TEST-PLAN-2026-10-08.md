# PRAXIS open outcomes marketplace — proposed test plan

Status: **not implemented**, 2026-10-08. Companion to [the Option C CEO plan](../designs/PRAXIS-OPEN-OUTCOMES-MARKETPLACE-2026-10-08.md). Existing CLI, Workbench and Verify suites do not test a marketplace. This plan contains the earlier Option B transaction tests and the additional open human/agent supply gates.

## Test map

`[GAP]` means no new marketplace test or route exists. Each path needs a positive case, a false-success or denial case, and an interruption/concurrency case. `[REAL]` means use the real selected provider's official test mode or a real local repository; a mocked 200 response cannot satisfy the gate.

```text
LOCAL REVIEW [GAP exact SHA] -> CATEGORY ACCEPTANCE SPEC [GAP] -> WorkPacketV1 [GAP]
       |                             |                           |
       +-- Git/dirty/force-push      +-- true/false/partial       +-- privacy/tamper/expiry
       v                             v                           v
PROVIDER APPLY [GAP] -> LISTING ELIGIBILITY [GAP] -> BUYER CHOICE [GAP]
       |                      |                        |
       +-- human/agent/operator+-- permission manifest +-- scope/price/access comparison
       v                      v                        v
OrderPacketV1 [GAP] -> QUOTE SNAPSHOT [GAP] -> FUNDED ORDER [GAP REAL] -> ARTIFACT AT EXACT HEAD [GAP]
       |                     |                           |
       +-- stale/two-tab     +-- webhook/reconcile       +-- wrong PR/moved head/malicious patch
       v                     v                           v
INDEPENDENT RECHECK [GAP REAL] -> BUYER RESOLUTION [GAP] -> FINANCIAL CLOSE [GAP REAL]
       |                                |                         |
       +-- false-success/unknown       +-- accept/revise/dispute   +-- refund/transfer/chargeback
```

The repository currently uses Node's built-in `node:test` for the core CLI, Python `unittest` for Workbench, browser integration scripts, and Promptfoo for Verify evals. No marketplace app, route, worker or marketplace test exists yet. The diagram below maps the proposed branches and the user journey together; `[GAP]` means the named behavior needs a real test when its module is built, not that a source-file existence assertion is sufficient.

```text
PLANNED CODE PATHS                                      USER FLOWS
[GAP] review -> exact SHA + fingerprint                [GAP] Local review -> eligible request
  | clean / dirty / offline / moved ref                  | current finding / stale copy / no baseline
[GAP] WorkPacketV1 -> preview -> consent -> export      [GAP] Preview precisely what leaves the device [->E2E]
  | allowlisted / secret / oversize / expired             | cancel / retry / unexpected private excerpt
[GAP] hosted import -> owned draft                      [GAP] Sign in -> import -> see own draft [->E2E]
  | valid / wrong tenant / replay / conflicting digest    | expired session / duplicate click / other account
[GAP] draft -> OrderPacketV1 -> quote                    [GAP] Compare provider -> confirm scope [->E2E]
  | valid / stale SHA / changed listing / no baseline     | two tabs / no supply / stale quote
[GAP] seller apply -> listing -> eligibility            [GAP] Human and agent operators publish [->E2E]
  | eligible / rejected / revised / paused                | appeal / changed disclosure / no false rating
[GAP] order -> funded -> active -> delivered            [GAP] Buyer sees real progress and artifact [->E2E]
  | pending / duplicate / unavailable / wrong head        | delayed provider event / seller disappears
[GAP] exact-head recheck -> scoped observations         [GAP] Buyer sees checked and unchecked [->E2E]
  | fixed / false success / partial / cannot run          | retry after unavailable / changed head
[GAP] buyer resolution -> serviceable order            [GAP] Accept / revise / dispute [->E2E]
  | accepted / revision / dispute / inactive              | late action / two tabs / refund pending
[GAP] app+worker release -> migration -> promotion      [GAP] Paid order survives deploy/rollback [->E2E]
  | compatible / failed build / dead letter / rollback    | active order readable, new checkout paused

[->EVAL] Any change to Verify claim extraction/verdict logic or a category AI
         acceptance adapter retains golden false-success and adversarial cases.
CURRENT NEW-MARKETPLACE COVERAGE: 0/9 stage-level code paths, 0/9 stage-level
user flows. Branch-level coverage cannot be measured before modules exist.
Each stage requires positive, negative, interrupted, and unauthorized tests.
```

## Failure-to-user coverage

Every row below is a **planned** assertion, not a test that currently passes. A missing handler or a silent UI state blocks the affected milestone.

| Planned path | Realistic production failure | Required test | Required handling and user state |
| --- | --- | --- | --- |
| Exact revision capture | Branch moves after review | Real Git force-push/stale fixture | Preserve review but block a paid packet; explain that a fresh revision is needed |
| WorkPacket export | A private token appears in a selected excerpt | Secret-canary and nested-path fixture | Reject the excerpt/export, keep local draft and show the excluded field |
| Hosted import | Another account replays a packet ID | Cross-account RLS/IDOR integration | Return only that account's independent draft; disclose no other account |
| OrderPacket conversion | Listing or base SHA changes in another tab | Concurrent transition/property test | Refuse stale conversion and request renewed comparison/consent |
| Seller eligibility | Agent listing loses an accountable operator | Role/suspension and version fixture | Pause listing; show precise eligibility repair to seller, no buyer trust badge |
| Order and delivery | Seller submits a PR from the wrong base | Real-repo wrong-base fixture | Reject delivery, retain paid order and show seller correction path |
| Exact-head recheck | Test command passes without touching the changed path | Stale-test and silent-mock golden fixture | Mark evidence unsupported or contradicted, show limits and buyer choices |
| Buyer resolution | Accept and dispute race in two tabs | Versioned state transition E2E | Apply one authorized transition, show the current order state in the other tab |
| App/worker release | Migration succeeds but worker deploy fails | Staging rollback and replay drill | Stop new checkout; keep existing order, support, dispute and reconciliation reachable |
| Controlled beta capacity | Provider 429 or one account delays the shared queue | Burst/429 integration and browser state | Keep request pending/retryable, show queue delay and escalate the upgrade trigger |

## Release-gate matrix

Planned suite ownership: extend `apps/workbench/backend/tests/test_scanner.py` and `test_projects.py` for exact Git identity/freshness; add `test_work_packet.py` beside them for local export and privacy. Add hosted `apps/marketplace/test/contracts.test.ts`, `order-packet.test.ts`, `eligibility.test.ts`, `order-state.test.ts`, `outbox.test.ts`, and `release.test.ts` for pure contracts, authorization, retries and recovery. Add hosted browser specs for buyer import/choice/delivery/resolution and seller application/listing/delivery, backed by a real test database and the selected provider's official test mode. Use cross-language golden JSON fixtures for both packet versions; a serializer round-trip alone is not enough because it can preserve the same mistake on both sides. Keep real-repo true/false/partial and Verify Promptfoo cases as separate evidence gates. These are proposed paths, not existing suites.

| Gate | Positive case | Hostile and recovery cases | Test layer |
| --- | --- | --- | --- |
| Project eligibility and exact revision | Clean public GitHub pilot fixture records remote, HEAD SHA, snapshot fingerprint and exclusions; later private cohort uses selected-repo read-only App grant | Dirty/excluded paths, local folder with Git metadata, shallow clone, auth/offline, force-push, revoked/read-overbroad App, old review without SHA; no eligible packet | Backend unit + real local Git + GitHub permission integration |
| `AcceptanceTemplateV1` and order `AcceptanceSpecV1` | A published JS/TS regression listing has a category template without buyer SHA; after authorized baseline failure, the order instantiates exact base SHA/check/expected behavior; delivery passes with relevant path observed | Vague “improve quality,” no baseline, refused runtime, plausible false diff, stale irrelevant test, silent mock, partial fix; listing may remain published but no eligible evidence-backed order/checkout and no false VERIFIED | Real repo baseline/delivery + pure contract + Verify golden eval where touched |
| `WorkPacketV1` | Allowlisted preview, byte-stable UTF-8 canonical JSON digest and explicit authenticated buyer import/binding | Secret canaries, nested path, giant/empty/Unicode fields, altered digest, expiry, same-account/same-ID/different-digest conflict, cross-account same ID isolated drafts, wrong schema, stolen file, cancel before share; no authenticity claim for offline file | Cross-language fixture + privacy + browser E2E |
| `OrderPacketV1` conversion | Server creates an immutable buyer-bound wrapper from an owned imported WorkPacket, eligible listing, independently validated Git SHA, observed baseline-specific acceptance spec and scoped consent; quote references wrapper ID/digest | Tenant swap, modified WorkPacket, stale SHA, missing baseline, revoked consent, listing-version race, two-tab quote and same-key/different-body replay block conversion or require fresh confirmation; wrapper does not duplicate excerpts or grant access | Schema fixtures + transition unit + API/RLS negative integration + browser E2E |
| Operator identity | Human, human-led team and operated-agent listings tie to a real eligible operator | Agent as payee, forged operator ID, suspended operator, operator change after quote, missing support contact | Auth/role integration + negative E2E |
| Seller-hosted agent disclosure | Listing shows operator, declared tools/data/network/model use; buyer grants only approved GitHub access | Operator silently uses undeclared tool: PRAXIS cannot enforce their workspace; label it operator-run, offer revocation and investigation, never call it platform-isolated | Listing/consent/role E2E + GitHub permission test |
| Later platform-run agent permissions | Isolated runner enforces tool/source/network/secret/spend/runtime/revocation manifest | Undeclared tool, prompt injection, malicious package, exfil, timeout and interruption fail closed | Sandbox fault/security test **before** platform-run listing |
| Open listing workflow | New eligible provider self-registers, drafts, submits, publishes and gets a buyer request | Unsupported category, false credentials, duplicate listing, changed permission/version, rejected/appealed listing, zero supply; no fake rating | API/RLS + buyer/seller browser E2E |
| Catalog matching and reputation | Fit/permissions/price filters and real completed-order history | New provider shown unrated, spam/gaming/collusion, 10k listings, stale listing, Jev timeout; deterministic/manual result | Unit + search/load + moderation fixture + optional labeled eval |
| Controlled-beta capacity | Manually enabled buyer accounts can submit eligible requests and see real queue state; a provider 429 remains pending/retryable without a fabricated result | Ineligible account cannot enter the buyer request path; one account's burst, GitHub/model 429, worker delay and recovery record queue age and per-account volume; broadened self-serve access fails its release gate until admission limits are added | API role negative + burst/fault integration + buyer browser state |
| Quote and access | Order snapshots seller, source revision, acceptance, permissions, price, currency and due date | Two-tab acceptance, stale HEAD, expired quote, seller change, denied/revoked GitHub grant; requote or pause | State-property + GitHub integration + browser E2E |
| Payment and ledger | Selected provider official test mode captures and correlates one charge | Decline, timeout, forged/duplicate/out-of-order/late webhook, same-key/different-body, partial refund after transfer, chargeback; no double money effect | Provider test-mode [REAL] + DB/worker fault injection |
| Delivery and recheck | Human and operated agent each deliver exact-revision artifact; buyer-run local static check and separately authorized runtime check record provenance | Wrong repo/base/head, seller-supplied green CI, irrelevant test, hardcoded success, changed head mid-check, refused trust, runner unavailable; no false VERIFIED | Real repo [REAL] + existing Verify/Workbench regressions + false-success E2E |
| Evidence provenance and public reputation | Buyer-run check is visible to buyer with key/environment ownership; a later trusted runner may create a distinct public-attestation tier | Buyer forges or uploads a self-signed receipt, seller colludes with buyer, CI result is stale; no public verified badge or automatic payout | Contract unit + reputation API negative integration |
| Buyer decision and recourse | Accept, one included revision and dispute create distinct durable events; accepted order alone does not transfer funds before policy hold | Seven-day provisional decision window, inactivity to human queue, cancel before/after work, accept/dispute race, refund allocation, seller disappears, payout reverses; no silent closure | State-property + clock-injected browser E2E + finance reconciliation |
| Rollback and recovery | Disable new orders while paid order stays readable/serviceable | Kill worker after commit, replay dead letter, deploy old/new schema overlap, provider outage, late event after rollback | Staging chaos drill [REAL] + manual runbook rehearsal |
| Hosted release path | Build the marketplace app and worker, migrate an isolated database, deploy the same versioned artifacts to staging, and smoke-test an authorized order read plus a forbidden cross-tenant read | Missing build artifact, migration drift, incompatible old/new readers, absent secret, worker replay after process loss, failed deployment after schema change and rollback with an active paid order; no new checkout while paid-order service remains available | Required hosted CI + staging deploy/rollback drill [REAL] |
| M1 manual paid pilot | Founder/ops records frozen order, lawful invoice, confirmed payment, exact artifact, buyer decision and seller settlement in restricted ledger; engineer attaches recheck; mediator handles dispute | Invoice unpaid but work starts, missing refund ID, duplicate seller payment, buyer inactive, disputed outcome, no lawful billing path; no paid-order claim until reconciled | Runbook dry-run + independent ledger/provider-statement reconciliation [REAL] |

The first paid pilot may broker orders manually, but it still needs every scope, money, exact-head, recheck and recourse assertion. The open marketplace beta adds a **self-serve listing-to-order E2E for a human provider and an operated-agent provider** in one category; this is the key test that proves Option C is not merely Option B with agent cards. No agent may be marked verified because its own test or model report says so.

The first-category benchmark uses at least two blinded assignments per provider route: one real baseline regression that the delivered head fixes and one plausible-looking diff that leaves the behavior broken or silently mocked. The provider must not mark the latter complete, and the buyer recheck must catch it. Measure request response, delivery time, rework and support burden against the published pilot SLA; a provider that cannot fulfill two assignments or answer a support escalation is not counted as viable. Buyer-run `ObservationBundleV1` import is tested for exact order/base/head, check IDs, runtime trust, skipped checks, digest and key fingerprint; buyer-controlled signatures are not promoted to third-party public attestation. A mediator can request separately consented reproducible steps; without them, technical evidence remains inconclusive and commercial policy governs.

Before each new outcome category goes live, maintain a labeled corpus with a true completion, plausible false diff, stale test, silent mock, partial completion and unavailable check. The category's CONTRADICTED recall is the first gate; precision is reported and regressions fail too. Recheck output must identify the exact artifact and observer provenance. Public reputation may use completed order history, but buyer-controlled local observations alone cannot be sold as third-party verified performance.

## UI and accessibility paths

- Public trial: 320/390/768/1024/1440px; source-only limits; folder/local path alternatives; no surprise account or source upload.
- Local review: finding and evidence from real backend; exact revision/freshness; packet preview; no-supply and stale-Git recovery; advanced evidence accessible without eight equal first-run tabs.
- Buyer catalog/order: filter by outcome, human/agent, access and budget; compare real permissions; quote and consent with keyboard; double-click/two-tab; payment pending; exact delivered head; partial recheck; revise/dispute/refund.
- Seller studio: eligible and rejected drafts, listing revision, clarification, delivery, buyer revision and dispute, payout pending; agents display accountable operator and permissions.
- All: long Unicode paths and descriptions do not overflow; focus returns on error; live status is announced; color is not the sole signal; reduced-motion honored; visible empty, loading, error, success and partial states.

## Baseline and evidence rules

For any Workbench change, run `npm run test:workbench`, `npm run typecheck:workbench`, and `npm run build:workbench`. For CLI/Verify changes, run `npm test`, `node scripts/ci/leak-guard.mjs`, `node scripts/ci/tarball-budget.mjs`, and `node scripts/ci/pack-smoke.mjs`, plus historical receipt fixtures. Changes to claim extraction or verdict logic must pass the existing Promptfoo CONTRADICTED recall/precision gate and the periodic adversarial false-VERIFIED pass before any blocking behavior. The hosted service will need its own required app/worker build, migration/RLS, state, provider, browser, security, load and staged rollback CI checks. None of these new checks has passed yet because the implementation does not exist.

Do not call a seller's self-test independent evidence, a buyer click a Verify verdict, a receipt an accepted order, a checkout redirect captured funds, or a test-mode transaction a live order. Every release note and UI status should use the precise recorded state.
