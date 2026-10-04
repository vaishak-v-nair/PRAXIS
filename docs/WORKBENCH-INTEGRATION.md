# PRAXIS workbench integration

The local project previously run from `E:\BrosKi\demo` now lives in
`apps/workbench`. Its complete review-and-repair application is added to this
repository; the existing PRAXIS implementation remains in place.

For folder uploads, GitHub connection troubleshooting, and coding-agent
compatibility, see [AGENT-WORKFLOW.md](AGENT-WORKFLOW.md).
For the user workflow and evidence limits, see
[Project review quickstart](PROJECT-REVIEW-QUICKSTART.md).

## Directory responsibilities

| Directory | Responsibility |
|---|---|
| `src/commands`, `src/lib` | Existing PRAXIS CLI, capture, memory, receipts, jobs, workflows, evaluations, governor, and deck |
| `src/templates`, `src/tray` | Existing agent commands and desktop companions |
| `web`, `docs` | Existing public website, documentation, and curated brand renders |
| `test`, `scripts/ci` | Existing core regression tests, privacy checks, and package gates |
| `apps/workbench/app`, `components` | Imported Next.js review-and-repair interface |
| `apps/workbench/backend` | Imported Python API, scanners, model adapters, budgets, repair workers, and regressions |
| `apps/workbench/tools` | Imported development, pressure-test, and optional live-provider tools |
| `apps/workbench/repos/Zentara` | Imported sample application's source and tests |
| `apps/workbench/.regen` | Ignored local job history, snapshots, patches, and apply backups |

The root npm package retains zero runtime dependencies. The workbench is an
optional application with its own npm lockfile and Python virtual environment.
The npm tarball includes optional Workbench source, but not its dependency
folders, Python environment, generated builds, local jobs, backend tests, or
sample repository. Install and run its separate dependencies explicitly; the
core CLI never loads them. A source checkout is recommended for development and
the full regression tools. An installed CLI can also use
`praxis workbench --path <checkout>/apps/workbench`.

### Managed consumer setup (0.14.2)

`node src/cli.js review` works from this checkout. After the manual npm release,
`npx praxis-memory@0.14.2 review` works without Git or manual Python setup.
Docker is optional: the default review inspects source without executing the
project or calling a model. Explicit runtime checks can use a trusted local
review copy or Docker. Native checks retain host permissions and are not an OS
sandbox; unavailable Docker never falls back to host execution.
This explicit command alone prepares the optional app; postinstall and the existing
default CLI remain inert with respect to these dependencies. See the
[consumer quickstart](PROJECT-REVIEW-QUICKSTART.md) for paths and options.

The launcher copies only allowlisted runtime source to a version/fingerprint
release directory in the user's application-data folder. Jobs and provider settings
remain in a separate persistent `data` folder, not npm's cache. It does not migrate
checkout evidence or credentials. `PRAXIS_WORKBENCH_DATA_DIR` and
`PRAXIS_WORKBENCH_ENV_FILE` are trusted-process, absolute-path overrides; without
them the backend retains its original `.regen` and `.env` locations. Submitted
project commands do not receive these variables. The key-entry endpoint shares
the existing loopback Host/Origin and active-job protections, returns no secrets,
and leaves environment keys authoritative. Saved keys are local files, not an OS
keychain. Provider probes and all runtime/apply budget gates remain explicit.

## Integration sequence

1. Import application source without overwriting existing PRAXIS files. Record
   the original source hashes in `apps/workbench/import-manifest.json`.
2. Run the imported offline backend regressions before adapting the application.
3. Add PRAXIS launch commands and product naming, keeping the imported workflow,
   explicit runtime trust, budget controls, exports, and apply confirmation.
4. Install the locked frontend and pinned backend in the new application folder.
5. Migrate this machine's credentials and job history into ignored local files.
   Rebase internal paths to the new application folder; keep the original project
   untouched. Do not reset model budgets or label imported jobs newly verified.
6. Run backend regressions, TypeScript checks, production build, launch checks,
   frontend/API smoke checks, core regressions, privacy guard, and package budget.

## Run from PRAXIS

```powershell
npm run dev
# Equivalent:
node src/cli.js workbench
```

Open `http://127.0.0.1:3000`. The Python API binds `127.0.0.1:9123`.
Both services run until Ctrl+C. Starting the workbench does not start a scan,
spend model tokens, or run a submitted project's commands.

```powershell
node src/cli.js workbench --check --json
npm run typecheck:workbench
npm run build:workbench
npm run test:workbench
npm run start:workbench
```

For a fresh checkout, install its separate dependencies first:

