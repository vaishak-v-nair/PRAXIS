# PRAXIS marketplace test plan

Status: **superseded Option B transaction-kernel reference**, 2026-10-08. The active coverage plan is [the Option C open marketplace test plan](PRAXIS-OPEN-MARKETPLACE-TEST-PLAN-2026-10-08.md). These routes and tests do **not** exist yet; the existing PRAXIS suites are baselines to preserve, not evidence that commerce works.

## Affected pages and routes to build

| Surface | What a tester must see |
| --- | --- |
| Public `Test Your Project` | Source-only browser trial; excluded files and checks not run are conspicuous; a local-review path remains usable without marketplace login. |
| Local Workbench `Review` and `Get help` | Source-linked finding, exact review scope, local/remote freshness, explicit packet preview and recipient-level sharing consent. No automatic upload. |
| Hosted `Find help` and request import | Anonymous browse, authenticated packet import, quoted scope, price, seller and current Git head; graceful zero-seller and incompatible-packet states. |
| Hosted checkout and `Orders/:id` | Provider-confirmed payment, delivery timeline, exact PR commit range, recheck scope, buyer accept/revise/dispute actions, refund and payout status. |
| Hosted seller request and order views | Redacted pre-quote request, accept/decline/clarify/requote, access state, delivery, revision/dispute, transfer status. |
| Operator reconciliation | Restricted event history, duplicate/late-event handling, manual paid-order rescue and reversal without changing the buyer's evidence verdict. |

## Coverage diagram: codepaths and user flows

`[GAP]` means no marketplace test exists today; the named tests must be written with the implementation. `E2E` marks a path that must exercise real route, database and browser or provider-sandbox boundaries. `EVAL` marks a labeled model-quality test.

```text
CODE / DATA PATH                                      USER FLOW / VISIBLE RESULT
browser trial -> source findings                     [GAP E2E] empty, partial, oversize -> limits and local path
local GitHub intake -> exact SHA + fingerprint       [GAP] clone, auth/offline, dirty/excluded, shallow HEAD
     -> current remote HEAD                           [GAP E2E] force-push/head change -> stale + re-review
finding -> OrderPacketV1 allowlist/digest             [GAP] null/empty/secret/oversize/expiry/version
     -> preview -> explicit file export               [GAP E2E] cancel/share, recipient visibility, no auto upload
hosted import -> account/schema/nonce/consent         [GAP E2E] guest/old packet/replay/tamper/other tenant
catalog -> seller eligibility -> quote version       [GAP E2E] zero supply, stale quote, two-tab requote
quote -> provider checkout -> immutable event log    [GAP E2E] decline/timeout/duplicate/reorder/forgery
paid order -> buyer GitHub access -> seller PR         [GAP E2E] revoked access, wrong repo/base/head/role
PR -> buyer local static/optional runtime recheck    [GAP E2E] trusted/untrusted, irrelevant test, runner failure
     -> per-claim Verify / separate acceptance       [GAP] contradicted/unsupported/partial vs buyer choice
buyer choice -> resolution -> transfer/refund         [GAP E2E] accept/dispute race, partial refund after payout
outbox -> notification/reconciliation                [GAP E2E] duplicate, dead letter, restart, replay
rollback -> disable new orders, service paid orders   [GAP E2E] late webhook and manual fulfillment after rollback
optional Jev shadow route -> fallback                 [GAP EVAL] blocker recall, abstain, malformed/timeout
```

The local review, Verify receipt, hook/memory, browser and package tests already exist in their own areas, but none establishes the proposed hosted behavior. Keep the Workbench assessment statuses separate from Verify's four per-claim verdicts and the marketplace's buyer/financial states in assertions and fixtures.

## Key interactions and exact assertions

