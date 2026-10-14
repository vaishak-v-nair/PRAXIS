# PRAXIS AI full-stack reset

## Product decision

PRAXIS is a local-first AI project engineer for people, developers, and teams building software with AI. A user selects a real project, tells PRAXIS what it is meant to do, and receives an evidence-backed answer to three questions: what works, what is at risk, and what should happen next. AI helps interpret the project and draft a focused handoff; deterministic source, execution, and freshness evidence decide what may be stated as observed. A model response, a completed review job, and a signed receipt remain different things.

The primary experience is **Projects → Review → Findings → Next action**. Source selection, runtime trust, model connection, and budget are explicit controls at the moment they matter. Saved reviews, checks, work boards, provider diagnostics, and evidence detail remain accessible from a project. Marketplace, team coordination, and experimental surfaces do not lead the first-use experience until they have a demonstrated user job and working supply side.

## Pressure-test baseline, before product code

- The CLI is dependency-free in `src`; the public site is in `web`; the optional Next.js/React frontend and FastAPI/Pydantic service are in `apps/workbench`. Do not replace one package with another or import Workbench dependencies into the CLI.
- A real source-only review can prepare an isolated copy and produce scanner findings and a deterministic assessment without a model key. Configured providers add bounded AI analysis. Project command execution requires explicit trust and a selected host or Docker runtime. The local project registry already tracks source identity, snapshot binding, and freshness.
- The frontend still treats saved **jobs** as the home-level object while the backend now has persistent **projects**. It labels `status=complete` as "Review finished", which does not communicate whether the behavior was demonstrated or production readiness was established.
- Baseline frontend typecheck passed. The real browser → API smoke is stale at a UI text locator before it exercises the project. The first concurrent core run had one Windows archive test exceed its 30-second setup limit; re-run it alone to distinguish contention from a defect. Backend suite was still running when this plan was written.

## Architecture and contracts

Keep the proven engines and data, but replace the product-facing seams incrementally. The diagram is a dependency direction, not a second orchestration framework:

```text
Next.js local UI / optional desktop shell
      ↓ typed API contract
FastAPI read model + workflow endpoints
      ↓
Project registry → immutable review snapshots → scanner/review/harness
      ↓                       ↓
SQLite local records     optional bounded provider analysis
```

The canonical user object is a **project**, with a latest **review** bound to a source snapshot. A review has a stage, evidence scope, findings, assessment, model usage, and next actions. Project status must distinguish `current`, `stale`, and `unavailable`; a missing snapshot cannot become a healthy state. For historical reviews without a project link, show a separate legacy history entry and never silently register, migrate, or reinterpret it.

The first new API is an additive, typed, read-only workspace projection. It combines the existing project registry, project status, and public review assessment for the current review. Its surface contains only public identifiers, human-readable project names, source kind, stage, freshness, assessment status, finding/check counts, and latest review timestamp. It must not expose source paths, source excerpts, private memory, credentials, conversations, provider keys, raw error text, or unsupported verdicts. Reuse the existing `ProjectRegistry.status()` freshness logic and `review.assessment()`; do not create a second verdict system. Keep `/api/projects`, `/api/projects/{id}/status`, and `/api/jobs` compatible.

The UI will consume that projection for the home project list and retain existing review history as a secondary, reachable surface. A project row opens its latest review. A project with no review says it has no evidence yet. A stale/unavailable review says so before its old findings. The same state drives screen reader labels and compact mobile layout. No fabricated example data or success badges are permitted.

Use the stack already proven here: Next.js 16 + React 19 + TypeScript for the UI; FastAPI + Pydantic for bounded API contracts; SQLite for local durability; Playwright for user-journey checks. Add a dependency only when it solves a measured gap. A premium product comes from precise contracts, responsive interaction, accessibility, and real execution evidence, not from an orchestration framework or decorative component count.

## Build sequence and gates

