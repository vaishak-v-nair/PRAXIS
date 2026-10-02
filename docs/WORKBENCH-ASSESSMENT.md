# Local engineering assessment

Start from the repository root with `npm run workbench`, then open
http://127.0.0.1:3000. Existing folder, folder upload, GitHub intake, findings,
repair, export and confirmed source-apply workflows remain available.
`REGEN_BACKEND_URL`, when used, is restricted to a credential-free loopback
HTTP origin so the local frontend cannot proxy project requests to a remote host.

## Review a project

1. Enter a local folder or GitHub URL, or upload a folder. Browser uploads are
   resumable and sent in bounded batches: up to 25,000 reviewable files and
   100 MiB total. Files over 2 MiB and generated/private paths are reported as
   excluded instead of aborting the whole folder. Larger projects can use a
   local path without copying source into the browser.
2. The browser runs one complete review contract: bounded local inspection,
   independent review by every configured provider, and authorized Docker
   commands. These records feed one assessment instead of separate overlapping
   scope toggles. Dependency vulnerability lookup can send package names and
   exact versions to OSV.
3. Model review uses the selected backend provider and the existing shared job
   budget. Keys stay in the backend `.env`. Model settings
   has a synthetic compatibility test capped at $0.05 using configured rates;
   passing it establishes authenticated JSON compatibility, not coding quality.
   Ultra ensemble pressure test assigns independent user, reliability, security
   and production-architecture challenges across every configured provider.
   All calls share the job budget. Non-primary providers use provider-specific
   price estimates when supplied, otherwise a conservative multiple of the
   selected estimate. A failed, rate-limited or out-of-credit provider is kept
   as a coverage gap; it is never replaced with a successful result. Each model
   finding still needs a real file, line and nearby source token before it enters
   the report.
4. Docker execution keeps its explicit trust authorization because submitted
   projects are untrusted code. Networking is off by default. If enabled, all
   project commands can use Docker bridge networking, including local-network
   access; this is not a registry-only firewall. API clients retain the existing
   individual scope fields for compatibility.
5. Read the final engineering decision, implementation-reality state, evidence
   gates, findings, command logs and coverage gaps. Production readiness is a
   deterministic evidence verdict, never a model score. `blocked` means an
   observed failure or unresolved blocker exists; `not established` means the
   required proof did not run; `release candidate` requires complete local
   inspection, a passing behavioral test command, and a task-specific browser
   journey bound to the current snapshot. The built-in browser check is a
   homepage smoke only and cannot satisfy that journey gate. The 3D map
   visualizes bounded static imports. It does not execute code or establish
   runtime coverage. The accessible file selector works without WebGL.

The report never calls a setup-only, lint-only, build-only, or homepage-only run
an end-to-end demonstration. Process exit zero proves only that the recorded
command returned successfully. No conventional test files, missing tools,
unsupported checks and provider failures stay visible. Each assessment dimension
contains the exact inventory, coverage, finding, or execution records used for
its state, plus its known limits. Existing AI findings retain uncertainty labels.

## Container prerequisites and boundary

Run Docker Desktop with a Linux engine, then fetch the supported official images:

```powershell
docker pull node:22-bookworm-slim
docker pull python:3.12-slim
```

The runner resolves each tag to an image ID for that run. It never builds a
submitted Dockerfile or silently pulls an image. Each runtime receives a
disposable container with no host directory or Docker socket mounted, UID 1000,
all capabilities dropped, no-new-privileges, read-only root, 1 CPU, 1 GiB RAM,
128 PIDs, and bounded tmpfs storage. Source is copied through a bounded archive;
dotenv, common credential configs and private-key files are excluded, and
recognizable text secrets are redacted. Redaction may affect test behavior and
cannot identify every secret. Containers share the Docker engine's kernel;
this is not VM-grade isolation for actively hostile code.

Execution is capped at 16 commands and ten minutes per run, with 180 seconds
per setup command and 120 seconds per check. Failed setup skips dependent
commands. Timeout/cancellation removes the container; cleanup failures are
reported. No host execution fallback exists. Browser journeys, external service
side effects, arbitrary language environments and semantic path coverage are
not yet supported in the container runner. Node/Python mixed projects use
separate containers, so they do not share installed dependencies.

