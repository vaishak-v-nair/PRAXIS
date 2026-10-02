# PRAXIS codebase audit — 2026-10-01

The current local CLI and Workbench pass the tested release gates after the
fixes below. This is **not** a finding that every planned feature, external
service, or production user journey works. The npm release candidate is
**praxis-memory 0.14.1**; nothing was published, pushed, staged or deployed.

## Scope and connections

Mapped the first-party CLI, backend, browser app, public website, worker/tray
entry points, tests, packaging, CI and public documentation. Inspected their
entry points, evidence contracts, import relationships and runtime behavior.
Private vaults, credentials, installed third-party source and generated job data
were not treated as distributable product code. An inventory is not proof that
every line was read or every branch was executed.

| Area | Current connection | Evidence and limit |
| --- | --- | --- |
| Core CLI | `src/cli.js` → commands → local libraries | Full regression suite and real installed bins; zero runtime dependencies |
| Claim verification | capture/extract → exact Git binding → ReGen-derived observers → per-claim policy → separate Ed25519 receipt | Golden fixtures, correct/false installed-repo checks and signature verification; default local fallback is labelled |
| Core jobs and flow | adapters → detached runner → job store → supported transcript/receipt link | Existing job regressions plus DAG shape/prototype pressure cases; process completion remains distinct from verified work |
| Legacy eval | selected agent → wait for exit and receipt-link phase → historical receipt scoring | New real delayed-agent integration case; unsupported output fails with one JSON record and nonzero exit |
| Workbench UI/API | shared workspace state → same-origin API → FastAPI jobs | TypeScript, production build, twelve browser views, intake handoff and real browser/API/Docker fixtures |
| Project review | isolated intake/snapshot → scanner/reality/harness → deterministic `review.py` | Backend suite, credential/path/trust/budget/apply regressions; model findings remain hypotheses |
| Runtime checks | explicit trust → disposable Linux Docker container → recorded checks → assessment | Fifteen sandbox tests including real Node/Python runs; Docker does not establish a complete browser user journey |
| Findings and repair planning | findings selection → plan/action payloads → backend planning/repair → review/export/guarded apply | Browser action contract and backend fixture tests; actual paid provider repair quality was not re-certified |
| Memory, hooks, skills, MCP and tray | existing init/update/capture, supported agent config and transcript adapters, separate tray host | Core regressions preserve these contracts; all installed agents are not automatically evidence-compatible |
| PRAXIS Live | native verifier through staged demo; optional LangGraph; optional Three.js decoration | Installed Live, evidence snippets and signed contradicted receipt pass; npm installs retain the flat fallback without optional development packages |
| Official MCP evidence | reviewed GitHub, Microsoft Playwright, Sentry and Supabase adapters → existing evidence ledger | Registry/policy/adapter regressions; registration does not prove external credentials or a live vendor connection |
| GitHub App/explorer | same verifier, advisory default, base-revision opt-in blocking, browser signature verification | Regression fixtures pass; no live GitHub installation or hosted explorer deployment was performed |
| Public website | generated static landing page → Test Your Project local setup page | Local navigation, successful/denied clipboard behavior and responsive page checked; Vercel was reachable but the new page was not deployed |
| Desktop product architecture | Windows/macOS/Linux package/supervisor/tray plan in `docs/designs` | Still a design and test plan; no bundled native desktop release is claimed |

Core import inventory found 119 JS/MJS modules: 114 reachable through literal
CLI imports, four additional worker/asset entry points, and one retained helper
(`src/lib/plain.js`) without an active first-party import. The apparent missing
`../src/login.js` import is text inside a generated Live demo fixture, not a
missing source module. Unused helper code was preserved rather than forced into
an unrelated workflow.

All eight imported `demo/backend/regen` modules remain present, with their
original top-level function/class definitions. This structural comparison does
not establish identical behavior; the backend regressions provide that separate
behavioral evidence. The earlier user changes were retained.

The product uses direct model APIs, a native bounded harness, source retrieval,
BM25 memory retrieval and optional demo LangGraph. CrewAI, LangSmith, Google SDK,
vector RAG and a general LangChain agent pipeline are not integrated product
features. Development packages and asset tools should not be presented as
core-runtime capabilities simply because they appear in package metadata.

