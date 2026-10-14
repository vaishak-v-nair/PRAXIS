# PRAXIS: video references, decision models, and the everyday workspace

Date: 2026-10-09. Status: reference research plus the first shared-workspace and Findings implementation. Decision-model integration and the broader redesign remain future work.

Implementation follow-up: the local Workbench now opens on saved reviews, uses a compact browser/desktop shell, keeps review sections and finding selection in the URL, and shows a focused mobile finding detail with list-position restoration. Issue actions share one contextual group, and the Checks view has one run control. Review completion is displayed neutrally. Source types are readable in the library while exact paths and upload IDs remain available in the review's source details. The existing backend review, evidence, cost, runtime-trust, and apply flows remain authoritative. The desktop installer lifecycle and a moderated usability study have not been validated by this browser implementation.

## Product decision

Make the local product a focused project workspace. A person should be able to resume their project, understand what needs attention, inspect the supporting material, and choose the next action. Model routing, crawlers, specialist coordination, and execution logs support this workflow in the backend.

The supplied videos communicate activity and an eventual result effectively. Their animated graphs are useful presentation references, but their density would reproduce the problem the user is asking PRAXIS to solve. The useful design transfer is **goal → visible progress → useful result → action**.

This supplements [the measured local UX audit](PRAXIS-LOCAL-UX-RESEARCH-2026-10-09.md). The marketplace direction remains the [selected Option C plan](PRAXIS-OPEN-OUTCOMES-MARKETPLACE-2026-10-08.md); it is not evidence that marketplace accounts, listings, or orders already work.

## Video inspection method and limits

Inspected all four supplied files through 47 timestamped frames spanning their visual timelines, including opening, middle, and closing states. Enlarged representative frames to inspect labels, code, stage names, and disclosures. Durations were read with ffprobe; ffmpeg extracted frames and sharp assembled contact sheets. This was a frame-based visual review, not an audio transcription or a frame-perfect motion audit. Audio was not analyzed. The files were not uploaded to another service.

Local artifacts are in `apps/workbench/.regen/artifacts/video-reference-research-2026-10-09/`: `manifest.json`, individual PNG frames, four timeline contact sheets, and `index.html`, an interactive reference reader. These are ignored local research materials, not public product assets. No rights to redistribute the original videos are assumed.

| File in Downloads | Duration | What is visibly shown | Useful transfer into PRAXIS |
| --- | ---: | --- | --- |
| `GFx88UeY2gkN2FHK.mp4` | 24.10 s | A routing graph advances through state input, Jev decisions, write selection, a gate, escalation, and code action. A lower strip shows logs, worker dispatch, code, and cost. | A short, truthful progress strip; decision details available on demand; a clear human handoff when work cannot continue. |
| `h0ImalMqqgpIBaHh.mp4` | 24.02 s | A GROKBOT + JEV trading control room shows named roles, changing charts, a crawler panel, risk/size/fill panels, and animated connections over a spatial scene. | Stable ownership and purpose for each piece of work; one place to see what is running or waiting. Do not copy a trading terminal's visual density. |
| `KAW8qq-EfhNOR8AM.mp4` | 16.72 s | A spider-like overlay moves over a references page, with highlighted links and bibliographic identifiers as the page scrolls. | Show precisely which source was inspected, with an excerpt and an accessible open-source action. Decorative motion must not obscure reading. |
| `bS3y-WcZuS4Xr7w2.mp4` | 19.06 s | A projects-to-niches visualization moves through crawling, Jev sorting, GPT research, then three highlighted recommendations. | Progressive narrowing from a large input to a concise, actionable shortlist, with provenance available beside each result. |

### Timestamp observations

- **Routing graph:** at 0–4 s the graph and state-input stage dominate; at 6–8 s Jev decisions are highlighted; around 10–12 s the view focuses on a choice and write branch; at 14–16 s a gate holds; at 18–20 s escalation is emphasized; at 22–23 s code action appears. This presents an understandable sequence inside a very complicated visual surface. A video cannot establish that the code, counters, or latency labels came from a live service.
- **Trading room:** across 0–8 s the role panels and central chart stay in the same positions while the animated overlay moves. At 10–16 s displayed balances and positions change. At 18–23 s the same spatial organization remains while other panels update. The stable layout supports orientation; the many moving details compete for attention. Displayed profits are not verified trading results.
- **Source overlay:** at 0–4 s the page shows external links, further reading, and references; at 6–10 s the overlay emphasizes book titles and identifiers; at 12–16 s more references move through the viewport. This demonstrates a visual source-inspection metaphor. The clip alone does not prove page fetching, semantic accuracy, or Jev integration.
- **Niche discovery:** at 0–6 s the interface says crawling; at 8–10 s sorting; around 12 s GPT research; at 14 s three results are highlighted; at 16–18 s a result panel and monthly-potential figure appear. The enlarged frame explicitly says **DEMO DATA** and **SIMULATED NUMBERS · PREVIEW ONLY**. Its counts, costs, savings, and income figures must not become PRAXIS marketing claims or benchmarks.

