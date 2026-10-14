# PRAXIS incomplete-work checkpoint

Date: 2026-10-08, Asia/Calcutta. This follows the
[2026-10-07 integration audit](INTEGRATION-AUDIT-2026-10-07.md).
The changes and deployments below were made after that audit. Its older
deployment and dispatch gaps are historical observations, not the current state.

## Installed coding-agent workflow

Workbench now discovers installed coding-agent CLIs and connects an explicitly
assigned task to the existing PRAXIS agent adapters. Assignment and shared
context alone do not launch a process. The user must separately authorize local
execution and spending through the agent's own account. That account's charges
are outside the Workbench model-review budget.

The foreground operation is plan-only. It uses a disposable source copy, excludes
credentials and project agent-startup configuration, and reuses the existing
bounded source-context retrieval. The UI reports included, omitted and clipped
source coverage. Selected shared context is bounded; private notes are excluded.
Existing source fingerprints, task prerequisites, revision checks, leases,
timeouts, cancellation and output limits remain enforced. A changed copy,
stale assignment, missing output or unsuccessful process cannot become a
completed agent plan. Runtime trust is explicit: host execution is not an OS
security sandbox.

An accepted plan remains `verification: not_evaluated`. It is neither an applied
repair nor a signed verification receipt. Independent checks and confirmed source
apply keep their existing paths. Existing hooks, memory, receipt formats, CLI
commands and tray features remain in place.

The shared adapter, discovery and foreground modules are copied through an
allowlist into managed and frozen installations. No runtime dependency was added
to the core CLI. Backend, rendered UI and frozen-runtime tests exercise the actual
assignment → consent → API → Node bridge → subprocess → recorded-result path.

## Privacy correction

The Git privacy guard previously missed generic `.regen` state and environment
credential files. Two regressions reproduced that gap before the fix. The guard
now rejects those paths at any directory depth, including on the confidential
branch, while permitting the explicit `.env.example` template. The root ignore
file also excludes `.regen` directories. The files were preserved; no state or
credential migration, deletion or upload occurred. The actual Git index remains
clean under the guard.

## Validation

| Check | Latest completed result |
| --- | --- |
| Full core regression suite | 591 total: 584 passed, 7 optional skips, 0 failed; includes both new privacy regressions |
| Full Python backend suite | 305 total: 302 passed, 3 skipped, 0 failed |
| Shared agent and staged-install regressions | 28/28 passed |
| Privacy guard regressions and current index | 27/27 CI-script tests; 543 tracked paths passed |
| Workbench TypeScript and production build | Passed |
| Rendered authenticated Workbench | Passed, including actual agent-plan execution, separate consents, private-note exclusion and responsive layout |
| Promptfoo golden dataset | 5/5; CONTRADICTED recall 1.0 and precision 1.0 |
| Fresh installed npm package | 9/9, including real Git VERIFIED/CONTRADICTED cases and both Ed25519 signatures |
| Desktop pressure and packaging regressions | 14/14 passed |
| Refreshed frozen runtime | Passed with bundled Node/Python and no global runtime PATH; actual agent-plan API exercised |
| Actual bundled Windows native shell | Passed: duplicate launch, private session, real source review, stale-source detection, owned crash shutdown and saved-state restart |
| Package metadata and budget | 265 files; within the existing 3.75 MiB unpacked limit; zero core runtime dependencies |
| Whitespace validation | `git diff --check` passed |

The package budget was preserved by lossless CSS whitespace compaction, not by
raising its limit or removing existing features. Passing tests establish the
tested cases and contracts, not comprehensive security or production readiness.

## Public sites and required CI gate