## Reproduced issues and fixes

1. **Fresh installs prepared optional runtimes.** The previous lifecycle script
   ran npm installation and Python/venv/pip setup during CLI installation, then
   swallowed setup failures. A process-intercepting pressure test reproduced
   this without downloading dependencies. Postinstall now only gives setup
   guidance. Actual tarball installation also proves no optional dependency
   tree, virtual environment, memory or job state appears automatically.
2. **Legacy eval could invent a passing score.** No receipt/claims gave 100%
   fidelity; no required file touches gave 100% file precision. It read a
   lowercase ruling field instead of the unchanged historical verdict field,
   and scored detached launches before agent completion. Scoring now recognizes
   historical verdicts, rejects absent/open/tampered evidence and contradictions,
   and waits through the receipt-link phase. JSON success and exit status agree.
   A timed-out job remains inspectable and cannot pass; it is not silently killed.
3. **Workflow validation and sorting disagreed.** Non-array dependencies could
   pass validation and fail or mis-sort downstream. Validation now rejects
   malformed/duplicate dependencies; direct sorting validates before execution.
   Prototype-named steps persist safely, and interpolation uses own properties.
4. **API extraction could exceed the first-minute budget.** The API used a
   120-second inactivity timeout, which a trickling response could keep alive.
   A pressure case reproduced this. API and command extraction now share the
   bounded configuration (20 seconds default, 45 seconds maximum), with an
   absolute API deadline. Interrupted responses fail closed.
5. **Missing Windows extractor bypassed the fallback.** A real empty-PATH case
   reproduced an untyped launcher exception. Default unavailability now reaches
   the existing labelled conservative parser. Explicit extractor failures still
   fail closed; static mode never promotes tests/behavior without evidence.
