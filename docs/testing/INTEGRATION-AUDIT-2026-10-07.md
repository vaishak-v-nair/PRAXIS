# PRAXIS source and integration audit

Date: 2026-10-07. This audit follows the assurance implementation checkpoint.
It covers the current checkout, its actual packaged CLI, production Workbench
UI, Python API, shared service owner, public browser scanner, and desktop
packaging contracts. Nothing was committed, published or deployed by this audit.

The [2026-10-08 follow-up checkpoint](INCOMPLETE-WORK-CHECKPOINT-2026-10-08.md)
records the subsequent installed-agent workflow, public deployments, refreshed
desktop runtime and live integration results. The gaps below describe this
audit's earlier snapshot.

The main frontend → middleware → backend → persisted-result paths passed real
integration checks after four confirmed defects were fixed. This does not prove
every possible project, provider or deployment works. The public deployment and
frozen desktop bundle have separate gaps listed below.

## Confirmed defects and fixes

| Defect reproduced | Consequence | Change and regression |
| --- | --- | --- |
| Captured project goals were absent from standard and independent model review context; explicit team rereview could lose a source-only goal. | The UI accepted an intended workflow that the reviewer never saw. | Carry the stored, redacted goal through the worker to every reviewer as bounded untrusted data. API/provider regressions cover standard, deep, ultra and explicit team rereview. |
| A model response without the required `findings` field defaulted to an empty list. | Malformed responses could appear to be completed reviews with no findings. | Primary, independent and team inspection now require the list. Errors preserve static findings and expose unavailable/partial model coverage. |
| Independent API-state reads repeatedly initialized Windows certificate configuration within short journey deadlines. | Several real browser tests exhausted their deadline before classifying unchanged state as false success. | Cache only the TLS context. Each observation still uses a fresh HTTP client, no inherited browser/API cookies or authorization, no environment proxies and no redirects. A real browser/API cookie-isolation regression passes. |
| Trusted MCP verification skipped static diff and false-success observers. | A constant-success implementation and a claimed change to an untouched file became `UNSUPPORTED` instead of `CONTRADICTED`. | Static observers now run before trusted commands and supplementary MCP collection in every mode. A real Git regression reproduces both false claims, checks observer ordering and validates the Ed25519 receipt. |

The goal/schema regressions and trusted-MCP regression failed before their
corresponding fixes and passed afterward. Journey deadlines were not increased.
The verdict aggregator and historical receipt formats were preserved.

Two browser-test locators also needed adjustment: the Findings tab includes its
live count in its accessible name, and the landing page has several links to
the browser review. The tests now address the review navigation and hero CTA
specifically. Screenshot capture waits for painting after resetting scroll.
These are test corrections, not replacement product behavior.

## Source linkage

An AST-based inventory examined 188 JS/TS/HTML/Rust source files in the CLI,
Workbench app/components/lib, public website, and desktop UI/runtime/scripts/
Rust entrypoint. It found 443 local import references. The only two references
absent beside their source are `review-service.mjs` and
`review-service-runtime.mjs` in the desktop supervisor. They are deliberately
copied from the shared core modules into the generated runtime by desktop
preparation; packaging tests require their presence and hashes. No unresolved
ordinary local import was found in these scopes. A separate Python AST check
covered all 20 backend modules and resolved all 39 relative import references.

This inventory excludes dependencies, generated builds, sample repositories,
private state and non-runtime assets. Dynamic module paths, platform branches
and behavioral correctness require the build/runtime checks below; resolving
an import alone does not establish working behavior.

