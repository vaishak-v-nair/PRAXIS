# PRAXIS product and codebase map

Current audit and release evidence: [2026-10-01 codebase audit](CODEBASE-AUDIT-2026-10-01.md).
Manual publishing: [npm release guide](MANUAL-NPM-RELEASE.md).

PRAXIS is a local project review tool for software built with AI. The current
checkout is the product being upgraded. `demo-original` is a product direction,
not another folder to import or a reason to overwrite working code.

## The user workflow

1. Add a local path, GitHub URL, or folder upload.
2. Choose server-side model settings, a shared spending limit, runtime trust,
   and independent network permission.
3. Review a separate source snapshot. Inspect findings, executed checks, and
   missing evidence together; each assessment retains its limitations.
4. Select issues and draft a source-aware repair plan. Confirm model handoff
   or copy the plan to an existing coding agent.
5. Inspect proposed changes and rerun authorized checks. Export GitHub/upload
   changes, or explicitly apply a fresh local patch with backup and rollback.

The browser renders backend evidence; it does not invent a readiness score or
reclassify failed checks. A finished review is not a claim that all code works.

## Where the product lives

| Surface | Implementation | Contract |
| --- | --- | --- |
| Project review | `apps/workbench/app`, `components`, `lib` | Next.js/React interface, same-origin API, live job updates, findings, execution, plans, patches, source map |
| Review backend | `apps/workbench/backend/regen` | FastAPI, local SQLite jobs, bounded intake/snapshots, scanners, provider adapters, shared budget, repairs |
| Isolated execution | Workbench `sandbox.py`, `scanner.py` | Trusted Node/Python commands in disposable Linux Docker containers; no host mounts or inherited credentials |
| Evidence decision | Workbench `review.py`, `reality.py`, `harness.py` | Deterministic assessment from recorded source/runtime evidence; model findings remain hypotheses |
| Memory and coding agents | `src/commands`, `src/lib`, `src/templates`, `src/tray` | Existing CLI commands, supported hooks/transcripts, adapters, private portable memory, tray |
| Claim verification | `src/lib/verify`, `src/commands/verify.js` | Exact Git binding, independent checks, four per-claim states, separate Ed25519 Verify receipt |
| Presentations | `src/lib/live`, `web/live`, CLI demo/deck | Rehearsed verified scenarios; optional LangGraph.js orchestration; native verifier remains authoritative |
| Public site | `web/_src.html`, `scripts/build-web.mjs` | Static information and setup links; not a remotely accessible review API |
| Quality gates | `test`, Workbench `backend/tests` and `tools`, `evals/verify`, `.github/workflows`, `scripts/ci` | Regression, UI/accessibility, golden/red-team, privacy, installed-package and size checks |
| Local state | `.praxis`, Workbench `.regen`, server-side `.env` | Private machine-local evidence, memory, snapshots, budgets, keys and backups; never automatically published |

`apps/workbench/import-manifest.json` records the earlier source import from
`E:/BrosKi/demo`. The eight original `backend/regen` modules and their top-level
definitions remain present. New review, Docker, upload, planning, and frontend
modules extend this foundation. Definition parity is a structural check;
regressions and real runtime evidence determine behavior.

## Technology boundaries

- Workbench uses direct model APIs with native Python orchestration and a bounded
  execution harness. Configured providers are Groq, OpenRouter, NVIDIA, and Gemini.
  Key presence is not proof of access, available credit, or response quality.
- Context retrieval uses relevant files and parsed source relationships.
  Core memory retrieval uses BM25. There is no embedding-based vector database.
- LangGraph.js is optional for PRAXIS Live. CrewAI, a general LangChain pipeline,
  dedicated LangSmith/Langfuse tracing, and the Google SDK are not integrated.
- CLI MCP tools and official evidence adapters remain separate from Workbench's
  Docker checks. A registered adapter is not proof that its server is connected.
- Three.js visualizes static source imports. File selection and relationships
  remain available without WebGL. The visual never assigns evidence verdicts.
