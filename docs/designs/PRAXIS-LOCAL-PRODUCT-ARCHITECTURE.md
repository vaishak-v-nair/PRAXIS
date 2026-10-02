# PRAXIS local product architecture

Date: 2026-10-01. Checkout: PRAXIS, branch `main`, observed HEAD `77288c7`.
Status: implementation plan with packaging and release feasibility gates;
not implemented or certified on target machines.

## Accepted product decision

The user selected BOTH distribution routes: an installed desktop application
and the existing local browser application, with the CLI preserved. These are
entry points into one product, not separate review engines. Address the drawbacks
of both routes rather than hiding them behind a new interface.

The official website is https://praxis-six-xi.vercel.app. It is a public
information, installation, and release surface. Projects are selected, copied,
reviewed, and stored locally. The public website must not collect project folders,
repository credentials, provider keys, conversations, or review history.

The desktop application is the intended everyday entry point. Browser access
remains a supported interface to the same running local workspace. CLI commands,
hooks, memory, legacy tray behavior, and receipt formats remain compatible.

D1 accepted: desktop + local browser + CLI. D2 accepted: Windows, macOS, and
Linux desktop artifacts in the first public release. Do not silently reduce
this to a Windows-only launch. Sequence engineering work, then hold the public
release until every advertised platform passes its release gates.

Local storage does not mean every operation is offline: GitHub downloads,
dependency/advisory queries, model requests, and opted-in update checks can use
the network. Disclose the destination and purpose. Model requests send bounded,
redacted source context only after the user's chosen review action.

## Product and operating strategy

| Responsibility | Decision and launch criterion |
| --- | --- |
| CEO | Lead with the developer's job: check AI-built software and prepare a useful fix plan. Start with individual developers and small engineering teams. Validate repeat use and useful findings with consenting beta users; do not assume fundraising, virality, or demand from architecture alone. |
| CTO | One review engine, one UI codebase, one service owner per local workspace. Add packaging and adapters around current behavior. No engine rewrite or parallel desktop verdict logic. |
| COO | Reproducible builds, install/upgrade/repair/uninstall procedures, diagnostics without secrets, supported OS matrix, signed artifacts, and recoverable updates are release deliverables. |
| CAIO | Route models by measured task performance, availability, cost, and explicit budgets. Preserve deterministic evidence decisions. No advertised intelligence multiplier, inferred credit balance, or silent fallback presented as the selected model. |
| Chief product designer | One coherent project workspace across desktop and browser; familiar mascot and restrained motion; plain-language findings and next actions; visible limits and consent. Installation must not require understanding MCP. |

Business validation is local-first: interview opt-in users about their last failed
AI-built project, watch installation and first review, and ask whether the fix
plan helped. No analytics are required for the tool to operate. Optional local
diagnostics and explicitly consented beta feedback measure installation success,
time to first useful finding, completed/partial reviews, actionable findings,
repeat use, and recovery from failures. Establish baselines before setting
conversion targets or pricing. Provider usage is billed by the user's provider;
do not imply that an agent subscription includes arbitrary API usage.

## Current implementation and reuse

See [Product map](../PRODUCT-MAP.md), [Workbench integration](../WORKBENCH-INTEGRATION.md),
and [Agent workflow](../AGENT-WORKFLOW.md).

| Existing code | Reuse and current limit |
| --- | --- |
| `apps/workbench/app`, `components`, `lib` | Main interface and API state; retain findings, execution, repair planning, guarded apply, history, themes, and source navigation. |
| `backend/regen/scanner.py`, `reality.py`, `harness.py`, `review.py` | Current inspection, runtime evidence, and deterministic assessment; models do not replace their decisions. |
| `backend/regen/provider.py` | Existing direct provider calls and budgets. Keep task-specific evaluation separate from latency measurement. |
| `backend/regen/sandbox.py` | Existing Docker isolation. Missing Docker or failed dependency setup leaves runtime evidence unavailable, never fabricated. |
| `src/commands/workbench.js`, `src/lib/workbench.js` | Current optional-app readiness and launch contract; source installs remain usable. |
| `src/tray`, `src/lib/tray-state.js` | Existing Windows/macOS hosts and mascot. Session/memory state does not currently establish Workbench progress. Windows has a separate state computation that needs parity coverage. |
| `src/lib/agent-connect.js`, `src/lib/jobs/adapters.js` | Existing safe agent discovery and handoff. Installed, configured, connected, transcript-supported, and authenticated are different states. |
| `src/lib/mcp` | Current stdio server and four memory/receipt tools; not yet a Workbench review API. Preserve tool names and semantics. |
| `.praxis` and Workbench `.regen` | Existing separate private stores; connect through identifiers without automatic migration or merging. |
| Public `docs/tray`, `web/_assets`, app mascot | Curated brand assets. Confidential `assets/` remains excluded from public artifacts. |

