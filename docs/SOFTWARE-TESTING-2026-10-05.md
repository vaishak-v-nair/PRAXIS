# PRAXIS software testing — 5 October 2026

The user paused video production and prioritized software testing. Video sources,
media, rejected exports and QA reports remain saved; the exact resume point is
in `videos/praxis-introduction/VIDEO-RESUME.md`. No new rendering, voice generation
or publication was started after that request.

## Defects reproduced and corrected

**Windows update timeout left npm running.** The first complete core run failed
while removing an update-test folder. The command's update assertions passed,
but Windows reported `EPERM` during cleanup. A controlled, offline standard npm
shim reproduced a child Node process surviving the registry timeout. A new test
failed on that behavior before the correction. Update now reuses the existing
agent-launcher resolver to invoke a standard shim's JavaScript entry directly.
The timeout reaches that actual process, and unavailable registry access still
returns an honest unknown. No dependency or receipt behavior changed.

**The read-only smoke test described an older UI.** Its old homepage heading,
connection label, model dialog and repair selectors no longer matched the real
interface. The old test failed against the running product before correction.
It now uses current accessible controls and explicitly rejects browser writes:
opening the page or Models must not start a scan, provider probe, execution or
source apply. The optional stored-repair branch remains available; no real repair
was fabricated to make it run.

The five browser smoke tools also accept an absolute
`PRAXIS_SMOKE_ARTIFACT_DIR`, retaining their existing default. This test run uses
a dedicated directory, so earlier reports and screenshots remain preserved.

## Results

| Check | Observed result |
| --- | --- |
| Full core regression after the fix | 555 tests: 548 passed, seven expected skips, zero failures |
| Focused update and launcher regressions | 19 passed; timed-out child does not remain alive |
| Workbench backend | 203 tests: 200 passed, three expected skips |
| Frontend units, TypeScript, production build | Ten units passed; typecheck and build passed |
| Workbench browser layout/accessibility | 17 states × two themes × five widths = 170 layouts; no axe, JavaScript or overflow failures |
| Synthetic UI action contracts | Nine passed; explicitly synthetic, not provider or runtime evidence |
| Real browser → API → Node host runtime | Correct project passed; broken project failed and stayed contradicted; original source unchanged, model cost zero |
| Real folder intake and GitHub clone | Credential/dependency exclusions, bounded upload, scan handoff and request guards passed; real clone contained 15 reviewable files |
| Large browser folder upload | 44,040,268 source bytes, 49 eligible files, eight batches, maximum encoded request 7,340,502 bytes; upload about 4.97 seconds |
| Large-source review and brief | Completed with 49 source files, preserved goal, bound clipboard text, unchanged originals, zero model cost and zero runtime checks |
| Public layout/release-state audit | 60 layouts, no axe/JavaScript/overflow failures; release-state response fixtures explicitly labeled |
| Live public browser trial | Five scenarios passed: broken source, clean source, clipboard denial, cancellation and engine hash mismatch; no source-upload requests |
| Promptfoo golden eval | Five expected outcomes; CONTRADICTED recall and precision both 1.0 against 1.0 baselines |
| Actual npm tarball/fresh install | Nine package smoke steps passed; no optional dependencies or private state created by install |
| Installed Verify and receipts | True and false claims distinguished in a real Git repo; both Ed25519 signatures checked; sealed demo receipt verified offline |
| Privacy/package budget | Privacy guard passed; 249 package files within the unchanged 3.55 MiB budget; zero CLI runtime dependencies |
| Dependency checks | Workbench production npm audit reported zero vulnerabilities; Python `pip check` passed |

The first detached test API process stopped during the test session. Those
connection failures were recorded, not converted to successful product results.
The browser suites were rerun against a persistent, supervised API. The isolated
API used a fresh data directory and an empty provider environment; Docker was
absent from its PATH. Original review history, provider settings and project
source were not migrated or applied. Failed runs and final successful reports
remain separately saved under the ignored software-testing artifact directory.

## Evidence boundaries

Passing Node behavioral tests yield `runtime_observed`, with production readiness
`not_established` without a task-specific user journey. Failed behavioral tests
yield `contradicted` and blocked readiness. The 42 MiB source-only review does
not claim executed behavior or release readiness. Host tests retain computer
and network permissions; the project copy is not an OS sandbox.

The live trial ran against `https://praxis-six-xi.vercel.app` using its real
WebAssembly scanner and file picker. Only the deliberate integrity-failure case
replaced the engine manifest response. Source contents remained in browser
memory; recorded network requests were GETs. A clear-source result says no
matches within the completed checks, not that a product works end to end.

The backend's three skips are two explicit Docker integration opt-ins and one
Windows symlink-capability limitation. Live paid-provider access/accuracy,
authenticated remote collaboration, arbitrary application stacks, exhaustive
security and production operation are not certified by this run. The stored
real-repair branch was unavailable in the fresh test history; synthetic UI and
backend regressions cover its controls separately. The periodic adversarial
provider pass was not run; verdict aggregation and blocking mode were unchanged.

## Reproduce without overwriting earlier evidence

From a prepared source checkout, start the production interface and API. Use an
isolated data/environment configuration for controlled fixtures. Set an absolute
artifact directory before running the browser tools:

```powershell
$env:PRAXIS_SMOKE_ARTIFACT_DIR = 'E:\your-tests\praxis-run'
npm test
npm run test:backend
npm run typecheck:workbench
npm run build:workbench
node --test apps/workbench/tools/agent-brief.test.mjs apps/workbench/tools/review-presentation.test.mjs
apps/workbench/.venv/Scripts/python.exe -B apps/workbench/tools/praxis_smoke.py
apps/workbench/.venv/Scripts/python.exe -B apps/workbench/tools/frontend_smoke.py
apps/workbench/.venv/Scripts/python.exe -B apps/workbench/tools/assessment_smoke.py --runtime host
apps/workbench/.venv/Scripts/python.exe -B apps/workbench/tools/intake_smoke.py --github
$env:PRAXIS_BROWSER_BASE = 'https://praxis-six-xi.vercel.app'
apps/workbench/.venv/Scripts/python.exe -B apps/workbench/tools/browser_review_smoke.py
npm run eval:verify
node scripts/ci/leak-guard.mjs
node scripts/ci/tarball-budget.mjs
node scripts/ci/pack-smoke.mjs
```

The host runtime command runs only these controlled test projects with explicit
trust. GitHub clone uses the existing Git installation/credentials. Runtime
authorization, provider budget, source freshness, rollback and apply gates remain
in place. npm publishing is a separate manual user action; no package was
published by this testing session.
