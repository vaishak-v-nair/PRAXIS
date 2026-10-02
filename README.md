<div align="center">

<img src="docs/mascot.gif" width="240" alt="PRAXIS axolotl companion">

# PRAXIS

### Built with AI. Checked with evidence.

**A local project review tool for software built with AI.**

[![npm](https://img.shields.io/npm/v/praxis-memory?color=d6547a&label=npm)](https://www.npmjs.com/package/praxis-memory)
[![CI](https://github.com/vaishak-v-nair/PRAXIS/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/vaishak-v-nair/PRAXIS/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-4fa376)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522-4e8fd0)](https://nodejs.org)

**[Website](https://praxis-six-xi.vercel.app/)** · **[Browser trial](https://praxis-six-xi.vercel.app/test-your-project/)** · **[Consumer quickstart](docs/PROJECT-REVIEW-QUICKSTART.md)** · **[Codebase map](docs/PRODUCT-MAP.md)**

</div>

Bring a project folder or GitHub repository. PRAXIS inspects an isolated copy,
shows source-backed findings and gaps, runs authorized checks in Docker, and
helps you draft a fix plan before handing it to your model or coding agent.
People and AI specialists work around one review. Model opinions and recorded
execution remain visibly separate.

## Start locally

With Node.js 22+ in this checkout:

```powershell
node src/cli.js review
```

The managed launcher prepares the optional app, installs private Python, builds
the production interface, then opens `http://127.0.0.1:3000` after both services
respond. Saved reviews use persistent user data outside npm's cache. Git and
system Python are not required for this managed path. `review --check` checks
readiness without installation; `review --setup-only` prepares without launch.

After the **manual npm release**, the consumer command is:

```powershell
npx praxis-memory@0.14.2 review
```

Version 0.14.2 is a release candidate until published. The checkout command works
now; pushing does not publish npm packages. Node.js remains required. The existing
`npx praxis-memory` memory CLI and Windows `.\start.ps1` developer launcher remain
available. See [managed setup](docs/WORKBENCH-INTEGRATION.md) and
[manual release instructions](docs/MANUAL-NPM-RELEASE.md).

## How it works

1. **Understand:** inventory actual files, stack, plans, entrypoints and tests.
2. **Inspect:** use existing scanners for source-backed risks, leakage,
   dependencies, incomplete paths and false-success patterns.
3. **Collaborate:** four specialists inspect the same bounded, redacted snapshot,
   then challenge peer findings using real source snippets and finding IDs.
4. **Execute:** run discovered project commands in Docker when explicitly trusted.
5. **Decide:** show demonstrated behavior, failed checks, limits and release blockers.
6. **Plan:** inspect a source-aware fix plan, copy it to a paid coding agent, or
   authorize your configured model to prepare proposed changes.

Local paths, GitHub HTTPS URLs and folder uploads share the workflow. Uploads
accept 25,000 files, 2 MiB per file and 100 MiB total in bounded batches.
Dependencies, credentials, generated output and private memory are excluded.
Large data projects can use a local path. GitHub uses local Git credentials with
TLS verification; repository and model access remain separate.

### People and AI teams

The **Workspace** tab holds goals, questions and decisions alongside specialist
evidence. Open the review URL in another browser on the same computer to
collaborate through live job updates. Names are local labels, not authenticated
identities. The API remains on loopback.

Notes stay local by default. Mark a note for the AI team to include it in the next
bounded model round. **Ask agents to review shared notes** starts a new source
review using the remaining job budget; it does not run commands or approve edits.
Agreement cannot erase findings or become execution proof. Provider failures,
quotas and missing credentials remain visible. See [the contract](docs/AI-TEAM.md).

The four roles cover user journeys, reliability, security and production
architecture. They reuse configured OpenRouter, Gemini, NVIDIA and Groq adapters.
Fewer providers can serve multiple roles. Calls reserve against one thread-safe
budget and preserve partial work. Independent model review remains available
under **What this review includes**.

### Browser trial

The public **Test your project** page inspects selected source locally in the
browser using the canonical scanner. It returns findings and a copyable repair
prompt. It does not run project code, use server-side model keys, prove a user
journey or silently upload project files. Install locally for model collaboration
and authorized runtime checks.

## Commands

The core CLI has **zero runtime dependencies**. Workbench has separate Next.js
and Python dependencies, installed only through an explicit app launcher.
For published versions use `npx praxis-memory <command>`; an installed package
also provides `praxis`.

| Command | Purpose |
| --- | --- |
| `review` | Managed local project review setup and launch |
| `workbench` | Existing app launcher; `--check`, `--production`, `--path` |
| `verify` | Check completion claims bound to a real commit range |
| `live` | Rehearsed true/false Verify demo; optional LangGraph.js |
| `github-app` | PR verification webhook service; advisory by default |
| `demo` | Recorded-excerpt receipt demo; `--live` spends agent tokens |
| `init`, `doctor`, `connect` | Initialize, diagnose and link supported clients |
| `status`, `recap`, `save`, `remember`, `forget` | Inspect and maintain project memory |
| `health`, `switch`, `checkpoint` | Session health, tool handoff and checkpoints |
| `trace`, `gate` | Commit context and risk triage |
| `receipt` | Inspect evidence, validate integrity or request claim evaluation |
| `flow`, `eval` | Native DAG jobs and evidence fidelity evaluation |
| `tray` | Windows axolotl companion; `--stop` shuts it down |
| `vault`, `telemetry`, `feedback`, `update` | Existing integrations and maintenance |

`node src/cli.js --help` gives the current contract. Project agent instructions,
MCP tools and `/praxis-*` templates remain available for supported clients.
A link on disk does not prove a client is connected or authenticated.
See [agent workflow and capture boundaries](docs/AGENT-WORKFLOW.md).

## Receipts — proof, not vibes

PRAXIS Verify separately captures tasks, extracts atomic claims, binds commits,
runs independent checks and assigns **VERIFIED**, **CONTRADICTED**,
**UNSUPPORTED** or **NEEDS_HUMAN_REVIEW** per claim. The new Verify record uses
Ed25519 signatures. CI supports evidence; an LLM explanation or a successful
agent process cannot independently verify a claim.

Historical HMAC and session receipt contracts remain unchanged. HMAC receipts
are not relabelled as public signatures. A valid signature checks record integrity,
not unsupported claims or signer identity. Unsupported transcripts receive no
invented verified execution. The offline `demo` checks an explicitly marked
recorded excerpt without a judge verdict, separately from Workbench.

```powershell
node src/cli.js verify
node src/cli.js receipt verify path/to/receipt.json
node src/cli.js live
```

See [Verify quickstart](docs/VERIFY-QUICKSTART.md),
[receipt specification](RECEIPT-SPEC.md) and [GitHub App setup](docs/GITHUB-APP.md).

## The companion

The Windows tray mascot, animations, memory hooks, MCP tools and agent adapters
remain intact. `praxis tray` provides local status and continuity alongside
Project Review; it does not replace evidence checks.

## What Praxis writes, and where

- Core memory and evidence remain in `.praxis`, retaining their formats.
- Checkout app jobs, snapshots, patches and backups stay in its ignored `.regen`.
- Managed installs separate versioned runtime from persistent user data.
- Provider keys remain server-side. Saved local keys are files, not an OS keychain.
- Launchers never silently migrate or upload evidence, memory or credentials.

## Session health, and switching tools

`status`, `health`, `checkpoint` and `switch` preserve decisions and prepare
handoffs. Automatic capture is limited to documented hooks and supported
transcripts. Model APIs and coding CLIs have separate authentication contracts.

## Trace — the why behind every commit

`trace` associates supported captured context with commits locally. `gate` is
review triage. Neither independently proves production behavior.

## The platform: commands that disappear

The existing CLI, slash templates, skills and MCP tools keep their current
implementations. See the [codebase map](docs/PRODUCT-MAP.md) and
[retained detailed reference](docs/PROJECT-REFERENCE.md).

## Your Obsidian vault, auto-fed

The optional `vault` integration remains local and explicit. Personal vaults
are excluded from source control, model payloads and consumer downloads.

## AI Orchestration & Evaluation

Core DAG execution, retrieval, fidelity evaluation, official-source MCP evidence
adapters and Promptfoo golden/red-team suites remain separate from the Workbench
team. Team collaboration uses bounded parallel review and peer challenge without
a new framework or cloud database. Optional LangGraph.js in PRAXIS Live does not
replace the authoritative native verifier.

## Safety

Submitted projects are untrusted data; inspection never imports them. Execution
requires trust and uses the disposable Docker copy. Network access is separately
authorized. Docker reduces exposure, not every possible hostile-project risk.
Missing tools remain unavailable.

Models receive bounded, redacted source excerpts through configured providers.
Dependency lookup may send package names and versions to OSV. Local storage
is not offline model inference. Private conversation memory stays out of review.

Source application requires confirmation, matching fingerprints, backups and
rollback. GitHub and uploaded projects use reviewable patches or exports.
PRAXIS never pushes a submitted project or treats notes as execution, apply,
merge or publication permission. Blocking merge gates remain opt-in per repo.

## What PRAXIS does not do

It does not guarantee complete security coverage, production readiness from
source, paid-provider credit or truth through model consensus. Browser review
is limited. Remote invitations require an authenticated deployment; the local
API is not public.

## Roadmap

Improve real-repository coverage and consumer setup first. Remote collaboration
must preserve local source control, authenticated access and explicit sharing.
Exploratory plans remain documentation, not delivered-product claims.

## Develop

```powershell
npm ci --prefix apps/workbench
# Python environment setup: docs/WORKBENCH-INTEGRATION.md
npm run dev
npm test
npm run test:workbench
npm run typecheck:workbench
npm run build:workbench
node scripts/ci/leak-guard.mjs
node scripts/ci/tarball-budget.mjs
node scripts/ci/pack-smoke.mjs
```

Core tests are in `test`; app tests in `apps/workbench/backend/tests`. Consumer
packages omit dependencies, virtual environments, private jobs, generated
builds, tests and import provenance. Source and detailed development references
remain in Git. The package retains its 3.55 MiB limit.

## License

MIT — see [LICENSE](LICENSE).