Both [Vercel](https://praxis-six-xi.vercel.app/) and
[Cloudflare](https://praxis.vaishak-v-nair-dev.workers.dev/) were updated from an
allowlisted public static build. Each deployed scanner hash matches the canonical
source used for that build. Each site passed five real browser scenarios:
broken source, clean source, denied clipboard access, cancellation and engine-hash
mismatch. Both runs recorded zero axe violations, zero JavaScript errors and zero
project-source upload requests. Browser review remains source inspection; it does
not claim that the uploaded project's runtime works.

Cloudflare production is public. Its existing Access application was changed to
protect preview deployments, retaining the existing policy. The worker account
subdomain is unchanged. Vercel received prebuilt public assets only; local jobs,
credentials and private QA artifacts were not deployed.

GitHub `main` now requires the actual Actions check named
`Verify golden dataset · CONTRADICTED recall and precision`, with strict
up-to-date checks and GitHub Actions app ID 15368. The policy was read back after
configuration. Administrator enforcement remains false. This repository's CI
protection is separate from the product's per-repository merge gate, which remains
comment-only by default. Both golden metrics retain a 1.0 baseline.

The existing hosted periodic red-team workflow most recently succeeded on
2026-10-05, run 37296746913. It was not rerun against this uncommitted checkout;
that historical run is not evidence for new source. This checkpoint did not
change the verdict aggregator or enable blocking mode on a product repository.

## Live integrations: observed results and limits

| Integration | Observed result |
| --- | --- |
| Groq `openai/gpt-oss-20b` | Two bounded JSON calls succeeded; median 2.242 seconds. Existing selected provider was preserved. |
| NVIDIA NIM `openai/gpt-oss-20b` | Two bounded JSON calls succeeded; median 3.1605 seconds. |
| Configured OpenRouter model | HTTP 402 balance error; no successful response substituted. |
| Configured Gemini model | HTTP 429 after bounded retries; remains unavailable for that probe. |
| Real installed Codex | Built-in read-only adapter completed a source-grounded plan in 93.23 seconds; original and disposable copy unchanged; verification not evaluated. |
| Real installed Claude | OAuth authentication exists, but three bounded headless plan probes timed out, including a minimal startup probe. No working Claude plan is claimed. |
| Official GitHub MCP | Authenticated read-only file retrieval succeeded using existing GitHub authentication. Project MCP tokens were not copied or persisted. |
| Official Microsoft Playwright MCP | Temporary isolated server drove the public site and observed its accessibility tree. The owned server was stopped afterward. |
| Official Sentry / Supabase MCP | Registration and failure-contract tests exist; live account evidence still needs vendor authentication and the relevant organization/issue or project scope. |

These model probes establish access to small requests, not general coding
accuracy. Gemini CLI and OpenCode are not installed on this machine. Custom
per-mode argument adapters remain supported; installation detection does not
prove account authentication. No community evidence server was added.

## Windows development installer and public-release limits

The refreshed frozen runtime/source ID is
`72b48b9845906a252b3fa3b2c681afebe9fe17726672c01d38630eac37bf330d`.
The current bundled native acceptance record is
`apps/desktop/artifacts/native-smoke-bundled.json`, not the retained historical
`native-smoke.json`.

The NSIS development installer was built at
`apps/desktop/src-tauri/target/debug/bundle/nsis/PRAXIS_0.14.2_x64-setup.exe`
(273.36 MiB). SHA-256:
`2B81143B02B3891CC7353DF8B88B2EA4424565EF662423A71809DF3963F535D8`.
It is unsigned. An earlier default MSI build failed in WiX; the subsequent
explicit NSIS build succeeded. MSI delivery is not claimed.

Public desktop delivery still requires signed clean-machine installation,
manual native picker/tray/close/quit acceptance, macOS/Linux acceptance and
independent signature/notarization evidence. OS-keychain storage and signed
automatic updating remain unimplemented release obligations. The public release
gate remains closed; compile and smoke success do not override it. See
[the desktop release contract](../../apps/desktop/README.md#release-status).

## Reproduction and retained evidence

Run the existing commands in the integration audit. For the final core pass on
this loaded Windows machine, use `CI=1` with
`node scripts/ci/run-tests.mjs`. For the Windows development installer use
`npm --prefix apps/desktop run build -- --debug --bundles nsis`, then
`npm --prefix apps/desktop run smoke:native -- --bundled`.

Ignored local logs are under `apps/workbench/.regen/artifacts/`, including
`completion-core-final.log`, `completion-backend.log`, `completion-build.log`,
`completion-golden.log`, `completion-pack-smoke.log`, `completion-rendered-ui.log`,
`completion-cloudflare-browser.log`, `completion-vercel-browser.log`,
`completion-desktop-build.log` and `completion-desktop-runtime.log`.
The final rendered QA retained its screenshots and sanitized results at
`C:\Users\vaish\AppData\Local\Temp\praxis-assurance-qa-HAqh2a`.
Never publish the entire QA directory, service descriptor, model settings or job
store.

No source commit or push was performed for this checkpoint. Npm publication
remains manual and was not performed. The external account and desktop-release
limits above are still open; they were not replaced with dummy success states.
