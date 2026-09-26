# ReGen

A local web app that reviews a project folder or GitHub repository, explains issues in plain English, and uses parallel coding agents to prepare reviewable fixes.

## Start

Requires Node.js 20.9+ and Python 3.11+; Git is required for GitHub intake and local review branches.

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. The API runs on localhost port **9123**; it is not exposed to your network. `npm start` starts the production app after `npm run build`.

Your existing `.env` is preserved. Supported keys are `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_NIM_KEY`, and `GROQ_API_KEY`. Never prefix credentials with `NEXT_PUBLIC_`.

Open **Model settings** in the top bar to choose a provider and model. Settings contain no credentials and are stored locally in `.regen/provider.json`. Explicit `REGEN_PROVIDER`, `REGEN_MODEL`, and pricing values in the environment override these settings. OpenRouter reads live model pricing; other providers require configured USD token prices. The UI accepts USD per million tokens. NVIDIA's free prototype endpoint can be configured with zero token prices; this estimate does not include subscriptions or private deployments.

This workspace is configured for the verified Groq `openai/gpt-oss-120b` model. The provided OpenRouter account returned HTTP 402, Gemini Pro returned HTTP 429, and NVIDIA Kimi timed out during setup verification. You can select a stronger model once its account access is available. No automatic model downgrade occurs.

## Workflow

1. Enter an absolute local folder path or `https://github.com/owner/repository`. Private repositories use your existing Git credential helper; configure access before scanning.
2. ReGen snapshots local uncommitted changes, excluding dependencies, generated files, symlinks, and credential files. Safe dotenv templates are preserved with detected values redacted. Static scanners run without executing the project. Relevant redacted source is sent to the selected AI provider; AI context is bounded, and omissions are reported.
3. Read findings, confidence labels, evidence, and coverage. Missing tools, unsupported dependency formats, and unavailable AI review are reported explicitly. Generic structure, suspected AI authorship, and legitimate fixtures are not automatically treated as confirmed defects.
4. Select issues and click **Instant fix**. Up to three specialists work in separate copies. The coordinator integrates changes, handles overlapping edits, and runs an independent model review.
5. Review the diff, optionally authorize runtime checks, and export the patch/project copy. A local snapshot-based Git review repository is created when Git is available; it has its own baseline rather than the original remote history. It is never pushed automatically.
6. **Apply to source** requires explicit confirmation, checks for source changes including `.env`, and retains original modified files in the job's `apply-backup` directory. GitHub projects use patch/project export instead.

Each job starts with a **$5 total model budget**, shared across scan review, parallel repairs, and review. Requests reserve a conservative maximum cost before dispatch. Explicit provider rejections are not charged to the app ledger; ambiguous timeouts reserve their maximum possible cost. Extend paused jobs through the UI. Actual provider invoices remain authoritative, particularly if configured pricing changes. Partial fixes remain exportable when the budget pauses.

## Coverage and Runtime Checks

Built-in inspection covers credential patterns, unsafe TLS configuration, broad CORS, debug settings, explicitly unfinished paths, raw HTML insertion, and permanently disabled controls. Language detection covers JavaScript/TypeScript, Python, Go, Java, Rust, C#, PHP, and Ruby. Dependency advisories currently support exact npm package-lock and Python requirements versions, with a 1,000-package limit. Additional unsupported manifests appear as coverage gaps.

Optional **Semgrep** and **Gitleaks** are detected from PATH. OSV receives only package names and versions. Semgrep's security rules may require network access. Static scans do not establish that a credential has leaked publicly or that an advisory is exploitable in a particular app.

Runtime checks execute locally under your user account, in the job copy. Authorize only projects you trust: removing inherited API keys does not sandbox code or prevent filesystem/network access. The confirmation lists dependency installation, test/build commands, and the web start command. npm installation disables lifecycle scripts; projects requiring them may need manual setup. Other language toolchains and project dependencies must already be available; missing ones are reported rather than silently installed globally.

For web checks, install Chromium:

```powershell
.venv\Scripts\python.exe -m playwright install chromium
```

Supply a start command serving **127.0.0.1:4173** when detection is insufficient. Browser checks cover homepage desktop/mobile overflow, JavaScript errors, failed requests, and basic button labels. They do not automatically exercise every route or business workflow. Credentials are omitted from snapshots, so projects requiring private service configuration can fail verification and require manual testing.

Scans are bounded to 10,000 files, 2 MiB per file, and 100 MiB total. Skipped large/binary files are not reviewed. Secret redaction is defensive pattern matching, not a proof that all sensitive content has been removed. Review source confidentiality before sending code to an external provider. Text exports are redacted; supported binary assets, including valid PDFs, are preserved byte for byte and are not inspected for embedded confidential content. Patches near credential-bearing lines may require manual application.

The repaired Zentara copy is in `repos/Zentara/`. Its README, engineering rules, pinned requirements, offline tests, and CI workflow describe its separate Streamlit setup. The upstream GitHub repository is unchanged. Pressure-test results are stored locally in `.regen/artifacts/`.

In this workspace, `.venv\Scripts\python.exe tools/run_zentara.py` starts the repaired app on `http://127.0.0.1:4175` using the existing root keys, without creating another `.env`. Its clean tested environment is `repos/Zentara/.venv-secure`; all runtime tools prefer it when present.

## Verification

```powershell
npm run typecheck
npm run build
npm run test:backend
npm audit
```

Offline tests cover source/credential preservation, stale-source rejection, API guards, trusted execution, cancellation, concurrent budgets, partial fixes, exports, and apply rollback. `tools/smoke_provider.py` optionally verifies real provider access using a $0.20 maximum test budget. Job data and backups are stored in `.regen/`, which is ignored by Git.

To choose a different API port, set `REGEN_BACKEND_PORT` and matching `REGEN_BACKEND_URL` before starting both services. Frontend write origins are restricted to local port 3000.