1. **Repair the baseline.** Finish backend tests; re-run the isolated core timeout. Update the stale browser smoke selectors to the current UI, without weakening behavioral assertions. Confirm an offline source-only review and both passing/failing authorized test runs.
2. **Ship one full-stack vertical slice.** Add a read-only project workspace projection with focused tests for current, stale, unavailable, in-progress, malformed historical, and unlinked legacy records. Wire a typed frontend project home that uses this contract, preserves direct review links, and has honest loading/offline states. Keep existing detail and action endpoints. Test via backend suite, TypeScript, production build, and a real browser/API flow.
3. **Unify review orchestration.** Decompose the current stage handler behind internal interfaces for intake, evidence, bounded AI analysis, authorized execution, deterministic assessment, and handoff. Preserve the stored job contract and enforce snapshot, trust, source-apply, and shared-budget checks at each side-effect boundary. Add characterization tests before moving each stage.
4. **Make the project review the product surface.** Replace Overview/Checks/Work fragmentation with a concise summary, prioritized findings, evidence drawer, and copyable or agent-directed fix plan. Every visible action must use a real backend operation and return its true stage or failure. Preserve power-user detail and collaboration behind progressively disclosed views.
5. **Distribution and quality.** Keep Docker as an optional isolation runtime; make desktop/CLI-assisted local startup the default. Validate Windows/macOS/Linux packaging separately, accessibility and 320–1440px layouts, bounded project sizes, no-key offline mode, configured-model mode, cancellation, reconnect, and recovery. Protect historical CLI receipts, hooks, `.praxis` memory, and public-site install paths with their existing regressions.

At each gate, compare actual behavior with stored evidence. A review finishing does not certify the product, and a failed or skipped check stays failed or skipped. Do not push or publish during this reset without a separate user instruction.

## First slice implemented

The additive `/api/workspace` projection now pages project identities and unlinked historical reviews, exposes a current review's deterministic assessment only when its snapshot is current, and exposes a newer still-running job without borrowing an older snapshot's checks. The frontend uses this projection for a project-first home and sidebar while keeping all review runs reachable. The review form presents optional AI analysis and its spending limit directly; it enables the selected provider only when that provider has a configured key. Existing source inspection, agent handoff, command execution, and guarded apply endpoints are unchanged.

The real browser → API → host smoke now launches a temporary backend and data store, so its deliberately correct/broken fixtures do not enter the user's saved projects. It observed a passing test as `runtime_observed` with readiness `not_established`, and a failing test as `contradicted` with readiness `blocked`, at $0 model cost. The project-home browser pass checked five viewport widths and two themes with zero accessibility violations or writes. Full backend and core suites, production build, privacy guard, measured package budget, and installed-package smoke passed. This validates the first slice, not the later orchestration and distribution phases above.

The large-repository pressure test exposed a second gate: the former alphabetical snapshot filled its 100 MiB budget on nested tooling and media before reaching `src`. The source selector now discovers candidate files without executing project commands, excludes independent nested Git checkouts, and prioritizes manifests, source, and tests before documents and media. Original-snapshot omissions are carried into local inspection coverage; a complete scan of an incomplete copy cannot pass the source-readiness gate. A real source-only PRAXIS self-review kept `src/cli.js`, the Workbench backend, and CLI tests, while reporting 8,851 omitted files and four excluded nested repositories as limited scope. It ran without model calls or project commands, did not change the original source, and took 162 seconds. Large-project performance and scope controls remain follow-up work; this is not yet a whole-folder certification.

A follow-up pressure test found that project attachment and status hashing held
the SQLite write reservation while reading large source trees. The registry now
hashes outside that reservation and rechecks project and job revisions before
committing a snapshot or status. The home reads a fast, conservative project
page, then checks exact source and snapshot freshness through bounded status
requests. A pending or failed status cannot display old checks as current. The
API and browser tests cover that boundary, including a malformed status and a
client revision ahead of the server. This improves home responsiveness without
turning a quick list request into evidence of working behavior.

The production browser and API pass after this change reported first paint at
1.5 seconds with saved local history, no horizontal overflow
at 320–1440 px, no WCAG AA violations, JavaScript errors, or browser writes.
A stopped historical scan is labelled **Review stopped** rather than suggesting
that a missing snapshot is a service outage. The full backend suite passed 316
tests (3 environment skips); the core suite passed 584 tests (7 optional live
evaluation skips). TypeScript, production build, 17-view browser smoke, the
public-site light/dark layout audit, privacy guard, package budget, and installed
tarball smoke passed. A correct authorized host test remained
`runtime_observed`/`not_established`; a broken one was `contradicted`/`blocked`.
These local checks do not establish live-provider accuracy, Docker isolation,
cross-platform desktop packaging, or every project's production readiness.

## Acceptance criteria for the first slice

- A new user can select a project and return later to a project-centered home without Docker or an account. Offline source-only review remains useful.
- The home status is based on current snapshot assessment, never just `job.status == complete`; stale/unavailable source is visible, and legacy records remain reachable without mutation.
- A configured AI provider is optional, budgeted, and visibly distinct from deterministic proof. No live model charge is part of routine regression tests.
- Backend regressions, frontend typecheck/build, core CLI regressions, privacy guard, package budget, and real browser smoke pass or are reported with exact failures.