The focused discovery audit passed 52 existing tray, MCP, agent-linking, and
Workbench tests. It does not certify a desktop installer, new bridge, or a
cross-platform release. Wider previous validation is recorded in Product map;
it was not rerun as part of this planning document.

## Architecture and trust boundaries

```text
PUBLIC INTERNET
  Official website -> install guide / published release artifacts
  No project intake, review API, or uploaded-project storage
                         |
                    explicit installation
                         v
USER'S MACHINE
  Desktop window ----+
  Browser window ----+--> same local UI --> existing review API --> job store
  Tray + mascot -----+          |                  |
                                |             existing engine
  Coding agent --> stdio MCP ---+                  /       \
  Supported hooks --> core memory             providers   Docker
  CLI -------------> diagnostics/launch             |       |
                                                bounded   authorized
                                                excerpts  snapshot

  New integration: project/job references + sanitized revisioned status
  Existing stores: .praxis stays private; .regen retains review evidence
```

MCP is an optional machine interface for a coding agent. It is not the desktop
application, website, storage layer, or an entitlement to execute project code.
Browser and desktop users can complete a review without configuring MCP.

The local service owner starts and supervises the existing Node UI server and
Python API. Desktop and browser attach to that workspace, rather than starting
duplicate engines or copying databases. The supervisor exposes only narrowly
defined lifecycle actions; the renderer cannot execute arbitrary shell commands.

Keep browser requests same-origin through the local UI server. Retain current
Host/Origin/content-type guards. For packaged service reuse, require a per-user
private endpoint record, instance identity, protocol version, and authenticated
service handshake. Loopback alone is not authorization. Do not pass a reusable
token in a website URL, browser history, logs, or readable public config. Define
a one-time local browser bootstrap exchange and a protected session before
adding privileged cross-surface actions. MCP clients remain project-scoped and
use the same action authorization, budget, and source-freshness checks.

Port selection and API proxying must be consistent: prefer the existing ports
when free, but never kill an unrelated listener. A runtime endpoint descriptor
and runtime-configured local proxy are necessary before alternate ports work;
the current Next rewrite must not be assumed to adapt automatically. An existing
development server can coexist, but sharing mutable job state requires a proven
single-writer ownership contract. Do not attach solely because a port responds.

## Desktop packaging approach

A thin Tauri 2 shell is the researched candidate, not a shipped capability.
Use its standard tray, single-instance, scoped command, installer, and updater
facilities. Keep desktop dependencies in an optional `apps/desktop` package;
the core CLI retains zero runtime dependencies and its existing package budget.

Package the existing Next UI as a production standalone server with its static
and public assets included. Bundle a compatible Node runtime and a Python
backend bundle, initially using a one-directory packaging candidate. Validate
Python dynamic imports, data files, certificates, and real provider HTTP behavior
in the installed artifact. Do not switch the UI to a static export that removes
the current API proxy contract merely to fit a desktop template.

Tauri's small shell does not make this whole application a tiny download: Node,
Python, assets, and the backend contribute to its actual size. Measure the complete
artifact and startup resources in a clean machine test. Compare the candidate
against Electron only if real WebView/UI compatibility or sidecar lifecycle
failures justify it. No second production UI or competing installer tracks.

Docker is an externally installed prerequisite for isolated runtime checks.
Detect it, explain compatible Linux-container setup, and provide vendor setup
links. Do not silently install Docker, WSL, privileged services, or change their
settings. Source inspection must remain available with explicit runtime limits;
if model review is unavailable, offer the supported non-model scope rather than
pretending a complete review happened. Never fall back silently to host execution.

## Fixing the drawbacks of both routes