The verification dialog defaults to Docker. Trusted-host verification remains
available explicitly. For compatibility, existing API clients omitting
`runtime_mode` on `/verify` retain the historical host mode and still require
`trust_confirmed`. New clients should send `runtime_mode: "docker"`.

## API additions

`POST /api/scans` accepts `ai_review`, `review_mode`, `run_checks`, `trust_confirmed`, and
`allow_network`. Defaults preserve historical clients: AI on, execution off.
The browser sends AI on, `review_mode: "ultra"`, and authorized Docker execution
as its unified full-review contract. Historical `"deep"` clients use the same
multi-provider path.
Requesting execution without trust is
rejected; network permission without authorized execution is rejected.

Jobs include additive `plan`, `assessment`, `pressure_tests`, and `fix_plan`
fields. Repair planning runs before mutation and binds later repairs to the
selected findings and plan ID. Local sources use fingerprinted backup and
rollback; GitHub sources produce an isolated local review branch or patch and
never push; browser uploads produce downloadable changes. Existing stored jobs and
receipt formats are not migrated. `plan.understanding` inventories stack,
entrypoints, planning files and tests. It may report that local PRAXIS continuity
exists, but `.praxis` and raw conversation memory are excluded from snapshots,
model context and project execution. Background conversation capture remains the
responsibility of the existing PRAXIS hooks and memory commands.

`assessment.implementation` distinguishes a tested task-specific journey,
homepage smoke, passing commands, observed failures, placeholder risk and
missing proof. `assessment.readiness`
reports `blocked`, `not_established`, or `release_candidate`; its dimensions
show inventory, local inspection, model coverage, security, runtime, browser,
implementation and repository operations separately. Every dimension carries
inspectable evidence records and limitations. Repository deployment, CI, or
observability files are reported only as present artifacts; they do not prove
live production health. No numeric readiness score is produced.

Folder intake also supports resumable session endpoints under
`/api/uploads/sessions`. Individual requests stay below the existing 32 MiB
body guard. Abandoned staging sessions are pruned after 24 hours on startup;
completed uploads remain untouched.

`POST /api/providers/probe` takes the same provider/model/prices as settings.
It makes one budgeted synthetic request, checks a random nonce and exact JSON
answer, returns latency/cost/compatibility, and does not change saved settings.
Only one probe runs at a time. Provider prices other than OpenRouter are supplied
estimates: budget accounting is only as accurate as those rates.

## Findings and repair handoff

The Findings view presents every issue as a human-readable brief: what PRAXIS
observed, why it matters, the exact recorded evidence, and the recommended
response. Severity explains release impact; confidence and repairability remain
separate so an urgent claim is not mistaken for a confirmed one.

**Draft a fix plan** is planning-only. It does not edit the review copy or send a
repair request. After the source-aware plan is visible, the user chooses one of
two handoffs:

- confirm the named provider and model connected to PRAXIS, then authorize it to
  implement the bounded plan in the isolated review copy; or
- copy a portable implementation brief for an existing coding agent.

The portable brief includes selected findings, evidence locations, planned
files, validation, risks, user journeys, unresolved questions, and the
engineering safety contract. Provider output remains a proposal. Independent
review, runtime verification, and applying changes to a local source each retain
their separate states and confirmations.

## Validation

```powershell
cd apps/workbench
npm run test:backend
$env:PRAXIS_TEST_DOCKER='1'
npm run test:backend
npm run typecheck
npm run build
```

The opt-in Docker suite runs real passing and failing Node assertions, checks
the isolation boundary, and executes the discovered Python venv/install/unittest
sequence. Unit/API tests cover unavailable Docker, cancellation, failed setup,
provider errors, no-model review, trust gates and assessment false-success cases.
Development backend tests and smoke tools stay in Git but are excluded from the
published CLI package to preserve its download budget. Three.js is an optional
Workbench dependency; the CLI remains free of runtime dependencies.

Next work: coverage-aware tests of changed paths, container browser journeys,
task-specific model evaluation and routing, and broader runtime support. No
claim is made that every configured provider works or that a model can be made
reliable merely by supplying its API key.