| User path | Actual linkage | Evidence collected |
| --- | --- | --- |
| Local path / uploaded folder → review | `Intake.tsx` → same-origin client → shared authenticated owner → FastAPI intake → isolated snapshot/scanner → SQLite → SSE/polling → workspace | Rendered source-only intake; folder batch upload; original `.env` exclusion/preservation; real stored goal/findings; no command execution or model spend during intake. |
| Review state → UI | `use-workspace.ts` → job API plus event stream → `public_job` assessment/freshness → typed components | Actual successful SSE response; completed persisted jobs; source map selection, finding search, agent-brief download; three-project CLI/status parity. |
| Authorized checks → outcome | Action dialog → job verify API → existing runtime harness → accessibility-tree browser actions → fresh independent API GETs → snapshot-bound checks/assessment | Consent rejection; real stored state change passes; identical visible success without storage change fails and cannot establish release readiness. |
| Shared work/context | Project workspace → revision-checked job/project APIs → registry/coordination tables → selected context in model review | Real UI assignment/private context persistence plus backend stale-revision, scoping and context-sharing regressions. Agent completion remains a report, not proof. |
| Model review / fix planning | Selected provider → direct model adapter → shared budget reserve/settle → grounded response validation → worker/job display | Offline provider/API/team regressions; malformed responses fail visibly; missing provider disables planning while the copied agent brief remains available. No paid-provider accuracy or available credits were tested. |
| Repair / export / source apply | Existing plan-confirmation and repair worker → review copy → harness/export → confirmed freshness-checked source apply with backups/rollback | Backend regression suite. This audit did not authorize applying changes to a user's submitted project. |
| Official external evidence | Evidence panel → Python evidence adapter → Node bridge → existing Verify official-source registry/client | Adapter, empty/error-response, scope, redaction and packaging regressions. No vendor account was authenticated or queried by this audit. |
| Core claim verification → receipt | Task/extraction → exact Git binding → static/trusted/MCP observers → per-claim policy → separate Ed25519 artifact | Full core regressions; trusted-MCP negative regression; fresh-install real Git true/false cases and offline signature verification. |
| Public browser review | Hero CTA → directory picker → worker → pinned Pyodide → hash-checked copies of the same backend scanner/reality/browser modules → findings and agent prompt | Real WebAssembly execution on broken and clean source, cancellation, clipboard denial and engine-hash failure. No project source upload; runtime readiness remains unestablished. |
| Desktop / installed CLI | Shared owner/service/runtime modules → matching engine identity → same Workbench/API; frozen runtime includes those modules | Current desktop packaging/release-guard tests pass. The existing frozen bundle is older than current source; native acceptance was not rerun on a refreshed bundle. |

Managed review uses the shared gateway to authenticate browser sessions and
proxy API traffic to its owned backend. Development Workbench instead uses the
Next.js loopback-only API rewrite. Submitted project commands retain explicit
trust and source-apply controls; host execution has this computer's permissions
and is not an OS sandbox. Missing Docker never silently switches to host mode.

## Current validation

| Check | Result |
| --- | --- |
| Full core suite using the supported serialized CI runner | 579 total: 572 passed, 7 skipped, 0 failed |
| Full Python backend suite | 297 total: 294 passed, 3 skipped, 0 failed |
| Frontend TypeScript and production build | Passed |
| Rendered authenticated production UI / backend | Passed: intake, sharing, consent, independent state, false success, upload, source map, brief download, SSE and sanitized status |
| Browser scanner with real Pyodide and file picker | Five scenarios passed; zero axe accessibility violations, zero JavaScript errors, zero source-upload requests; widths 320/390/768/1024/1440 checked |
| Promptfoo golden cases | 5/5; CONTRADICTED recall 1.0 and precision 1.0 |
| Fresh installed npm tarball | 9/9, including true/false Git verdicts and both Ed25519 signatures |
| Desktop packaging / release guards | 14/14 |
| Python dependency integrity | `pip check` passed |
| Privacy guard / actual package budget | Passed; 543 tracked paths checked; 261 packed files, 3.73 MiB within 3.75 MiB |