| Drawback | Required mitigation | Failure-case acceptance test |
| --- | --- | --- |
| Manual Node/Python setup | Desktop release bundles tested runtimes; source route keeps a doctor and precise installation guidance. | Desktop launch needs no developer tools; source setup failure stops with the exact missing prerequisite. |
| Installer falsely reports ready | Readiness includes authenticated service handshake, UI assets, and backend startup; Docker/provider states remain separate. | Clean machine without Node/Python can open the installed tool; a failed sidecar produces recovery guidance, not a ready screen. |
| Duplicate instances or trays | One service lease per workspace and one active tray renderer for its selected project; desktop claims/releases presentation ownership without changing the user's persistent legacy preference. | Repeated launch and simultaneous CLI/browser use do not create duplicate jobs or kill other processes. |
| Closing a window kills work | Explain Close to tray, Stop review, and Quit as separate actions. Ask about active work before intentional shutdown; crash recovery retains evidence and interrupted status. | Close/reopen preserves progress; quit/crash never changes an interrupted review to success. |
| Ports already in use | Endpoint discovery with ownership/version validation and bounded fallback; existing source ports remain the default. | Another application on 3000/9123 is never terminated or trusted as PRAXIS. |
| Writable files inside install directory | New installs use per-user application data. Existing checkout data remains in place unless the user chooses a checked import with backup. | Read-only install path works; an update does not overwrite history, budgets, memory, or keys. |
| Upgrades interrupt jobs or strand data | Signed updates, deferred installation while work is active, data-schema backup, compatibility checks, and tested recovery. | Invalid signature is rejected; failed update leaves a usable installation and intact data. Binary rollback alone is not treated as database rollback. |
| Provider keys exposed or lost | New desktop credentials use an OS-protected store through narrowly scoped backend retrieval. Existing environment configuration remains supported; importing keys is explicit. | Keys never appear in renderer state, model context, exported diagnostics, or bundles; unavailable credential storage fails visibly. |
| Browser/desktop show different results | Same UI and job API, stable project/job identifiers, revisions, reconnect/refetch, and explicit staleness. | Both surfaces show the same snapshot, job, budget and assessment; reconnect cannot regress to an older revision. |
| Mascot implies unsupported success | Separate activity, evidence, attention, and connectivity. Legacy session warnings remain labelled as session warnings. | Review completion, model confidence, receipt validity, and production readiness are never conflated. |
| Public site appears to accept projects | Installation page only; local reviewer owns folder selection. No cross-origin localhost scanning from the public site. | No project upload, API-key field, or paid request occurs on the public site. |
| Local content becomes a shell instruction | Keep paths and repository files untrusted; retain traversal, symlink, credential exclusion, argument-array and trust protections. | Malicious folder names, injection text, and symlinks cannot redirect writes or execute shell text. |
| Signing/release infrastructure missing | Desktop CI creates per-platform artifacts, hashes, dependency notices, and signature verification; public download links refer only to actual releases. | Published artifact is tested on its supported clean OS; no fabricated download link or unsigned automatic update. |

## Project identity, activity, and context

Add a small versioned project registry containing an opaque project ID, canonical
source identity, source kind, selected display name, and references to local state.
Keep source identity distinct from review snapshot identity. A local checkout,
GitHub clone, and folder copy must not be silently treated as the same writable
source. Handle moved folders and missing paths through a relink action.

A sanitized status record contains schema version, instance ID, project ID, job
ID, monotonic revision, emitted timestamp, review phase, completed-check counts,
attention count, and a safe local navigation target. It excludes raw conversations,
source excerpts, credentials, and the complete evidence ledger. Write status
atomically. Treat missing/stale/invalid state as unavailable; never as healthy.
The existing job store remains authoritative. Reuse its event stream with
revision-aware reconnect for the UI; use a bounded local status read for the tray.
Do not introduce Redis, Kafka, a cloud queue, or another database.

The tray offers Open PRAXIS, Open in browser, Current project, Recent reviews,
Needs attention, Settings, and Quit. Preserve existing memory/session actions
behind a clearly labelled section. The desktop can reuse icon/animation identity
without deleting old native hosts. Shared presentation data, not AI generation,
drives both hosts; establish Windows/macOS state parity before changing meanings.

Conversation capture remains opt-in and adapter-specific. Show capture disabled,
supported, unsupported, and last successful capture. Do not scrape unrelated
applications or promise universal background recording. Project goals and
decisions can be entered or imported explicitly. Private memory is excluded from
provider review payloads by default; sending selected context requires a separate
clear action and exclusion/redaction tests. No automatic memory migration.

## AI and agent integration

Preserve legacy MCP tool semantics. In particular, the existing `praxis_verify`
tool checks legacy receipt integrity; it must not be renamed or presented as the
new project review/claim-verification operation.

