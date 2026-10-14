# PRAXIS project assurance platform

Status: Approach C implemented locally through observed workflows, project
identity, shared context, supplementary vendor observations and a desktop
prototype. Public desktop release remains gated on signed, exact-artifact
clean-install evidence. The implementation and remaining boundaries are below.

## Product promise

PRAXIS helps a builder, developer, or team answer: what does this project do,
what actually ran, what failed, what remains unknown, and what should an AI
coding agent change next? Source inspection, model hypotheses, observed runtime
behavior, production signals, and agent completion remain different evidence
types. No model's confidence changes an observed result.

The differentiated path is a project assurance loop, not a generic agent chat:

```text
folder / GitHub checkout / upload
  -> bounded private snapshot and source map
  -> source + optional model review under one budget
  -> authorized tests, builds, UI actions and state checks
  -> deterministic assessment with explicit unknowns
  -> reviewed fix plan and agent handoff
  -> fresh-snapshot recheck and human decision
```

## Existing foundation

- `apps/workbench/backend/regen/scanner.py`, `reality.py`, `harness.py`, and
  `review.py` supply the current inspection, execution, false-success, and
  deterministic assessment contracts. The Workbench and core CLI remain
  separately installed and tested.
- The Workbench already has four specialist model perspectives, peer challenge,
  one spending limit, source-bound findings, and local human notes. These are
  hypotheses until corroborated by execution.
- The core Verify engine registers reviewed, vendor-maintained MCP evidence
  sources. Registration is not proof that a source was connected or queried.
- The CLI, memory, hooks, tray, receipt formats, and existing source-apply gates
  are preserved. The core CLI keeps zero runtime dependencies.

## Build sequence and gates

1. **Observed journeys.** `journey_schema.py` defines bounded data-only steps:
   open a local route, fill a non-sensitive accessible field, click a control,
   observe text, and observe a route. Up to four selected scalar fields from
   read-only local JSON endpoints can be checked before, after and again after
   the action. `journey.py` uses independent HTTP requests, not browser mocks.
   Only newly observed UI plus stable, repeatable state changes earns
   `user_journey`; a visible change alone remains `ui_interaction`. Pre-existing,
   unchanged, partial, unstable and unavailable outcomes never become success.
   API state is not proof of database durability or external effects. Docker
   journeys remain unsupported and never switch to the host automatically.
2. **Project identity and local status.** `projects.py` adds opaque local,
   GitHub and upload identities, snapshot references and explicit moved-folder
   recovery. Original-source freshness and review-copy freshness are separate.
   Changes suppress readiness in both browser presentation and monotonic status;
   stored historical evidence remains unchanged. CLI `review --status` and MCP
   `praxis_project_review_status` read authenticated, sanitized state. Missing
   historical source digests remain unknown; remote state is not fetched by
   polling. No `.praxis` or `.regen` migration occurs.
3. **Desktop delivery.** `apps/desktop` is a thin Tauri 2 shell, using the same
   Next/Python engine and dependency-free service owner as the CLI. The protected
   per-user descriptor, nonce challenge, one-use browser link and HttpOnly
   session prevent an unrelated listener being treated as PRAXIS. Native folder
   selection prefills intake; it never starts a review or project command.
   Bundled Node/Python and the Windows offline WebView2 installer remove manual
   consumer runtime setup. The native tray handles reopen and explicit quit;
   active work requires an interruption decision. Development artifacts and CI
   are implemented; signed Windows/macOS releases, clean-machine acceptance on
   every supported OS, OS-keychain storage and updates remain release obligations.
4. **External evidence adapters.** `evidence.py` invokes the shared official
   MCP registry/transport through an allowlisted Node bridge. Operations are
   GitHub PR/files/open scanning alerts/Dependabot, an existing Microsoft
   Playwright accessibility snapshot, Sentry issue detail, and project-scoped
   read-only Supabase schema/migrations. Queries record timestamps, bounded
   redacted excerpts and digests. Empty/tool-error responses stay unavailable.
   Explicitly selected remote scope is not an automatic commit/deployment
   binding, and these observations do not override local assessment. Live
   vendor authorization remains a separate check. No community server is added.
