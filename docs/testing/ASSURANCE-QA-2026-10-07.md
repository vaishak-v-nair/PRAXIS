# PRAXIS assurance acceptance record

Date: 2026-10-07. Scope: the Windows checkout at the assurance implementation
checkpoint, before commit, publication or deployment. The subsequent
[source and integration audit](INTEGRATION-AUDIT-2026-10-07.md) records newer
fixes, regression counts and the need to refresh the frozen desktop bundle.
These checkpoint results do not establish a signed public desktop release
or live authorization for every external provider.

## Implemented behavior

- One authenticated local service is shared by compatible CLI, browser and
  desktop clients. Incompatible engines and unrelated listeners are rejected.
- Structured browser steps can observe UI behavior and independently read
  selected API fields before, after and again after actions. A success message
  with unchanged backend state does not establish a complete user journey.
- Project identities, selected team context, assignments, decisions and
  handoffs persist locally. Original-source freshness and review-copy freshness
  remain separate. Completion reports do not become verification evidence.
- Vendor-maintained MCP observations are scoped, bounded, redacted and
  supplementary. Registration or configuration does not establish access.
- Desktop development delivery bundles the same Workbench UI, Python engine
  and Node runtime. It preserves the existing CLI, memory, hooks and receipts.

## Automated results

| Check | Result | Scope |
| --- | --- | --- |
| Full core regression suite | 571 passed, 7 skipped, 0 failed; 578 total | Existing commands, receipts and new service/status/evidence contracts |
| Existing coverage floor | Passed: line 81.94%, branch 74.61%, functions 85.13% | Windows run; existing Linux-calibrated floors 80/72/85 unchanged |
| Full Python backend suite | 288 passed, 3 skipped, 0 failed; 291 total | Review, provider, runtime trust, source apply, journeys and coordination |
| Independent pressure tests | Python 8/8 and Node 6/6 | Stale readiness, original-source drift, empty MCP responses and browser port ownership |
| Frontend TypeScript and production build | Passed | Real Workbench application |
| Rendered assurance workflow | Passed | Real production UI and authenticated backend; two temporary source projects |
| Promptfoo golden dataset | 5/5; CONTRADICTED recall 1.0 and precision 1.0 | Deterministic verifier cases, not a live extraction-provider benchmark |
| Installed npm tarball | 9/9 | Fresh install, real Git true/false cases, Ed25519 checks, zero-account local fallback, Live and replay |
| Package size and privacy | 261 files; 3.73 MiB within 3.75 MiB | Actual packed contents, including new unstaged source modules |
| Root production dependency audit | 0 vulnerabilities | Dependency-free CLI |
| Full Workbench dependency audit | 0 vulnerabilities | Production and development Node dependencies |
| Desktop packaging and release guards | 14/14 passed | Private files, stale resources, links, artifact changes and forged signature metadata |
| Native Rust regressions | 5/5 passed | Control/navigation and Windows disk/Unicode UNC path handling |

Skips remain explicitly recorded by the suites. Historical job records stayed
byte-for-byte unchanged in the independent pressure test; existing receipt
regressions and installed receipt validation passed. No paid model request or
user-project execution was used by these acceptance fixtures.

The rendered test drives intake, a shared assignment, a private decision,
explicit runtime consent, structured steps, and a real file-backed state
change. Its false-success fixture displays success while leaving state
unchanged. The engine records that failure and withholds full-journey readiness.
CLI and MCP status report the same two local projects. The test checks 1280px
and 390px layouts and captures screenshots; it found no horizontal overflow or
browser errors in its inspected scope.

Additional authenticated status regressions check real CLI/MCP parity,
private-field exclusion, partial collections containing mismatched or oversized
responses, and unknown activity refusing idle shutdown. The desktop workflow
uses the existing CI test runner and concurrency cap.

Repeat the rendered test with `npm run test:assurance`. It prints an isolated
temporary QA directory containing screenshots and sanitized status/results.
The private service descriptor, job store and provider environment are not CI
artifacts. Do not publish a whole QA directory.

## Dependency changes and residual finding