## What makes the experience useful

The strongest reference is the last clip's change from many inputs to a few meaningful results. PRAXIS should make a similar reduction in cognitive work:

1. **Open a project.** A returning user sees saved work immediately. A new user sees one source-selection flow.
2. **Choose the goal.** Use the existing project-intent input, with a short explanation of what the review can establish.
3. **See real progress.** Display the current backend stage and the latest meaningful event. Do not invent percentages, elapsed savings, workers, or results.
4. **Read the result.** Lead with the observed outcome, important issues, and material untested areas. Keep process completion separate from project correctness.
5. **Take the next step.** Open the issue, draft a fix plan, copy it to an agent, or authorize a supported action. Preserve the existing preview, runtime trust, budget, and source-apply checks.

The Codex desktop analogy is useful as an interaction goal: stable project context, persistent work, direct controls, and details available when needed. It does not mean PRAXIS needs a chat transcript as its home screen. The existing Tauri app already loads the Workbench interface; improve that shared interface rather than creating a second frontend with different behavior. The desktop README describes the implementation, but this research did not verify installer signing or consumer release readiness.

## Concrete frontend specification

### Information architecture

```text
PRAXIS
  Projects                         saved project/review library
  New review                       compact source and intent flow

Selected project
  Overview                         outcome, gaps, next action
  Findings                         issue queue + selected issue
  Checks                           observed runs and untested areas
  Work                             plans, proposed changes, assignments

Supporting views
  Files                            source inventory and locations
  History                          past reviews and backend activity

Settings                           providers, limits, appearance
Help                               short contextual guidance
```

Preserve access to external evidence and shared work through named destinations. Do not remove existing functionality to simplify the main navigation. Marketplace browsing and purchasing appear only when their backend contracts and real supply are ready; no placeholder providers or inert order controls.

### Layout and interaction

| Area | Proposed behavior | Existing implementation to preserve/use |
| --- | --- | --- |
| Desktop shell | A 224 px sidebar, compact project header, broad main workspace. New review is one prominent action. Settings and Help stay at the bottom. | `app/page.tsx`, `AppHeader.tsx`, `use-workspace.ts`; the desktop wrapper uses the same app. |
| Home | Saved reviews first for returning users; source intake as a focused creation flow. Avoid a marketing headline inside daily work. | `ReviewHistory.tsx`, `Intake.tsx`; real `/api/jobs` and project registry endpoints. |
| Project library | Group only by genuine project identity. Old unlinked records remain reviews. Show process state from the list contract, not invented readiness. | The jobs list lacks rich assessment outcomes. Add a bounded backend summary contract before introducing outcome badges or issue totals there. |
| Findings | Compact queue with title, severity, short location; selected issue shows impact, evidence, and one action group. Full titles remain available. | `Findings.tsx`, `AgentBrief.tsx`, `fix-plan` endpoint; retain search, sorting, source links, clipboard fallback. |
| Checks | Lead with what ran, failed, or remains untested. Expand a row for command output and provenance. | `Execution.tsx`, current-snapshot and source-freshness semantics, runtime confirmation. |
| Work | Show the current plan and its status; make copy, agent handoff, proposed changes, and explicit apply understandable in sequence. | `Changes.tsx`, `ProjectWork.tsx`, `SharedWorkspace.tsx`, existing approvals and action endpoints. |
| Navigation state | Persist review, section, selected finding, and relevant filters in the URL. Back/reload restores context. | Preserve existing `?job=` links; fix view state currently reset to Overview. |
| Mobile | Show either list or detail. Back restores filters and list position. Navigation becomes a compact drawer. | Preserve the same data/actions; do not stack two desktop panes into a long document. |

### Visual direction

