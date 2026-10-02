# PRAXIS installed local product test plan

Date: 2026-10-01. Generated during plan-eng-review, branch main.
Targets: Windows x64, macOS ARM64/x64, Linux x64 on explicitly supported baselines.
Status: requirements only; new desktop integration is not built or tested yet.

## Pages and surfaces

- Public landing hero: command copy and Test Your Project navigation.
- Public installation page: real source instructions or actual published artifacts; no project intake or API-key form.
- Local home: project selection, model scope/budget, trust, network permission, and review start.
- Local review: findings, checks, limits, source references, repair plan, and patch review.
- Local history and settings: reopen same job; credentials unavailable; empty and large history.
- Desktop window and tray: native picker, selected project, current activity, Open in browser, close, quit, and reconnect.
- CLI and MCP: diagnosis, supported client versions, project scope, read access, explicit action authorization.
- Native installers/updaters: clean install, repair, upgrade, failed upgrade, and uninstall retaining data.

## Critical end-to-end paths

1. Install on each target without globally installed Node/Python, open the local app, select a real project, and complete the supported source-review scope.
2. With Docker available and explicit runtime trust, run a passing fixture and a deliberately broken fixture through the real backend. Desktop and browser show the same job/snapshot, checks, costs and evidence limits.
3. Select findings, draft a plan, review the plan, and perform an explicit supported agent handoff or manual copy. Confirm no source write occurred merely by planning.
4. Review a patch, change the original source externally, and confirm stale apply is rejected. Check authorized fresh apply backup/recovery separately.
5. Start from desktop, open the browser, invoke the CLI, and launch again. Confirm ownership is shared or a clear incompatibility is shown; no duplicated workers, contradictory state, or unrelated-process termination.
6. Close/reopen a window during a job. Test intentional quit and abrupt crash separately. Evidence survives; interrupted work never becomes successful.
7. Install a signed update with intact local history and memory. Reject tampered/unsigned metadata. Test interruption and incompatible data-schema recovery with a known backup.
8. Use project-scoped MCP read tools; malicious requests cannot approve spending, execution, repairs, or source apply. Supported old clients remain usable; unsupported versions are explicitly rejected.

## Edge and error cases

- Occupied ports; stale service records; expired bootstrap; wrong user/instance; wrong protocol; simultaneous starts.
- Read-only installation directory; Unicode/long paths; moved or unavailable project; symlink/traversal uploads; credentials and dependencies excluded.
- Docker absent, stopped, incompatible container mode, or missing image; no silent host-execution fallback.
- No provider key, expired/rate-limited provider, timeout, unknown billing, unsupported structured output, cancelled review, exhausted budget.
- Locked/missing OS credential store; key never present in renderer, errors, diagnostics, logs, bundles, or test fixtures.
- API unavailable/restarted; event reconnect; stale/out-of-order revisions; multiple windows; rapid clicks; zero and large history.
- Linux with no tray support; X11/Wayland; minimum glibc baseline; WebKitGTK assets and certificate behavior.
- Windows missing WebView2; non-admin install; Windows security prompts and verified signed artifacts.
- macOS downloaded artifact under Gatekeeper; notarization; ARM/Intel matching sidecars; locked Keychain.
- Light/dark theme, keyboard-only interaction, reduced motion, contrast, small windows, and no-WebGL file navigation.
- Public clipboard denied or unavailable: visible manual copy guidance, never false Copied status.
- No new public-site project-data requests, automatic localhost probes, provider calls, or misleading installer links.

## Test boundaries and release evidence

Keep current core Node tests, Python unittest regressions, and Playwright/axe
browser checks. Native desktop tests must use the real shell and services for
acceptance. Evaluate Tauri's vendor-documented embedded WebDriver route on all
three OS families; keep test plugins out of production builds. API/IPC mocks
can test presentation, but cannot substitute for the paths above.

Run native smoke on the exact signed release artifact and record its hash,
OS/CPU, fixture, observed behavior, limits, and result. A successful compile or
headless runner is not a substitute for native picker, tray, credential store,
or window lifecycle checks. Inspect the production artifact for absence of a
test driver, credentials, project history, confidential assets, and dev servers.

Preserve existing receipts/fixtures. Run relevant core/backend/build/privacy/
package-size gates. Extraction, verifier, tool-prompt, or aggregation changes
require applicable golden and adversarial evals; signature validity remains
distinct from correctness. Do not claim production readiness from fixture tests.

First public launch requires passing artifacts for Windows, macOS, and Linux;
no one-platform release is silently substituted for the accepted scope.