6. **Dependency advisories.** Updated Workbench Next.js 16.3.5 → 16.3.6 and root
   Promptfoo 0.122.1 → 0.123.1. Both production and complete npm dependency
   audits report zero known advisories after the updates. The Next.js advisory
   concerns attacker-controlled Node `ImageResponse` SVG; no `next/og` usage was
   found in this application. Dependency audit success is not a security audit
   of all application logic. See [Next.js vendor advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j)
   and [js-yaml vendor advisory](https://github.com/nodeca/js-yaml/security/advisories/GHSA-r3ph-w7gj-g6xm).
7. **Release drift and automatic publishing.** 0.14.0 already exists on npm.
   Prepared 0.14.1, matching lockfile and dated notes, explicit public registry,
   shipped setup docs, private-path/package-budget guard, full local prepublish
   checks and manual-only GitHub dispatch with golden/Workbench prerequisites.
8. **Public entry-point inaccuracies.** Hero copy is `npx praxis-memory`, the
   new Test Your Project page explains local installation, canonical metadata
   uses the official Vercel home, and denied clipboard writes no longer claim
   success. The unrelated npm package `praxis` is not this product: the reliable
   fresh-install verification command is `npx praxis-memory verify`; installed
   PRAXIS also provides the `praxis` alias.

## Current recorded validation

Environment: Windows, Node 26.7.0, npm 11.19.0, Linux Docker engine.
The release workflow configures additional OS/Node legs; they were not executed
on those operating systems in this local audit.

| Check | Result |
| --- | --- |
| Final `npm run release:check` | Passed all configured gates, with no publishing |
| Core regressions | 522 tests: 515 passed, 7 explicit live-judge skips, 0 failed |
| Backend regressions | 149 tests: 146 passed, 3 explicit skips, 0 failed |
| Docker sandbox opt-in run | 15/15 passed, including real Node/Python execution; the two default Docker skips were exercised separately |
| Historical receipt fixtures | Passed unchanged in the core suite |
| Installed npm package | 9/9: install, bins, help, correct/false Git claims, zero-config npx with unavailable extractor, Ed25519, Live, offline replay and receipt readback |
| Promptfoo golden dataset | 5/5 expected outcomes; CONTRADICTED recall 1.0 and precision 1.0 against unchanged 1.0 baselines |
| Frontend | TypeScript and production Next.js 16.3.6 build passed; strict unused-local/parameter check passed |
| Browser interface | 12 views, light/dark, widths 320/390/768/1024/1440, 0 axe violations, 0 JS errors, 8 synthetic action contracts |
| Folder upload | Real directory selection, credential/dependency exclusion, local staging, bounded upload guards and scan handoff passed without model calls |
| Browser → API → Docker | Correct fixture: passing check, `runtime_observed`, readiness `not_established`; broken fixture: failed check, `contradicted`, readiness `blocked`; both source folders untouched, model cost 0 |
| Static website | Real setup navigation, command copy and copy-denial behavior passed; setup page has no hosted folder upload and no horizontal overflow at tested widths |
| Python environment | `pip check` passed; not a Python CVE scan |
| npm advisory audits | CLI production, Workbench production, root including dev tools, and Workbench including dev tools: 0 known vulnerabilities |
| Package | 247 files, 3,696,406 unpacked bytes (3.53 MiB), below unchanged 3.55 MiB limit; actual private-path manifest checked |
| Privacy/whitespace | Tracked privacy guard and `git diff --check` passed; packaged untracked files also pass the package-path guard |
| Coverage floor | 81.49% lines / 73.71% branches / 85.81% functions, above existing 80/72/85 floor; Windows measurement, Linux-calibrated floor |

Fixture-only performance spot check: a validated 1,000-node DAG sorted in
3.28 ms; BM25 query over 5,000 synthetic documents took 0.25 ms on this machine.
These single measurements are not release latency guarantees. The real installed
offline demo took about 17 seconds. Npx download latency depends on the network.

## Remaining limits

- The exact historical `npx praxis verify` fresh-install requirement cannot be
  fulfilled by publishing `praxis-memory` while the registry name `praxis`
  belongs to another project. The supported command and installed aliases are
  documented; no unrelated package was executed or namespace overwritten.
- Seven live judge evaluations and the periodic remote adversarial Promptfoo
  campaign were not run. No paid provider quality/credit/access certification is
  claimed. Red-team CLI compatibility was checked with local help only.
- Blocking mode was not enabled on any repository. Run the live red-team pass
  before opting into blocking; golden fixture success is not that campaign.
- Live vendor MCP sessions, GitHub App installation/permissions, hosted receipt
  sharing, npm trusted-publisher settings and GitHub branch-protection required
  checks were not provisioned or certified by a local code audit.
- Native all-platform installers, bundled runtime supervision, protected
  credentials and the new desktop/tray bridge remain planned. Existing CLI
  memory, Workbench job history and tray contracts are preserved; they are not
  automatically migrated into a new desktop store. Keep Workbench in a stable
  writable checkout rather than relying on an ephemeral npx cache for history.
- The new website page is local only until you deploy the static site. A hosted
  review API or source-storage service was not introduced.
- Docker check support, missing analyzers and absent task-specific browser
  journeys remain visible. Passing these fixtures cannot certify all runtimes,
  all uploaded projects, live production health or a complete penetration test.

## Manual release

See [manual npm release guide](MANUAL-NPM-RELEASE.md). The current npm session
answered `whoami`; publishing rights/2FA and external trusted-publisher settings
still depend on your account. Run `npm run release:check`, then issue `npm publish`
yourself from the full checkout. The gate runs again before upload. Review source
changes and package contents first; no credentials, history, dependency folders,
generated builds or private assets should be staged. Nothing was committed or
automatically included in a Git push during this work.

Detailed logs, manifests, screenshots, inventory and pressure-test before/after
evidence are in the ignored `apps/workbench/.regen/artifacts/` directory:
`audit-release-final.log`, `audit-coverage.log`, `audit-docker.log`,
`audit-frontend.log`, `audit-intake.log`, `audit-assessment.log`,
`audit-package-manifest.json`, `audit-website.json`, `audit-import-parity.json`,
`audit-inventory.json` and the `audit-*-before/after.log` pressure records.