- Quiet graphite and warm off-white themes; retain the user's appearance setting. Define readable surface, border, primary, secondary, and metadata tokens in both themes.
- Use the existing PRAXIS mark and a single action accent. Reserve green, amber, and red for specific supported states. A finished scan is neutral, not a green certification.
- Body text 14–16 px, secondary text 12–13 px, headings 20–24 px. Use monospace for paths and code only. Avoid uppercase paragraph labels and repeated explainers.
- Use 8/12/16/24 px spacing, aligned toolbars, and modest corner radii. Target 64–80 px issue rows without clipping essential titles; allow reflow at zoom and with long content.
- Motion explains change: selection highlight, subtle drawer transition, actual running-state indicator. Respect reduced motion. Avoid permanent graph motion and fake AI typing.
- Keep the mascot for optional onboarding, empty states, or a small status presence. It must not occupy the issue-reading area or imply a real running agent.
- Show a brief plain-language impact statement, then specific source evidence. Do not replace precise findings with attractive but unsupported AI summaries.

### Move backstage

Model IDs, prices per token, specialist names, raw routing probabilities, orchestration graphs, worker counts, and harness configuration belong in settings or technical detail. Users still need to see meaningful cost limits, data destinations, failures, unavailable capabilities, and requests to run or apply work. Simplifying presentation must not conceal those decisions.

## Jev and current alternatives