Workbench now uses patched `sharp@0.35.5`, `source-map-js@1.2.2`, and the
targeted `concurrently -> shell-quote@1.11.0` override. Evaluation tooling uses
`promptfoo@0.124.0` and a targeted `get-uri -> basic-ftp@6.2.2` override. The
FTP client's consumed API loads successfully; the golden suite passes with the
updated tree. Version 6 also rejects separate transfer hosts by default
([vendor release](https://github.com/patrickjuchli/basic-ftp/releases/tag/v6.0.0)).

The full root development audit still fails with three high package entries
from one chain, `promptfoo -> jks-js -> node-forge@1.4.0`. The upstream
[issue](https://github.com/digitalbazaar/forge/issues/1149) and
[proposed fix](https://github.com/digitalbazaar/forge/pull/1152) remain open.
No advisory is suppressed and no replacement crypto stub is introduced.
This tree is not shipped with the CLI or desktop Workbench runtime. Receipt
signing uses `node:crypto` Ed25519, not forge. This scope distinction does not
erase the development-tooling finding.

## Native acceptance on this Windows computer

The patched frozen runtime contains 265,161,118 bytes and has managed engine ID
`8a3b8d2ef845330cf47ad93027ff9160af6808b0cba749b0924ede238b608c35`.
Its real runtime smoke passed with globally installed Node and Python removed
from the process PATH. It observed authenticated startup, a real source review,
snapshot-bound project/status, the bundled official MCP bridge and owned idle
shutdown. Unsupported production readiness remained explicitly unsupported.

The real Windows Tauri process smoke also passed: duplicate launch reused the
first instance, the protected API reviewed source, original-source drift stayed
stale, native control-pipe loss stopped owned services, and a saved review
survived restart. The final repeat used the resources bundled beside the native
executable, with no runtime/Node override and no global Node/Python PATH. It
passed at 2026-10-07T06:35:10.537Z. This is development-shell process/API
acceptance, not signed-installer clean-machine acceptance.

Bundled testing caught and verified fixes for stale copied files and Windows
verbatim resource paths that Node could not load. Build tooling safely resets
only generated copied runtimes, repopulates them on incremental Cargo builds,
and validates them before and after bundling. Native paths preserve the same
absolute disk/UNC location; unsupported device paths are rejected. Release
testing also reproduced the unsigned-file metadata bypass. The public gate now
checks actual Windows Authenticode signatures and rejects foreign signature
claims it cannot independently verify. A real vendor-signed Node binary passed
the signature check; the unsigned PRAXIS installer did not.

Final local development installer:
`apps/desktop/src-tauri/target/debug/bundle/nsis/PRAXIS_0.14.2_x64-setup.exe`.
Size: 286,636,812 bytes (273.36 MiB). SHA-256:
`ecbf26859e5b8f416a91ab2d3e59afbeee810107d121596719f29bbba1eb2e1a`.
Its actual signature is `NotSigned`; installer installation was not run.
The accepted native executable hash is
`05511312a18078bf651753c059cf8a31ab22067ae90178cc357238eed7f65acb`.

Ignored local reports are `apps/desktop/artifacts/runtime-smoke.json`,
`apps/desktop/artifacts/native-smoke-bundled.json` and
`apps/desktop/artifacts/development-artifact.json`. Native UI interaction,
installer acceptance and public-release requirements below remain open.

## Remaining external release gates

- Windows code signing, macOS signing/notarization, and exact-artifact clean
  installation on every supported OS remain required for public desktop links.
- Independent cross-platform signature/notarization attestations are not yet
  implemented. The aggregate public release gate stays closed rather than
  trusting claimed signature fields from a JSON record.
- Native folder-picker, tray and window-close interactions need their recorded
  manual acceptance in addition to process/API automation. OS-keychain storage
  and signed updates remain release obligations.
- Official MCP vendor authentication and deployment/commit binding require
  real connected accounts. No live access is implied by adapter tests.
- Agent leases are tested backend primitives. An installed-agent execution
  adapter is not delivered; the current model review and selected human context
  are the working team integration.
- Remote required-check settings and signed release credentials have not been
  configured here. Workflow files emit checks; they do not set branch protection.
- Hosted adversarial red-team execution remains a separate periodic gate and
  must pass before blocking mode or verifier-aggregation changes. Comment-only
  mode remains the default.

Use the [project review quickstart](../PROJECT-REVIEW-QUICKSTART.md) for the
working local workflow, [desktop delivery](../../apps/desktop/README.md) for
native artifacts, and [manual release guide](../MANUAL-NPM-RELEASE.md) for the
separate publication steps.
