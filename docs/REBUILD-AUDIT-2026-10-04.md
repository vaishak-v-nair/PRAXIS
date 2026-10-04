# PRAXIS continuation audit — 4 October 2026

This is a quick architecture and contract pass across the current product, not a
claim to have manually reviewed every line or certified arbitrary submitted apps.
It combines source inspection with the actual regressions and controlled fixtures.

| Layer | Current responsibility | Important boundary |
| --- | --- | --- |
| `src`, `test` | Dependency-free CLI; memory, hooks, agents, Verify, receipts and tray | Optional app dependencies are never core runtime dependencies |
| Workbench backend | Intake, source copies, existing scanners, model adapters, execution, assessment and proposed repairs | Submitted projects are untrusted; source review never executes them |
| Workbench interface | Project/goal input, evidence, findings, collaboration, plans and source-bound agent brief | Source observations, model hypotheses and executed results remain distinct |
| Public website/trial | Product explanation, browser-memory source inspection and release-checked setup | No hosted review API, project runtime or server-side provider key |
| Packaging/startup | Managed private Python and versioned app; persistent data; health-checked opening | Node 22+ remains required; no automatic evidence or credential migration |
| Video project | Existing detailed walkthrough plus planned outcome-led launch cut | Demo fixtures are disclosed; recordings are evidence, animation is presentation |

The authoritative assessment remains Workbench `review.py`. Core Verify is a
separate claim/commit engine with its own Ed25519 receipt. Workbench reviews are
not automatically signed Verify receipts. MCP registration, client connection,
agent completion, passing tests and a signed record are distinct states.

## Findings and completed corrections

- The first review can use the existing source scanner without Docker or model
  credentials. Intake now requests that path by default; optional local/Docker
  execution has explicit consent. Missing Docker never triggers host execution.
- Initial host mode is wired through the backend input and dispatcher, with
  runtime provenance and preserved budget/trust checks.
- A real stripped-PATH install exposed reliance on PowerShell being on PATH.
  The installer now uses Windows' built-in executable at its absolute OS path.
- A real Node host review exposed double quoting of Windows npm batch launchers.
  The corrected restricted command line preserves arguments and failing exits,
  rejects shell operators and strips inherited provider credentials.
- Source-only LOW/suggestion findings need a presentation that explains pending
  confirmation rather than implying an observed runtime failure. Final interface
  validation passed; stored assessments and exports stay unchanged.
- Mobile metrics need to let users reach the finding and agent brief sooner.
  Final responsive validation passed in 170 layout/theme cases.
- The codebase map described Docker-only intake and an older setup route; it now
  documents source-first review, explicit host checks and the managed launcher.
- CLI help's unconditional “nothing leaves” claim was too broad for optional
  model/remote services; it now states those services are optional.

## Evidence already obtained

- Core: 553 tests, 546 passed, seven expected skips, no failures. A preceding
  overloaded run failed the descendant-timeout regression; its focused rerun
  and the complete subsequent suite passed. The test was not weakened or skipped.
- Backend after the Windows npm correction: 203 tests, 200 passed, three expected
  skips. Two Docker integration cases require explicit opt-in; Windows symlink
  capability accounts for the other skip.
- Real Python and Node fixtures distinguish correct behavior from false-success,
  using actual local HTTP reviews, unchanged original source and zero model cost.
  Passing tests remain `runtime_observed`, with production readiness unestablished
  absent task-specific user-journey evidence. Failing behavioral tests remain
  `contradicted` and blocked. Untrusted execution is rejected.
- Final frontend: ten brief/presentation tests, TypeScript/build and 170
  responsive/theme layouts passed with no axe or JavaScript failures. Nine
  synthetic action contracts are labeled as such. Fresh real browser/API host
  Node fixtures passed and failed as expected; source and model cost stayed unchanged.
  Four saved real SQLite reviews also passed 16 layouts and four bound brief copies.
- Public: 13 focused regressions, 60 layout/theme/state audits and five actual
  browser-scanner scenarios passed. The two mobile heading spaces passed 20
  rendered-heading checks and eight release-guard/clipboard checks.
- Promptfoo golden dataset: five expected outcomes; CONTRADICTED recall and
  precision both 1.0 against their 1.0 baselines. No verdict-aggregation change.
- Installed package: all nine smoke steps passed, including true/false Verify
  outcomes and offline Ed25519 receipt checks. Privacy guard and the unchanged
  3.55 MiB budget and nine installed-package smoke checks passed after refinements.
  The final core repeat again passed 546 tests with seven expected skips.
- The managed setup completed with Docker, Git, system Python and PowerShell
  absent from PATH. Latest-source installation and actual managed CLI startup
  passed: UI/API returned 200, source review completed, no configured providers,
  no Docker, no runtime checks or model cost, and no browser JavaScript errors.

The final package initially exceeded the unchanged budget by 3,617 bytes.
Removing 1,499 bytes of confirmed unused CSS and excluding checkout-only agent/CI
guidance from the npm payload restored the budget. The guidance remains in Git.
No feature, test assertion or package budget was removed or weakened.

## Finish in dependency order

1. Interface, latest managed startup and real Node host assessment are complete;
   their private proof artifacts remain local alongside earlier install evidence.
2. Run the final staged-source privacy gate; publish source only under existing push
   authorization. npm publishing remains manual and release copy stays guarded.
3. Record native 4K product actions after software validation, then produce and
   independently review the new short film. Preserve the old walkthrough.

## Practical limits

Trusted host tests retain file/network permissions; a source copy is not an OS
sandbox. The browser trial does not execute projects. Live model credits/quality,
arbitrary stacks, complete security coverage, authenticated remote collaboration
and production operation are not certified by these local tests. Node remains a
consumer prerequisite; signed desktop distribution is a separate future release.
