# Public website builds on Vercel

The `praxis` Vercel project serves `https://praxis-six-xi.vercel.app/`.
The repository-root configuration runs `npm run build:site` and serves the
curated output in `apps/workbench/.regen/artifacts/public-site`. The existing
project may remain rooted in `web`: its `web/vercel.json` runs the same canonical
builders and stages that output in a guarded, ignored `web/dist` directory.
This requires source files outside the root directory to be available at build
time. Both configurations need Node only, with no dependency installation.

Do not deploy raw `web` from Git without the build. Scanner modules, their hash
manifest and the local-release metadata are intentionally generated and excluded
from Git. A raw-directory deployment can show a healthy landing page while
`/test-your-project/engine/manifest.json` returns 404 and inspection fails.

The build copies the existing canonical scanner, reality checks and browser
adapter. It does not install Workbench dependencies, start Python, use provider
keys, upload submitted projects or expose the local API. Only curated static
website files become deployment output. Generated build directories stay ignored.

After a Git deployment is READY, check the homepage and scanner manifest, then
run the real browser smoke:

```powershell
$env:PRAXIS_BROWSER_BASE='https://praxis-six-xi.vercel.app'
apps/workbench/.venv/Scripts/python.exe apps/workbench/tools/browser_review_smoke.py
```

This exercises broken and clean source, clipboard denial, cancellation and an
engine-integrity failure. A green deployment status alone is insufficient.
The public browser trial remains source-only: it does not execute project code
or certify production readiness.