5. **People and agent teams.** `coordination.py` adds revisioned assignments,
   prerequisites, goals, decisions and handoffs to the existing human discussion.
   Model review rounds receive only selected context under the existing shared
   budget. Completion reports remain claims; rechecking is separate. Expiring
   leases and concurrency rules are tested backend primitives, not an advertised
   installed-agent execution system. They cannot approve spending, execution,
   source apply or verdicts. Direct provider execution remains authoritative.

## One engine, several clients

```text
CLI launcher / Tauri supervisor
  -> protected per-user owner lease + authenticated loopback gateway
  -> the same Workbench UI and Python API
  -> one local SQLite job/project/coordination store
  -> inspection, explicitly authorized runtime and optional model review

browser -> one-use opening link -> private HttpOnly session -> gateway
CLI/MCP status -> protected descriptor + challenge -> sanitized status
vendor evidence -> reviewed bridge operations -> supplementary observations
```

The existing memory CLI, historical HMAC receipts, Verify Ed25519 receipts and
legacy tray remain separate preserved contracts. An owner-handshake HMAC is a
service capability, not a receipt or a public signature. The desktop reuses a
curated public mascot asset; it does not bundle the private brand vault.

## Dependency policy

Use the installed Workbench Playwright, FastAPI, Pydantic, Next/React, and
lucide-react packages before adding another layer. Keep desktop dependencies in
an optional app, not the core CLI. A graph or agent framework must earn its
maintenance cost through measured correctness, latency, or recovery improvements;
the existing four-specialist loop does not need one merely to display agents.

## Failure and acceptance map

| Failure | Required product behavior | Test gate |
| --- | --- | --- |
| Model unavailable, malformed, or out of budget | Preserve static findings and mark model scope unavailable | Provider and shared-budget regressions |
| Runtime not trusted or Docker absent | Do not run or switch environments | API trust and dispatch tests |
| UI text appears without a backend write | Record UI observation only; leave full journey open | Browser fixture plus database/API state fixture |
| External evidence source times out or is unauthenticated | Keep local evidence, name missing source and time | Adapter failure tests |
| Source changes after review | Reject apply and stale evidence | Freshness and rollback regressions |
| Duplicate desktop process or occupied port | Verify instance ownership; never kill unrelated listener | Multi-launch native smoke |
| Window closes during review | Job state and evidence survive or show interruption | Native close/crash tests |
| Provider key or submitted secret enters a result | Redact, fail privacy gate, never ship artifact | Privacy/package and installed-artifact checks |

Public claims should be gated on the exact installed artifact: backend suite,
frontend TypeScript and build, core regression, privacy guard, package budget,
browser true/false/stale fixtures, and native clean-machine tests when the
desktop shell exists. A compiled shell, passing CI, or signed receipt does not by
itself establish product correctness.

## Repeatable software-testing gates

`npm run test:assurance` drives the actual production interface and authenticated
service with two temporary test projects. It exercises intake, assignments,
private notes, trust consent, responsive layouts, a real file-backed backend
state change, and a success response with no state change. It also reads the
same status through the CLI/MCP adapter. Fixtures are QA-only; no model call or
user project is involved. Screenshots and result/status records stay in the
printed temporary QA directory.

The Workbench CI workflow includes a dedicated assurance job and the manual
release gate includes the same rendered workflow. Core receipt regressions,
Promptfoo recall/precision, backend tests, TypeScript/build, privacy, package
budget and installed-tarball smoke remain distinct gates. CI artifacts contain
only QA screenshots and sanitized result/status records, never the private
service descriptor, jobs or credentials. Remote branch protection still needs
to select the emitted checks as required; a workflow file does not change that
repository setting by itself.