```powershell
npm ci --prefix apps/workbench
python -m venv apps/workbench/.venv
apps/workbench/.venv/Scripts/python.exe -m pip install -r apps/workbench/backend/requirements.txt
```

On macOS/Linux use `apps/workbench/.venv/bin/python`. Create
`apps/workbench/.env` from its `.env.example` or supply server-side environment
variables. Chromium is needed only for optional browser runtime checks.

## Preserved boundaries

- `praxis demo` remains the original offline signed-receipt demonstration.
  `praxis deck` remains the original Mission Control interface.
- Workbench scans send bounded, redacted excerpts to the selected model provider;
  GitHub intake and advisory checks can use the network. This is separate from
  PRAXIS's local evidence capture and offline signature verification.
- Repairs happen in copies. Runtime execution and applying changes retain their
  existing explicit confirmation gates. Host execution is not an OS sandbox.
- Workbench jobs retain their own evidence ledger. They are not silently converted
  into PRAXIS signed receipts or causal diagnoses. Any future bridge needs its
  own evidence contract and pressure tests.
- Existing CLI, receipt formats, hooks, memory files, history, and public website
  are preserved. No code was removed to accommodate the workbench.
- When reviewing a checkout identified by `package.json` as `praxis-memory`,
  snapshots and model context exclude its root `.praxis`, `.gstack`, `.obsidian`,
  `.agents`, `.claude`, `assets`, and personal `*Intelligence` directories. Public
  `src` and `docs` stay available. Other projects retain ordinary asset folders.
- The sample application's dependencies are separate; starting the workbench
  does not start Zentara or download its dependencies.

## Pressure-test gates

The imported regressions cover credential exclusion, path traversal, stale-source
rejection, concurrent model budgets, cancellations, partial repairs, exports,
trusted execution, and apply rollback. Live-provider tests remain explicit and
cost bounded. A successful frontend build or mocked provider regression is not
proof of real-provider accuracy or comprehensive project verification.

The pre-existing flow/eval findings from the earlier review remain separate work;
this import must not claim to repair or certify those modules.

## Import verification on this machine — 2026-09-18

- Core PRAXIS: 440 tests, 433 passed, zero failures, seven skips.
- Workbench backend: 81 tests, 80 passed, zero failures, one skip for unavailable
  Windows symlink creation. The imported baseline passed before adaptation.
- TypeScript and production build passed. Frontend npm audit reported zero
  vulnerabilities; the Python environment passed `pip check`.
- Browser/API smoke passed: settings, migrated repair display, no JavaScript
  errors, no homepage horizontal overflow at 320/390/768/1024/1440 pixels, and
  host/origin/JSON write guards. No model calls or source application occurred.
- Six existing jobs migrated with SQLite integrity and stored-path checks.
  Original demo source hashes remained unchanged.
- Core tarball: 3.53 MiB against a 3.55 MiB limit, including the self-contained PRAXIS Live demo.
  Core runtime dependencies remain zero. Privacy guard and diff whitespace
  checks passed; credentials, environments, caches, and local job data are ignored.

The import also reproduced and fixed private-directory inclusion for PRAXIS
scans and narrow-screen sidebar overflow. These checks do not certify live model
quality or change the status of previous review findings.

## Intake and agent compatibility verification — 2026-09-18

- Baseline backend passed before this change. Updated backend: 87 tests,
  86 passed, no failures, one Windows symlink skip.
- Updated core suite: 445 tests, 438 passed, no failures, seven skips. An
  additional end-to-end custom-agent selector test passed afterward; all six
  focused adapter tests passed.
- TypeScript and production build passed. Privacy and whitespace checks passed;
  the core tarball remains 2.86 MiB with zero runtime dependencies.
- A real Zentara HTTPS clone and isolated snapshot succeeded outside the
  restricted parent execution environment. The workbench was restarted with
  working network access. The original failed job is retained as historical
  evidence; it was not relabeled successful.
- Browser folder upload, credential/dependency exclusion, scan handoff,
  320/390/768/1440 pixel layout, and upload host/origin/JSON guards passed.
  Scan handoff was intercepted by the test to avoid a model call.
- Generic CLI task/stdin delivery, actual failure exit code, Windows launcher
  handling, mode validation, and Gemini/OpenCode output parsing passed.
- A Windows API source reload and cleanup reload both passed while the frontend
  stayed online. The API watcher excludes backend test files and restarts only
  its owned Python process tree instead of broadcasting console Ctrl+C.
- No model calls, submitted project execution, or source application occurred
  during these checks. Live Gemini/OpenCode authentication remains untested;
  those CLIs are not installed on this machine.
