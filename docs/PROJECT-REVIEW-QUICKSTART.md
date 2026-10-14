# Review a project with PRAXIS

PRAXIS reviews an existing project, records what its checks actually demonstrated,
and helps you prepare a repair plan. It runs locally. Model reviews send bounded,
redacted source excerpts to the providers you configure; running the interface
alone does not make a model call.

## Start the tool

From this checkout with Node.js 22+ installed, on Windows, macOS or Linux:

```powershell
node src/cli.js review
```

This prepares the optional application's locked Node dependencies and private
Python runtime, builds the production interface, and opens the browser after
the actual API and page respond. Initial setup needs internet and several minutes;
Git, system Python and Docker are not required to start the tool or inspect source.
Repeat the same command for later sessions.
`review --check [--json]` is inert; `review --setup-only` installs without launching;
`review --no-open` keeps automatic browser opening off. The launcher owns one
authenticated local service. Another compatible CLI/desktop client attaches to
it instead of starting a second engine. Ctrl+C in the owning launcher stops its
services; closing an attached CLI leaves the owner running.

Read the running service without starting or modifying it:

```powershell
node src/cli.js review --status
node src/cli.js review --status --json
```

Status reports review-copy and original-source freshness separately and contains
no source excerpts, local paths, conversation or provider keys. The read-only MCP
tool `praxis_project_review_status` exposes the same projection.

After **0.14.2** is manually published, the public command is
`npx praxis-memory@0.14.2 review`. The website checks the exact npm release before
enabling its copy button. Version 0.14.1 does not include this new command.

Saved reviews and provider settings live under:

- Windows: `%LOCALAPPDATA%\PRAXIS\ProjectReview\data`
- macOS: `~/Library/Application Support/PRAXIS/ProjectReview/data`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/PRAXIS/ProjectReview/data`

App releases are separate sibling folders. Existing checkout `.regen`, `.env`,
memory and hooks are not copied or migrated. The optional `--home <dedicated-folder>`
chooses another persistent location. Keys pasted into **Models → Provider API key**
are saved only by the loopback service, never returned to the interface. The local
credential file uses owner-only Unix permissions; it is not an OS keychain. Existing
environment keys retain priority and must be changed in their original environment.
Saving a key makes no model request; compatibility testing is a separate paid action.

The existing `.\start.ps1` development launcher remains available. Its `-Check`
and `-SkipInstall` options are unchanged; `-InitMemory` explicitly opts into hook
setup. That source-checkout launcher still requires system Python 3.11+.

From a prepared PRAXIS checkout:

```powershell
npm run start:workbench
```

Open **http://127.0.0.1:3000**. For development use `npm run dev`.
Use the appearance button in the header to switch between paper and dark
themes. The choice is saved in this browser only.
For a fresh checkout, follow the separate Node/Python installation steps in
[Workbench setup](WORKBENCH-INTEGRATION.md). Build the frontend with
`npm run build:workbench` before using the production launcher.

## Review your project

The home screen lists projects, with the latest saved review and its source
freshness. A completed review is a recorded run, not proof that a product works.
When the original folder or review copy changes, the home screen asks for a
fresh review. Older unlinked runs remain under **Earlier reviews** and **All
review runs**; opening them does not migrate or relink their evidence.

1. Choose your project folder, paste a GitHub repository URL, or provide a local path.
2. Describe what the project should do, then select **Review project**. The default
   source review needs no provider key, Docker, or project-command authorization.
   It inspects a separate copy and reports source-backed findings and limits.
   For a large folder, PRAXIS selects source, tests, and manifests before media
   within its bounded snapshot. It reports omitted file counts and treats a
   partial snapshot as limited evidence. Nested Git checkouts are separate
   projects; select one directly if it belongs in the review.
3. Read the prioritized issues, successful observations, and checks that have not
   been performed. A finished review does not mean the project works end to end.
   Copy the findings into your coding agent; the brief includes source locations,
   review scope, and a requirement to validate the current source before edits.
4. Optionally enable **AI analysis** in the review form. Open **Models**, select a
   provider, and save its key locally. The selected provider must have a configured
   key; a key for another provider cannot silently enable it. Set actual token rates and a shared spending
   limit. A configured key does not guarantee access or remaining credit. Source
   inspection still works when models are unavailable.
5. For runtime evidence, inspect the discovered commands and explicitly choose
   trusted local execution or Docker. Authorize only a project you trust. Local
   execution uses a review copy but can access your computer and network; it is
   not an OS sandbox. Docker needs its local Linux engine and prepared images,
   and retains separate network consent. There is no automatic environment fallback.
   In **Run project checks**, provide a start command for local port 4173 and
   enable **Observe a user workflow**. Choose a single click or a bounded
   multi-step workflow: routes, accessible fields/controls and expected text.
   Add a read-only local JSON API route, value path and expected scalar outcome
   to independently check backend state before, after and again after the action.
   Use non-sensitive test data; form values are transient, not stored in history.
   An occupied port or stopped owned process cannot supply successful evidence.
6. For a model-generated plan, select relevant Findings and **Draft a fix plan**.
   Review it before confirming a model handoff, or copy it into your existing
   coding agent. A copied brief, generated plan, implementation, and source apply
   are distinct actions. Planning does not authorize source changes.
7. Open **Workspace** to assign current-snapshot tasks to a person or selected
   model reviewer, record goals/decisions and prepare handoffs. Sharing is
   explicit; local-only context is not sent to model reviewers. A completion
   report stays a claim until independently checked. This local shared workspace
   is not an authenticated internet collaboration service or autonomous coding
   agent task runner.
8. Open **Evidence** for supplementary read-only observations from official
   GitHub, Microsoft Playwright, Sentry or Supabase MCP servers. Vendor tokens
   stay in the local service environment; this page never accepts credentials.
   You choose and authorize the remote scope. A configured token is not proof of
   access, and remote scope is not automatically bound to the local deployment.

Local projects use guarded apply with freshness checks, backup, and rollback.
GitHub and uploaded projects provide downloadable patches or project copies;
PRAXIS does not push to your repository. Docker checks use disposable containers
without host mounts or provider credentials. Local checks use a separate source
copy and a stripped process environment, with host permissions explicitly disclosed.

## What the result means

- A completed source scan establishes inspection within the reported limits;
  it does not establish test or user-journey success.
- A model finding is a hypothesis with a source reference, not runtime proof.
- Dependency setup success is separate from test or build success. A download
  failure leaves behavior unproven; it does not prove a broken implementation.
- Passing tests establish the recorded test outcomes. Homepage reachability
  does not establish a complete user journey.
- A passing browser interaction establishes only that the expected text became
  visible after one control was clicked in the local review app. It does not establish a
  backend state change or external side effect and cannot alone satisfy the
  release-candidate user-journey gate.
- A structured workflow earns user-journey evidence only when the new visible
  outcome and every selected independent API state check succeed, including a
  repeated confirmation. A static success response, absent expected change or
  partial outcome cannot pass. Selected JSON fields do not establish database
  durability, complete business behavior or external side effects.
- A changed or missing reviewed copy cannot reuse earlier successful checks for
  readiness. A changed original folder remains separate from its saved review;
  start a new review or explicitly relink a moved folder. Historical evidence is
  kept, not rewritten. Freshness covers the bounded file selection, not excluded
  generated dependencies or oversized data.
- Missing analyzers, provider quotas, unsupported runtimes, and safety limits
  remain visible. The Docker runner currently does not drive browser journeys;
  it rejects a requested interaction rather than silently switching to local
  execution.
- Agent plugin and skill directories are excluded from product inspection so
  vendored tooling does not overwhelm application evidence. Root `AGENTS.md`,
  `CLAUDE.md`, and project documentation remain eligible. Original files are
  preserved. Check Source inspection for the actual exclusion and file counts.

Uploads allow 25,000 eligible files, 2 MiB per file and 100 MiB total. Generated
dependencies, private local memory, and credentials are excluded. For larger
projects, use a local path and inspect the recorded scope limits.

PRAXIS is a local review tool. A release-candidate assessment does not certify
live production health, complete security, or all user workflows. Workbench
evidence does not automatically become a signed CLI verification receipt.

## Optional desktop prototype

The Tauri desktop app uses the same review engine, data store, source trust and
model budget. Its native folder picker only prefills the review form. Bundled
Node/Python remove those manual consumer prerequisites; submitted-project
builds still need their own toolchain or explicitly selected Docker. Development
installer instructions and exact-artifact release gates are in
[apps/desktop/README.md](../apps/desktop/README.md). A successful local build does
not imply a signed public installer or clean-install validation on every OS.
