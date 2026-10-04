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
`review --no-open` keeps automatic browser opening off. Ctrl+C stops both services.

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

1. Choose your project folder, paste a GitHub repository URL, or provide a local path.
2. Describe what the project should do, then select **Review project**. The default
   source review needs no provider key, Docker, or project-command authorization.
   It inspects a separate copy and reports source-backed findings and limits.
3. Read the prioritized issues, successful observations, and checks that have not
   been performed. A finished review does not mean the project works end to end.
   Copy the findings into your coding agent; the brief includes source locations,
   review scope, and a requirement to validate the current source before edits.
4. Optionally add model review in the review options. Open **Models**, select a
   provider, and save its key locally. Set actual token rates and a shared spending
   limit. A configured key does not guarantee access or remaining credit. Source
   inspection still works when models are unavailable.
5. For runtime evidence, inspect the discovered commands and explicitly choose
   trusted local execution or Docker. Authorize only a project you trust. Local
   execution uses a review copy but can access your computer and network; it is
   not an OS sandbox. Docker needs its local Linux engine and prepared images,
   and retains separate network consent. There is no automatic environment fallback.
6. For a model-generated plan, select relevant Findings and **Draft a fix plan**.
   Review it before confirming a model handoff, or copy it into your existing
   coding agent. A copied brief, generated plan, implementation, and source apply
   are distinct actions. Planning does not authorize source changes.

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
- Missing analyzers, provider quotas, unsupported runtimes, and safety limits
  remain visible. The Docker runner currently does not drive browser journeys;
  use separate task-specific Playwright evidence for those workflows.
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