Start new MCP capabilities with project-scoped read operations for review status,
findings, and plan export. Starting paid review, running code, creating repairs,
or applying patches must not inherit permission from read access or a crafted
tool argument. Mutation requests need the existing user-approved action contract,
recorded budget, and snapshot freshness. The approval channel is controlled by
the local application, not the agent's own claim that the user approved.

The current MCP server implements an older initialization-based protocol and
echoes the requested protocol version. Before broadening support, explicitly
negotiate only implemented versions, test rejection of unsupported versions,
and run real-client conformance checks. The official current specification has
a different discovery model; do not advertise it merely by changing a version
string. Preserve older-client compatibility with tests.

Use existing provider/harness components. Label configured, validated, currently
unavailable, and unknown-cost states honestly. Benchmark extraction/review quality
on task-specific fixtures; latency alone is not model quality. A paid coding
agent can receive an approved plan through a supported adapter, or the user can
copy it. Never reuse a subscription session credential as an API entitlement.
Keep tool output and source instructions untrusted. Official/vendor-maintained
external MCP evidence sources remain separately registered and authorized.

## User experience and website

The landing hero will copy `npx praxis-memory` and include **Test Your Project**.
That CTA opens a public installation/start page, not a hosted upload form.
Explain that the CLI currently initializes project integration and does not
automatically prepare or launch the optional reviewer.

Before a desktop release exists, show the tested source-checkout setup and local
reviewer instructions. Once a signed, tested installer exists, make Download
PRAXIS primary, with CLI/source installation secondary. An Open PRAXIS deep link
may later carry only a narrow open-home intent, never a supplied file path,
command, repository credential, or provider key. Always retain manual opening
instructions because browser protocol prompts and installation state vary.

Desktop onboarding: welcome -> local-data explanation -> system readiness ->
optional provider setup -> select project -> review options -> first review.
The folder picker is local. GitHub URLs are cloned locally. Browser folder upload
continues copying into local staging with existing exclusions and size limits.
No account is needed for local use; provider authentication and private Git
access still belong to the user.

Findings use a consistent structure: what happened, why it matters, where it was
observed, confidence/evidence limit, and the next useful action. Keep technical
logs accessible without making them the primary explanation. Preserve light/dark
themes, keyboard navigation, reduced motion, contrast, and non-WebGL navigation.
Reuse the current source graph as optional explanation, not a readiness score.

## Delivery sequence and gates

All phases implement BOTH accepted routes. Staging does not remove either route.

1. **Public entry and contracts.** Update the hero command, canonical domain,
   and Test Your Project installation page. Document the project/status and
   lifecycle contracts. No installer download until an artifact exists.
2. **Local integration foundation.** Add state-directory configuration without
   changing existing defaults, project identity, service ownership, status
   projection, and current-tray navigation. Prove UI/CLI/tray share a real job.
3. **Packaging feasibility gate.** Build the actual Next standalone server,
   bundled Node, and Python API in a thin desktop shell. Test on a clean target
   machine with no global Node/Python. Exercise assets, provider transport,
   Docker detection, source selection, and close/reopen. Measure actual size.
4. **Unified desktop workflow.** Integrate native picker, controlled lifecycle,
   tray ownership, user-data path, protected key storage, and Open in browser.
   Test a real correct and deliberately broken project through both surfaces.
5. **Agent bridge and installation reliability.** Read-only MCP review access
   first; explicit approval-gated actions next. Add installer repair, signatures,
   update rejection/recovery, uninstall data retention, and per-OS build/test jobs.
6. **Public beta.** Release only tested platform artifacts. Publish accurate
   downloads and recovery guidance, recruit consenting users, observe first
   reviews, and fix activation/reliability failures before broad promotion.

The first public desktop release targets Windows, macOS, and Linux together,
as selected in D2. Preserve existing CLI and Windows/macOS native tray behavior.
The existing CLI does not provide a Linux tray: the new desktop tray must supply
that surface, with an accessible window/launcher fallback on environments that
do not expose tray icons. A supported OS is not a promise of every CPU, Linux
distribution, desktop environment, or minimum OS version.

## Cross-platform release matrix

The following is the initial engineering matrix; final minimum OS versions and
CPU claims must match measured artifact tests and bundled runtime requirements.
An unsupported CPU receives clear guidance rather than an incompatible download.