1. **First local finding and packet:** A reviewed GitHub fixture records the actual remote and exact HEAD SHA plus snapshot digest. A source-only or excluded-file result states its limits. A local folder without an eligible remote, stale snapshot, missing finding or uncommitted change cannot silently yield a paid-category packet. Existing old review records require refresh, not automatic migration. Packet tests use privacy canaries in filenames, excerpts and environment-like strings; only explicitly allowlisted fields appear in exported JSON and any hosted draft. Canonical serialization and digest are stable across Windows/macOS/Linux. Tampered, expired, oversized or replayed packets are refused with a useful recovery message.
2. **Identity and quote:** A guest can see public category information but not any private request. Buyer A, buyer B, seller and operator each get only their permitted fields; direct object-ID guessing and Supabase RLS checks deny cross-tenant reads/writes. A seller's decline, clarification, quote and requote create distinct versioned events. A second browser tab cannot accept a stale quote or changed repository head. No eligible seller shows a request waitlist/free own-agent action, not a fake listing.
3. **Money:** The selected eligible payment provider's official test mode exercises declined, timed out, pending, captured, partially refunded, fully refunded, disputed, transfer-failed and chargeback-after-transfer states. Browser return alone never marks an order paid or starts work. Forged signatures fail. Duplicated, out-of-order and late webhook events do not double charge, refund, email or transfer. Idempotency is tested by same key/same body replay, same key/different body rejection, two-tab checkout and server crash after database commit but before provider response. Reconcile amount, currency, provider IDs and fees against an immutable ledger; provider choice has country/seller eligibility tests.
4. **Fulfillment and evidence:** Seller cannot deliver before confirmed funding and buyer-granted access. Wrong PR, changed base, force-push, missing SHA range, malicious content and seller-produced green CI do not mark work checked. The buyer's local recheck is bound to the exact delivered head; static, runtime and browser observations are separately represented. Missing trust, irrelevant passing tests, runtime timeout and unavailable local service remain partial/unknown, never VERIFIED. Buyer acceptance, revision and dispute race under one version; a signed Verify receipt is not substituted for the buyer's contract acceptance. A seller's claim cannot trigger payout.
5. **Recovery:** Close a tab mid-payment, lose network during import, lose Git access mid-work, fail notification delivery, restart the worker and roll back a deploy with paid orders outstanding. Orders remain durably visible with a support ID and accurate next action. New checkout is disabled while delivery intake, dispute and refund remain serviceable. Dead letters can be replayed once without duplicating financial effects.
6. **Optional AI routing:** Shadow a labeled, consented finding set against the existing route. The gate is non-inferior actionable-blocker recall, with category precision, abstain rate, p50/p95 latency, privacy and cost reported. Malformed/empty/refusal/timeout/limit responses fall back to full/manual triage. Changes to claim extraction or verification continue to run the existing Promptfoo golden eval and adversarial false-success suite; Jev never changes a Verify verdict.

## Edge and accessibility matrix

- Sizes: zero and 10,000 findings, 320/390/768/1024/1440px layouts, long project paths/hashes, maximum packet size, no seller and one seller.
- Interaction: double click, browser back, lost session, two tabs, slow 10-second API response, interrupted import, keyboard-only quote/checkout/dispute, focus restoration and live-region status messages.
- Security: prompt-injection text in submitted source or seller notes; project source and secrets never logged or sent in general telemetry; CSV/HTML injection in support exports; script injection in descriptions; IDOR/RLS; CSRF; provider webhook signature; seller scope escalation; safe sandbox with network disabled unless authorized.
- Cross-platform: cold managed local review on Windows, macOS and Linux after publication, plus current checkout path before release; Git/auth errors; no Docker requirement for source inspection; explicit Docker/host trust for execution.

## Release gates and commands

Before a marketplace code change is considered done, add and pass the relevant unit, integration and E2E tests above. For every Workbench change, run backend tests, TypeScript checks and a production build: `npm run test:workbench`, `npm run typecheck:workbench`, `npm run build:workbench`. For core/Verify changes, run `npm test`, `node scripts/ci/leak-guard.mjs`, `node scripts/ci/tarball-budget.mjs` and `node scripts/ci/pack-smoke.mjs`; run `npm run eval:verify` and the periodic red-team suite before changing the verdict aggregator or enabling blocking mode. Existing historical receipt fixtures must remain valid. The new hosted service needs its own migration/RLS, unit, provider-sandbox, browser E2E, security and load jobs as required CI checks, not a dashboard-only report.

A live beta requires a provider-eligible operating entity and seller geography, written refund/transfer rules, a real provider test-mode checkout through settlement/refund, one controlled end-to-end order, a buyer-side recheck against exact SHAs, paid-order rollback drill, privacy review and support owner. Measure p50/p95 from local review start to first useful finding, request to quote, payment confirmation, delivery, buyer recheck and financial settlement separately; API latency alone is insufficient. No production completion is claimed by this plan.