Jev is a decision model: typed questions over supplied state produce structured choices, scores, or probabilities. Fetching pages remains a separate tool responsibility. TypeSafe documents this interface in its [official introduction](https://docs.typesafe.ai/introduction). Its published speed and cost comparisons are vendor measurements for particular workloads; they do not establish PRAXIS performance. Its type-safety claim also does not establish that a semantic judgment is correct. See the [launch explanation and benchmark caveats](https://typesafe.ai/blog/introducing-system-one-models-and-jev).

### Candidate shortlist, checked against primary sources

| Candidate | Why it is relevant | Decision for PRAXIS |
| --- | --- | --- |
| **Cloudflare Clef / Clef-flash** | Cloudflare released open Apache-2.0 decision models with hosted Workers AI access. The family supports typed decisions; Clef-flash also supports image inputs. [Vendor announcement](https://blog.cloudflare.com/clef-decision-models/), [model card](https://huggingface.co/Cloudflare/clef-flash). | First hosted candidate to benchmark because PRAXIS already has a Cloudflare deployment direction. Hosted source processing remains opt-in. An existing website deployment does not establish model access, free usage, or suitable latency. |
| **Bespoke Nimble 9B** | A specialized local text-decision model with Apache-2.0 weights and vendor-published evaluation resources. [Model card](https://huggingface.co/bespokelabs/Bespoke-Nimble-9B), [vendor repository](https://github.com/bespokelabsai/nimble). | First local specialized candidate to benchmark where hardware is suitable. Do not add a mandatory model download to installation. |
| **Together Tev1 4B / 0.8B** | Experimental, Jev-inspired decision models in smaller sizes. [Official repository](https://github.com/togethercomputer/tev1), [4B model card](https://huggingface.co/togethercomputer/Tev1-4B-experimental). | Research comparator. At review time the 4B card says the fine-tuned weight license is still being finalized; the repository's script license is not sufficient evidence for bundling the weights in a public release. Its robustness limitations also need testing. |
| **TypeSafe System One Adapter + an existing provider** | TypeSafe maintains an MIT adapter that supports LLM-backed structured decisions, retries, usage, and diagnostics. [Official repository](https://github.com/typesafe-ai/system-one-adapter-python). | Useful comparison harness and interface reference. Generated distributions and normalization are not demonstrated calibration or Jev-level speed. Redact diagnostic prompts/responses before recording them. |
| **Qwen3.5-4B + constrained structured output** | Available Apache-2.0 model weights; local serving can enforce an output schema. [Qwen model card](https://huggingface.co/Qwen/Qwen3.5-4B), [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs). | General-purpose baseline, especially if already available locally. Measure latency with the actual serving configuration. Generating a `confidence` number does not make it calibrated. |
| **SetFit with a calibrated classifier** | Few-shot classification using Sentence Transformers, with a separate calibration method and held-out data. [SetFit](https://huggingface.co/docs/setfit/index), [scikit-learn calibration](https://scikit-learn.org/stable/modules/calibration.html). | Consider later for stable, repeated labels when PRAXIS has representative examples. It is not a zero-training replacement for arbitrary typed questions. |

[Ollama's current decision API](https://docs.ollama.com/capabilities/decision) provides a local `/v1/systemone` path for supported models, requiring a sufficiently recent Ollama version. Its confidence definition reflects concentration among choices, not guaranteed correctness. Local model operation needs no API key, but still has download, memory, hardware, and maintenance costs. Do not silently install it or fall back from local processing to cloud processing.

**Recommendation:** evaluate Clef-flash and Nimble against the existing provider baseline first. Keep Tev1 as a research comparator until its artifact license and release assumptions are resolved. No candidate has been benchmarked on PRAXIS in this pass, so none is declared the fastest, most accurate, or production-approved.

## Backend architecture that keeps the UI simple

```text
User opens project and requests review
  → existing source preparation and local project context
  → existing deterministic inspection and evidence collection
  → optional bounded decision adapter for routing/enrichment
  → existing stronger-model analysis when permitted and useful
  → existing runtime checks after explicit trust
  → evidence-backed findings, coverage gaps, and next actions
  → concise workspace presentation
```

Use a small versioned decision contract: task kind, bounded input references, permitted choices, selected choice or abstention, score provenance, model/version, duration, error, and observed usage. Set deadlines, shared budgets, and cancellation outside the provider. Unknown usage remains unknown. A model can suggest where to look; it cannot grant execution permission, remove a scanner finding, certify a fix, or silently skip required checks.

Start in **shadow mode**: record how the router would prioritize optional enrichment while the current workflow remains authoritative. This avoids trading away detection quality for an unmeasured speed benefit. The UI should remain fully useful if the router is unavailable.

For a future docs/advisory monitor, fetching could use a bounded local [Crawlee/Playwright path](https://crawlee.dev/js/docs/introduction), or optional hosted [Cloudflare Browser Run crawling](https://developers.cloudflare.com/browser-run/quick-actions/crawl-endpoint/). The latter is a cloud service with limits and account permissions, not a side effect of deploying the website. Keep fetched pages as untrusted data; use explicit domains, redirect/address validation, byte/time limits, provenance, cancellation, and policy-aware fetching. Do not introduce a general crawler into the current source-review product merely to imitate the videos.

### Evaluation before any routing changes behavior

Compare candidates on the same labeled examples, source snapshots, prompt/schema versions, and input lengths. Include critical security cases, vague tasks, missing context, misleading documentation, prompt injection, negation, stale sources, and out-of-domain inputs.

Measure critical-case recall first; then false positives, abstention quality, schema validity, calibration, p50/p95 end-to-end latency, cold start, throughput, peak memory, and observed cost. Evaluate against the baseline with the router disabled. A miss on a required security or verification check is not acceptable merely because the overall accuracy improves. Choose thresholds on validation data, then report held-out performance and uncertainty. An arbitrary confidence cutoff copied from a video is not a release gate.

## Implementation order and acceptance

1. Build the shared shell and compact creation flow using existing real backend data. Restore navigation state and keep legacy deep links.
2. Rework Findings into a readable compact queue/detail experience, with mobile list/detail navigation and one clear action group.
3. Simplify Overview, Checks, and Work; retain every trust, cost, freshness, and confirmation boundary.
4. Test realistic workflows with saved records, empty/error/loading states, long names, keyboard navigation, reduced motion, and narrow screens. Test frontend routing plus existing backend regressions, TypeScript, and production build.
5. Validate the shared UI in the browser and desktop wrapper. Installer lifecycle and signing remain separate release gates.
6. Benchmark the optional decision adapter after the core workflow is usable. Do not make a new model dependency a prerequisite for the redesign.

Proposed usability acceptance: a returning user finds saved work without scrolling past creation; a person identifies the important issue, its evidence, and the next action without reading the whole report; no issue selection disappears on refresh; mobile selection opens the detail immediately; no inactive decorative controls; and the person can distinguish reviewed source from executed behavior. Validate with builders using AI, developers, and team users, with equal priority. These are proposed acceptance tests, not completed user-study results.

## Delivery boundary

This pass produced visual reference evidence, checked current model alternatives, and implemented the first local UI increment in the existing Workbench frontend. The shared shell and Findings list/detail flow are built; Overview, Checks, Work, the full destination structure, and desktop packaging still need the same product-level simplification and validation. No paid model call, model-weight download, new MCP registration, or asset publication was part of this redesign. The sampled videos and the browser tests do not establish a live user-study result or production installer readiness.