| Platform | Initial artifact and build target | Native release checks |
| --- | --- | --- |
| Windows x64 | NSIS setup executable; Windows build runner; bundled x64 Node/backend | WebView2 missing/present; non-admin installation; paths with spaces/Unicode; occupied ports; Authenticode verification; updater signature; upgrade and uninstall retention. |
| macOS Apple Silicon and Intel | Separate arm64 and x64 app/DMG artifacts built on matching Mac environments; all sidecars match the artifact CPU | Developer ID signing of app and nested binaries; notarization/stapling; downloaded-app launch under Gatekeeper; Keychain locked/available; desktop/browser parity; Intel and ARM clean-machine validation. |
| Linux x64 | AppImage plus Debian package candidate; build on the oldest supported baseline compatible with all bundled runtimes | glibc/WebKitGTK compatibility; certificate/proxy behavior; Secret Service unavailable/locked; X11/Wayland; tray absent; installed package versus AppImage; update and data retention. |

Do not claim Windows ARM or Linux ARM support without matching sidecars and
native tests. Linux baseline examples in Tauri documentation are starting points,
not proof that our chosen Node/Python binaries run there. Newer glibc build hosts
can invalidate older-system support. Pin build images and test the actual binary
on each advertised baseline. Package licenses and bundled runtime notices ship
with each release; do not download unverified executables at runtime.

Use one release version and a complete manifest listing OS, CPU, minimum version,
artifact URL, hash, update signature, and release notes. OS code signing and
updater signatures are separate requirements. Checksums alone are not an
authenticated update channel. Signing keys remain in protected release jobs;
fork PRs cannot access them. Build/test jobs must work without signing secrets;
production release jobs fail closed when signing or notarization is unavailable.

Run ordinary backend/core/browser checks on all three OS families, then package
tests per CPU, then native installer/update smoke on clean machines. A successful
headless CI build is not proof that tray, keychain, file picker, or window lifecycle
works. Keep a native signed-artifact smoke record tied to the exact artifact hash
before allowing its download link into the public manifest. All three OS families
must meet this gate for the selected simultaneous launch.

Tauri's direct `tauri-driver` route is Windows/Linux only; current vendor docs
describe a WebdriverIO embedded-server route covering macOS as well. Evaluate that
test-only route against our exact shell version and actual backend, without IPC
mocks in end-to-end acceptance tests. Never ship an embedded test driver or
backend-inspection plugin in production builds. Test the production signed
artifact separately, including an explicit driver-absent check. If automation
cannot drive a native interaction, require a recorded native check; do not replace
it with a mock while claiming coverage.

Operational prerequisites: Windows code-signing access, Apple Developer ID and
notarization access, isolated update-signing keys, target-CPU Mac validation,
Windows validation, and Linux baseline/desktop validation. Availability has not
been established in this session. These are release dependencies, not permission
to buy certificates, change accounts, or publish artifacts.

## Test and operational acceptance plan

```text
PUBLIC ENTRY [integration/browser]
  hero copy -> exact CLI command / clipboard denial handled honestly
  Test Your Project -> setup -> no project upload / no automatic localhost probe
  real release download -> correct OS artifact / unavailable platform guidance

INSTALL + LIFECYCLE [clean-machine E2E]
  no Node/Python -> installer -> local UI + API -> first source review
  occupied port -> safe fallback or actionable failure; no unrelated process kill
  second launch -> focus/attach -> one workspace owner -> same job
  close/reopen -> preserved job; quit/crash -> interrupted evidence retained
  corrupt update -> reject; failed upgrade -> recover data + prior installation

SHARED WORKSPACE [unit + integration/E2E]
  project IDs -> local/GitHub/upload identity -> snapshot freshness
  status projection -> stale/invalid/error state -> no false healthy rendering
  event reconnect -> revision order -> same findings in browser + desktop + tray
  legacy tray ownership handover -> preserved preference -> no duplicate icon

SECURITY + AI [regressions + golden/adversarial evals]
  origin/host/token/IPC -> reject untrusted request; keys never reach renderer
  MCP old/new protocol -> implemented-version negotiation -> real client handshake
  read tool -> no paid/execution/apply authorization
  explicit mutation -> budget/trust/freshness -> isolated checks -> guarded apply
  true / false / stale-test / silent-mock / partial-fix -> unchanged verdicts
  capture unsupported -> no fabricated evidence; provider fail -> visible limits
```

Candidate tests extend existing core `test` and Workbench backend tests; add
desktop lifecycle/package tests in the optional desktop package, browser journey
tests alongside current Workbench smoke tools, and website interaction tests for
copy/navigation/error behavior. The installer E2E matrix is new work, not covered
by the existing 52 passing tests. Test public-site network absence of project
intake and secrets, not only visible text.

