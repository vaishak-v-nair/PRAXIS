# PRAXIS Workbench

The complete local project-review and repair application imported from
`E:\BrosKi\demo`, now run from the PRAXIS repository. The frontend, API, scanner,
model adapters, shared budget, isolated repair workers, exports, and source-apply
workflow are preserved. Python module names remain `regen` for compatibility.
The original guide is retained in [README.upstream.md](README.upstream.md), and
the original source hashes are recorded in `import-manifest.json`.

## Run

From the PRAXIS repository root:

```powershell
.\start.ps1          # Windows: prepare Node/Python dependencies and launch
npm run dev
node src/cli.js workbench --check --json
```

The interface is `http://127.0.0.1:3000`; the API binds `127.0.0.1:9123`.
Use Ctrl+C to stop. The complete setup and directory plan is in
[WORKBENCH-INTEGRATION.md](../../docs/WORKBENCH-INTEGRATION.md).

## Workflow

1. Choose a provider in Model settings. Keys stay server-side in this app's
   ignored `.env` or environment variables; configuration lives in `.regen/provider.json`.
2. Submit a local absolute folder, GitHub repository, or folder upload. The
   complete review inspects a bounded snapshot, sends redacted context to
   configured providers under a shared budget, and runs authorized Docker
   commands. Missing tools, failed calls, and incomplete coverage remain visible.
3. Select findings and draft a source-aware fix plan. Confirm model handoff or
   copy the plan to your coding agent. Specialists prepare edits in separate
   copies; the coordinator integrates changes and independently reviews them.
4. Inspect diffs and export a patch or project copy. Browser runtime checks use
   the bounded Node/Python Docker runner, with networking independently opt-in.
   Legacy trusted-host API execution remains explicit and is not an OS sandbox.
5. Apply to local source only after explicit confirmation, freshness checks,
   backups, and rollback protection. GitHub intake uses exports instead. Nothing
   is pushed automatically.

The default model budget is $5 per job. Starting services does not initiate
scans or model calls. Existing imported provider settings are retained; this
integration does not certify provider account access or model quality.

## Check

```powershell
npm run typecheck:workbench
npm run build:workbench
npm run test:workbench
```

Run these from the PRAXIS root. Core PRAXIS tests still use `npm test`.
The imported offline backend tests cover budgets, cancellation, path and credential
boundaries, partial repairs, exports, stale source, and apply rollback. Optional
live-provider tools retain their explicit cost caps and are not run automatically.

Machine-local history, copies, credentials, and backups remain under ignored
`.regen` and `.env`. Imported historical reports remain historical observations.
The imported Zentara sample source is in `repos/Zentara`; its environment and
toolchain are separate. See its own README before running it.

Workbench evidence remains separate from PRAXIS's signed receipts. The original
`praxis demo`, `praxis deck`, memory, hooks, tray, and verification behavior remain
available. Optional Workbench source ships in the npm tarball; its dependencies,
Python environment, generated builds, backend tests, sample repository, and
private runtime state do not. The core CLI never imports Workbench dependencies.