- Core retains zero runtime dependencies. Workbench has its own npm lockfile,
  Python environment, and pinned requirements. Its source is included in the
  npm tarball, but dependencies, generated builds, private state, backend tests,
  and the sample repository are excluded. Presence of source does not establish
  that these optional runtime dependencies are installed.

## Evidence and privacy remain distinct

Source inspection establishes only the reported inspection scope. A passing test
establishes its recorded outcome. Homepage reachability is not a user journey.
The Docker runner currently does not drive browser journeys; complete end-to-end
and live production health claims need separate, task-specific evidence.

Workbench jobs do not automatically become signed CLI receipts. Historical
receipt formats retain their original semantics. Verify's Ed25519 format remains
separate; a signature proves the supplied record's integrity, not universal
software correctness or a third-party identity.

The review workspace stays local, but configured model reviews send bounded,
redacted source excerpts to providers. Repository downloads and advisory lookup
also use the network. Private conversation memory is excluded from review/model
payloads. Submitted-project networking remains independently opt-in.

## Public product upgrade

The interface now uses a shared paper/rose/graphite token system with an optional
dark appearance, readable evidence typography, progressive disclosure for review
details, reusable navigation/history/guide components, and explicit model setup.
Both appearances keep the same API and consent contracts.

The Windows entry point resolves its own checkout directory, prepares Workbench's
locked Node and pinned Python dependencies, stops on failed setup, and leaves
memory/hooks unchanged unless `-InitMemory` is selected. `-Check` is inert;
`-SkipInstall` launches a prepared checkout. It does not install core development
tools, create vector stores, probe providers, scan a project, or start repairs.

The README and website source describe these actual boundaries. Updating a local
website build does not deploy the Vercel site, publish a package, or establish
hosted-service authentication.

See [Project review quickstart](PROJECT-REVIEW-QUICKSTART.md),
[Workbench setup](WORKBENCH-INTEGRATION.md),
[Agent workflow](AGENT-WORKFLOW.md), and
[Assessment evidence](WORKBENCH-ASSESSMENT.md).

## Local validation — 1 October 2026

- Core regression: 510 tests, 503 passed, seven skips, no failures. The seven
  focused Workbench/Windows launcher checks also passed after the packaging
  documentation was reconciled.
- Backend regression: 149 tests, 146 passed, three skips. Two skips were the
  explicitly enabled Docker cases; a separate 15-test sandbox run then passed
  with real Node and Python containers. Windows symlink creation remains skipped.
- TypeScript and the production build passed. The production frontend and local
  API both respond successfully.
- Twelve frontend views passed axe checks in both themes, at 320, 390, 768,
  1024, and 1440 pixels, without page overflow or JavaScript errors. Synthetic
  UI contracts cover intake, errors, planning/handoff, consent, apply, budget,
  cancellation, theme persistence, blocked storage, and expandable next actions.
- Real browser/API folder upload passed credential/dependency exclusion and
  upload guards. Its scan submission was deliberately intercepted to avoid a
  model call.
- Real browser/API/Docker fixtures recorded a passing behavioral test as
  `runtime_observed` with readiness still `not_established`, and a failing test
  as `contradicted` with readiness `blocked`. Both source folders were untouched;
  model cost was zero. These fixtures are not live-provider quality evaluations.
- Promptfoo golden gate: five expected outcomes passed; CONTRADICTED recall and
  precision were both 1.0 on this dataset. No verdict logic changed, so the
  periodic remote red-team job was not run in this frontend session.
- Installed-package smoke passed seven checks, including Live Ed25519 verification
  and the marked offline demo. The subsequent brand-asset addition passed the
  actual package-size check: 3.50 MiB against 3.55 MiB. The CLI still has zero
  runtime dependencies. Tracked-path privacy and whitespace guards passed.

Machine-local screenshots and detailed logs are under Workbench's ignored
`.regen/artifacts`. No package or website was published, and no live model call,
source apply, credential migration, or evidence upload was performed.