Every code path in the integration contract needs behavior, edge, and failure
coverage. Required gates: relevant core suite, privacy guard, existing CLI package
budget, backend regression, TypeScript, production build, UI accessibility,
installed-package smoke, real isolated correct/broken fixtures, and clean-machine
desktop tests. Preserve historical receipt fixtures unchanged. If extraction,
verification, tool prompts, or aggregation changes, run the applicable Promptfoo
golden suite and false-VERIFIED adversarial gate; periodic red-team and before-
blocking requirements remain. A CI job's existence does not prove branch
protection marks it required; verify repository settings at release time.

Use production servers, bounded job concurrency, one shared model budget, bounded
events/logs, and paginated history before history size becomes a desktop bottleneck.
Avoid doing whole-history JSON parsing or model work in tray refreshes. Measure
startup time, idle CPU/RAM, disk growth, cancellation latency, and event delivery
on a documented reference machine before assigning numerical SLOs. Default tray
activity must not require paid model calls or constant provider polling. Closing
windows must not leak browser/event subscriptions. Pause updates while jobs run.

Do not publish, push, migrate existing evidence, import credentials, or delete
user data during implementation without the corresponding explicit action.
Uninstall retains projects, private memory, and review history by default.

## Research references and limitations

Vendor-maintained sources checked on 2026-10-01:

- [MCP architecture](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture): local stdio and remote HTTP are interfaces to AI hosts, not the application itself.
- [Claude hooks](https://code.claude.com/docs/en/hooks): lifecycle-based integration is client-specific.
- [Tauri sidecars](https://v2.tauri.app/develop/sidecar/): bundling external Node/Python binaries is supported; target-specific binaries still need builds and tests.
- [Tauri Windows installers](https://v2.tauri.app/distribute/windows-installer/): platform installer tooling and prerequisites.
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/): scope desktop commands and permissions.
- [Tauri updater](https://v2.tauri.app/plugin/updater/): signed artifact metadata and update flow; data rollback remains our responsibility.
- [Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/): code-signing integration, separate from update signatures.
- [Next standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output): traced server distribution; public/static assets require deliberate inclusion.
- [PyInstaller usage](https://pyinstaller.org/en/stable/usage.html): one-directory/one-file bundle options; compatibility must be exercised on target platforms.
- [Docker Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/): prerequisite/virtualization/licensing conditions remain external to PRAXIS.
- [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/): Developer ID and notarization are public distribution prerequisites.
- [Tauri Linux AppImage](https://v2.tauri.app/distribute/appimage/): build baseline affects glibc compatibility and runtime size.
- [Tauri desktop testing](https://v2.tauri.app/develop/tests/webdriver/): embedded test-driver route for Windows, macOS, and Linux; direct platform driver has different support.

These sources establish available mechanisms, not that PRAXIS already implements
them. Packaging feasibility, signing access, installation resources, market
demand, model quality, and cross-platform compatibility remain to be measured.

## Engineering review and implementation obligations

Scope challenge: accepted as requested after D1 and D2. Reuse the existing review
engine and UI. Desktop packaging remains separate from the zero-dependency CLI.
The work spans more than eight files, but both distribution routes and all three
OS families were explicitly selected; do not argue again for a reduced launch.
Deliver through the dependency gates below, rather than a single large patch.

Architecture review: one product, private local data, shared job ownership,
project/snapshot identity, and distinct user/agent permissions cover the accepted
integration goal. Distribution includes native build, signing, testing, updates,
and download manifest. A thin shell remains conditional on a real packaging spike.
No new cloud service is needed to operate the product or distribute static updates.

Code-quality review: retain the existing scanner, provider harness, assessment,
and repair contracts. Put status projection and authorization in shared adapters,
not copies in every UI. Keep runtime adapters explicit: source checkout uses the
existing launcher; packaged runtime resolves its bundled binaries, not `.venv`.
Tests must establish compatibility before altering any source-install default.

| Observed integration risk | Source and confidence | Required control |
| --- | --- | --- |
| Installer updates collide with writable job data | `backend/regen/app.py:29`, `DATA = ROOT / ".regen"`; 10/10 that the current data path follows the app directory | New installed runtime supplies a writable per-user data path; current default preserved; no automatic existing-data move. |
| A second API owner marks another owner's live jobs interrupted | `backend/regen/app.py:129-131` loops active jobs during startup and calls `update(...status="error"...)`; `Store.lock` is a process-local `threading.RLock()` | Acquire the cross-process workspace lease before backend recovery; test two simultaneous starts and a stale lease; never treat the in-process lock as the service lease. Risk of cross-instance recovery is source-derived, not a demonstrated production incident. |
| Latest MCP version could be advertised without implementation | `src/lib/mcp/server.js:58`, `protocolVersion: typeof requested === 'string' ? requested : PROTOCOL_VERSION`; 10/10 for the echo behavior | Negotiate implemented versions and prove real-client conformance before expanding tools; preserve existing client compatibility. |
| Large history makes API list/startup expensive | `Store.all()` loads every stored JSON record and sorts the complete collection | Measure representative history sizes, paginate display, bound polling, and preserve complete evidence records. This is a scale risk, not a measured current latency failure. |

Test review: Node's built-in test runner is the core framework; Python unittest
is the backend framework; current browser smoke tools use Playwright/axe. Reuse
those and add native desktop/package tests. Existing 52 focused checks establish
only their covered existing behavior. Eight new acceptance families remain
implementation requirements: public entry, install, lifecycle, shared workspace,
native controls, credentials/permissions, updates/data preservation, and agent
integration. The diagram above maps expected branches and failure paths; no
coverage percentage is asserted for unwritten code. Acceptance tests must exercise
the real services and packaged artifact, not only mocked UI states.

Performance review: avoid model/provider work in tray polling, full-history parsing
in UI refreshes, and unbounded source/event payloads. The installed product includes
multiple runtimes, so measure total process-tree memory rather than the desktop
shell alone. A paginated API needs tests for stable ordering and no dropped jobs.
Cancellation, reconnect, and background shutdown must stay responsive during
uploads and reviews. Numerical limits are assigned after a documented baseline;
existing sandbox and spending limits remain enforced now.

Failure mode coverage: all eight acceptance families are unimplemented gaps for
the new product integration. Each has explicit visible error handling and required
tests in this plan. They are release gates, not claimed fixes. In particular, losing
service ownership, signature validation, or snapshot freshness must fail closed.
If an error has no visible state or test at implementation review, it blocks release.

Outside-voice status: running under Codex; nested Codex passes skipped. An in-host
challenge identified dependency-free CLI versus bundled-runtime boundaries,
Linux runtime compatibility, native-versus-browser test coverage, and signed-
binary-versus-data rollback differences. These are reflected as requirements;
this is not an independent or cross-model endorsement.

No new follow-up TODO is proposed: the identified integration, packaging, and
release obligations are part of the accepted build, not deferred reliability work.
The gstack runtime/log helpers are unavailable in this installation, so no
automated readiness dashboard or external review metadata is claimed.

## Implementation tasks

Effort labels are rough planning estimates, not measured completion times; native
machine access, signing setup, and validation waits are excluded from coding time.

- [ ] **T1 (P1, human: 1-2 days / agent-assisted: one focused session)** — public entry: change the hero clipboard command, add the installation route, and retain accurate source-install guidance. Verify clipboard success/denial, navigation, responsive accessibility, and absence of hosted project intake.
- [ ] **T2 (P1, human: 3-5 days / agent-assisted: several sessions)** — local service contract: implement project identity, private endpoint handshake, cross-process ownership, data-path override, and sanitized revisioned status. Verify occupied ports, startup races, crash recovery, stale state, and source-default compatibility.
- [ ] **T3 (P1, human: 4-8 days / agent-assisted: several packaging cycles)** — bundled runtime: build Next standalone plus compatible Node/Python sidecars for every target CPU. Verify clean-machine startup, real API operations, assets, TLS/provider transport, notices, and no `.venv` or source-checkout dependency.
- [ ] **T4 (P1, human: 4-7 days / agent-assisted: several sessions plus native checks)** — unified shell and tray: connect native project selection, one active tray renderer, Open in browser, private credentials, and close/quit behavior. Verify desktop/browser same-job parity, Linux no-tray fallback, memory preference preservation, and keychain failure handling.
- [ ] **T5 (P1, human: 3-5 days / agent-assisted: several sessions)** — agent bridge: add project-scoped review reads and approval-gated requests with explicit MCP version compatibility. Verify no authorization escalation, malformed requests, unsupported clients, budget enforcement, and no changed legacy tool semantics.
- [ ] **T6 (P1, human: 4-8 days / agent-assisted: several build/validation cycles)** — release operations: implement per-target packaging CI, signing/notarization integration, authenticated update metadata, data backup/recovery, and uninstall retention. Verify invalid signatures, interrupted updates, no driver in production, no release secrets in forks, and all-platform artifact completeness.
- [ ] **T7 (P1, human: 3-5 days / agent-assisted: automated runs plus native sessions)** — acceptance: exercise all eight new flow families on target machines, preserve historical core fixtures, and run the applicable golden/adversarial gates. Verify a real correct project and a deliberately broken project through both surfaces; mark unavailable production/journey evidence accurately.
- [ ] **T8 (P2, human: 1-2 days / agent-assisted: one focused session plus user observations)** — public beta: publish only authorized tested artifact links, installation/recovery guidance, and consented onboarding observations. Verify OS/CPU download selection and no cloud project intake; collect evidence of useful repeat use before pricing or scale claims.

These estimates are not additive scheduling promises: dependent validation must
wait, while independent documentation and platform build preparation can overlap.

## Execution dependencies and safe parallel work

| Step | Modules | Depends on |
| --- | --- | --- |
| T1 website/install guide | `web`, website build script | Accepted local-only product contract; installer links wait for T6/T7 |
| T2 service/status/data contracts | `src/lib`, Workbench backend and launcher | Accepted project/authorization contracts |
| T3 packaging | optional desktop package, build scripts, Workbench build config | T2 runtime/data/endpoint contract |
| T4 shell/tray | desktop package, tray hosts, Workbench presentation | T2; T3 for installed-artifact validation |
| T5 MCP adapters | `src/lib/mcp`, agent adapters | T2 authorization/project contract |
| T6 platform release pipelines | workflows, desktop packaging | T3; T4 for lifecycle/update validation |
| T7 acceptance | core/backend/browser/native test suites | T1-T6 integrated artifacts |
| T8 beta release | website release manifest and docs | T6 + T7 pass on all advertised targets; publishing authorization |

Lane A: T1, independent website work. Lane B: T2 -> T3 -> T4, shared lifecycle
and desktop contracts. Lane C: T5 after T2 is merged. Platform build jobs within
T6 can run independently after artifact inputs are fixed. T7 joins the integrated
work; T8 follows its gates. Keep shared desktop/config/lockfile edits sequential
or in isolated worktrees with explicit ownership. This is an implementation
strategy, not a request to spawn agents or start parallel edits now.

Inline diagrams belong beside the supervisor lifecycle, ownership acquisition,
project/snapshot mapping, and approval-to-execution transitions when those are
implemented. Keep tests' diagrams synchronized with behavior.

## NOT in scope

- Hosted project upload/storage or a cloud review engine: the product is installed locally.
- Rewriting the verification/review engines or changing historical formats: reuse preserves proven behavior.
- Universal conversation scraping: only supported, explicitly enabled adapters are allowed.
- A mandatory account, telemetry service, or cloud queue: none is needed for local operation.
- Mobile applications, Windows ARM, Linux ARM, or universal Linux support: untested extra targets are not implied by the selected three OS families.
- Silent model calls, automatic source apply, Docker/WSL installation, credential import, or local-evidence migration: these remain explicit separate actions.
- New paid signing accounts or publication in this planning session: record prerequisites; do not buy or release automatically.
- New orchestration frameworks, formal verification, or decorative UI rewrites: they do not solve the integration and distribution goal.

## GSTACK REVIEW REPORT

| Review | Runs | Status | Findings |
| --- | --- | --- | --- |
| Architecture | 1 | D1 + D2 accepted | Desktop + browser + CLI; all three OS families at launch; one local service contract. |
| Code quality | 1 | Requirements reviewed | Shared adapters, single writer, preserved defaults and legacy APIs; implementations still pending. |
| Tests | 1 | Acceptance plan produced | Existing focused suite 52/52; eight new integration families and per-target native release checks required. |
| Performance | 1 | Measurement gates defined | Bounded polling/history/context; total installed-process resources; no invented SLOs. |
| Outside voice | 0 independent | Nested Codex skipped | In-host challenge recorded; no independent or cross-model endorsement. |

VERDICT: DONE_WITH_CONCERNS for planning. Ready for incremental implementation
and packaging feasibility work; not cleared for public release. Target-machine
validation, signing access, artifact compatibility, and new acceptance tests are
required operational gates, not completed work.

NO UNRESOLVED DECISIONS