Initial parallel core execution under concurrent builds hit a Windows archive
helper timeout. The existing serialized CI runner passed afterward, including
the new verifier regression. Initial journey failures and malformed/goal/MCP
regression failures were kept in local logs; they were not replaced by success.
Promptfoo reported a telemetry-shutdown timeout, but its evaluated cases and
metric gate exited successfully. These cases exercise deterministic verification,
not a live extraction-model benchmark or periodic adversarial red-team run.

Tests use clearly named temporary fixture projects and isolated data directories.
They make real Git commits, launch real processes, drive real browser controls,
read real API state, and check actual cryptographic signatures. Explicit model/
vendor test doubles exercise failure contracts without pretending to establish
live provider access. PRAXIS Live's rehearsed scenarios remain demo fixtures.
Production review findings, job IDs, state observations and downloaded briefs
come from the submitted snapshot and stored evidence.

## Delivery gaps and limits

One functional integration is incomplete: workspace assignments and handoffs
are persisted coordination/context records, not automatic installed-agent
dispatch. Backend leases exist, but the worker/adapter connecting those leases
to authenticated coding CLIs has not been delivered. The UI's numbered reviewer
choices represent review roles, not discovered running agents. Existing explicit
CLI agent commands remain separate; assigning a workspace task does not launch
them. Selected shared context reaches model reviewers when a review is requested.

Live endpoint checks at 2026-10-07T12:07Z found:

- [Vercel's browser-engine manifest](https://praxis-six-xi.vercel.app/test-your-project/engine/manifest.json)
  is valid JSON, but its scanner hash differs from the current canonical backend.
  The local site build/tests use current source; production needs a subsequent
  reviewed deployment to receive it.
- [The Cloudflare URL](https://praxis.vaishak-v-nair-dev.workers.dev/) and its
  engine-manifest path return Cloudflare Access sign-in HTML. HTTP 200 here is
  not a functioning public app or scanner manifest. Access settings were not
  removed or reconfigured by this audit.
- The frozen desktop engine ID starts `8a3b8d2ef845`; current managed source
  starts `124f94dc0fdc`. Reprepare, smoke-test and rebuild before delivering an
  updated installer. Existing native acceptance is for the earlier bundle.
  Signing, clean-machine installation, native picker/tray acceptance and other
  public-release gates remain as documented in the assurance checkpoint.
- Live model quality/credits, authenticated coding-agent execution, official
  MCP account access, hosted red-team execution and remote branch protection
  were not established. Registration, configuration and local workflow files
  do not prove those external conditions.

Static rules and source heuristics are real checks, with bounded coverage and
confidence; they cannot establish comprehensive security or production readiness.
Model interpretations remain hypotheses. Workbench jobs are not automatically
signed core receipts. Signature validity proves the recorded payload's integrity,
and does not independently prove an unobserved external claim.

## Reproduce and inspect evidence

Run `npm run test:workbench`, `npm run typecheck:workbench`,
`npm run build:workbench`, `npm run test:assurance`, `npm run test:desktop`,
`npm run eval:verify`, `node scripts/ci/leak-guard.mjs`,
`node scripts/ci/tarball-budget.mjs` and `node scripts/ci/pack-smoke.mjs`.
For the core suite on a loaded Windows machine, set `CI=1` and run
`node scripts/ci/run-tests.mjs`. The public scanner smoke is
`apps/workbench/.venv/Scripts/python.exe -B apps/workbench/tools/browser_review_smoke.py`.

Ignored local audit artifacts are under `apps/workbench/.regen/artifacts/`:
`integration-core-final.log`, `integration-backend.log`, `integration-build.log`,
`integration-golden.log`, `integration-pack.log`, `integration-browser.log`,
`integration-source-map.json`, `integration-python-map.json` and
`integration-deployments.json`. The final rendered assurance run printed
`C:\Users\vaish\AppData\Local\Temp\praxis-assurance-qa-VMoNpH`, containing
screenshots and sanitized `result.json`/`status.json`. Never publish the entire
QA directory, service descriptor, provider file or job store.
