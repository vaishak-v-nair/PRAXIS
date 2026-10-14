# PRAXIS local experience: research and redesign specification

Date: 2026-10-09. Status: measured pre-change UX baseline. The follow-up below records the first implemented redesign increment.

Follow-up: [four supplied video references, current Jev alternatives, and the everyday workspace specification](PRAXIS-VIDEO-REFERENCES-AND-DECISION-MODELS-2026-10-09.md). The follow-up separates observed demo behavior from simulated numbers and keeps model routing behind the user workflow.

Implementation note: the shared Workbench shell, saved-review home, URL-restored review/finding context, neutral completion status, and compact mobile Findings list/detail flow were added after this baseline. The measurements and screenshots below describe the older interface; they should not be read as current layout measurements.

The local app needs a change in structure. Its primary screens behave like long reports with an intake form attached. The next iteration should be a project workspace: resume work, understand the current result, inspect an issue, and choose an action without losing context.

The last redesign improved spacing, contrast, and disclosure but retained the same hierarchy. A successful build, accessibility scan, and backend journey did not establish that the product was easy or pleasant to use. This audit explicitly examines that gap.

## Evidence and method

- Read the local app shell, intake, history, overview, findings, checks, changes, provider settings, action dialogs, shared UI primitives, routing state, styles, and relevant backend project contracts.
- Inspected nine rendered states of the running app at `127.0.0.1:3000`: desktop home, overview, findings, checks, empty changes, model settings, plus mobile home, overview, and findings.
- Used an existing saved review containing 26 findings and zero executed checks. No synthetic findings were inserted, and the audit did not validate the correctness of those findings.
- Captured bounding boxes at 1440×900 and 390×844. Coordinates below are CSS pixels from the top of the document at scroll position zero. Measurements describe this sample, not every possible review.
- Reproduced section-state loss on refresh. No scan, model call, provider probe, command execution, source apply, or review mutation was requested.
- No JavaScript exceptions or horizontal document overflow were recorded in the nine captured states. This is not a full accessibility certification or moderated user study.
- Studied official Linear, Vercel, GitHub Primer, Sentry, Microsoft HAX, W3C, and Nielsen Norman Group material. Inspected official Vercel and Sentry interface images as well as local screenshots.

Local evidence is retained under `apps/workbench/.regen/artifacts/design-research-2026-10-09/`: `audit.json`, `capture.py`, nine screenshots, and the two official reference images. These are private local research artifacts, excluded from Git. They may be absent in another checkout. See the [visual audit](../../apps/workbench/.regen/artifacts/design-research-2026-10-09/index.html).

## What is actually wrong

Priority labels below are redesign priorities, not security severity findings.

| Priority | Observed problem | Evidence | Consequence | Proposed correction |
| --- | --- | --- | --- | --- |
| P1 | Returning users encounter onboarding again | Desktop intake occupies 808px; recent reviews start at y=1149. Mobile history starts at y=1244. | Resuming saved work requires scrolling past a full creation form. | Show the project/review library first for returning users. Open creation from one `New review` action. Keep a concise first-run state when no work exists. |
| P1 | Too much space precedes the actual task | Desktop Findings list begins at y=556; only about 344px remain in a 900px viewport. | The app spends most of the first screen orienting and explaining rather than helping the user inspect. | Use a compact shell, project context bar, and one view toolbar. Target list start at or above y=160 on desktop. |
| P1 | Mobile stacks two desktop panes | At 390px, the queue starts at y=822 and the selected issue inspector at y=1142. | Users must scroll to discover what selecting an issue did. | On small screens, opening an issue replaces the list with its detail. Back returns to the same filter, row, and scroll position. |
| P1 | Navigation is temporary state | `ReviewWorkspace` initializes `view` with `useState("overview")`; only the job ID is in the URL. Refreshing Findings returned to Overview in the audit. | A user cannot bookmark a finding or reliably resume a checks/changes view. | Encode section, selected finding, and useful filters in URL state. Validate IDs and preserve legacy `?job=` links. |
| P1 | Actions compete with one another | An issue has a large copy-to-agent panel followed by a separate primary `Draft a fix plan` button. Checks repeats `Run checks` in the project header and view header. | Users must interpret action hierarchy instead of seeing the obvious next step. | One contextual action row: `Copy to agent` plus `Draft plan` when available; download and preview stay in that same area. Use one run-checks entry point per view. |
| P1 | Outcome and process state look too similar | The library shows a green `Review finished` badge even when the selected record has many high-priority findings and no executed checks. | Completion can visually suggest that the project passed. This is a comprehension risk, not evidence of an incorrect backend verdict. | Render process completion neutrally. Display the separately sourced assessment and check coverage alongside it when available. Never derive readiness from job completion. |
| P2 | Issue rows repeat explanations instead of supporting scanning | The first desktop row is 177px high. Rows repeat the same severity explanation; the sample has 26 dependency findings. | Comparing issues becomes slow and repetitive. | Compact rows containing title, priority, location, and evidence type. Show the explanation once in detail. Allow category grouping without merging or discarding original finding IDs. |
| P2 | Technical identifiers dominate project identity | `upload://<opaque-id>/...` occupies a prominent header line and appears again in history. | Implementation details compete with meaningful context. | Show project name and source type in the header; expose exact source ID/path in a copyable details area. Preserve full accessible text for paths. |
| P2 | Secondary navigation is a catch-all | `More tools` mixes external evidence, shared work, source map, and activity. | The destination is difficult to predict before opening the menu. | Give each capability a stable home: Checks → external evidence; Work → tasks/decisions; Files → source map; History → review activity. |
| P2 | Evidence and audit mechanics arrive as paragraphs | Checks displays extensive tool names, skipped-tool explanations, and implementation scope. The sample's page is 1896px high despite having no executed commands. | Source inspection, unavailable tooling, and runtime behavior are difficult to distinguish at a glance. | Group observed source checks, runtime checks, and external evidence. Keep the reason for every missing/limited check one action away; show material gaps in the summary. |
| P2 | Model setup looks like internal configuration | The top navigation exposes Models; its dialog begins with provider availability and requires model IDs and token rates for some providers. | Optional AI setup appears to be part of the main task. | Put connections and spending in Settings. Keep contextual `Connect provider` actions where needed. Retain manual rates until a real provider catalog supports reliable lookup. |
| P2 | Empty states explain but do not help users move | Changes has prose directing the user back to Findings without a direct navigation action. | Extra navigation is required at a moment of uncertainty. | Pair each empty state with the relevant action, such as `Choose a finding`. Explain unavailable capabilities without fake success. |
| P3 | Visual treatment is too uniform | Many separate bordered cards, large corners, repeated uppercase labels, and teal-tinted surfaces receive similar emphasis. Coral action colors sit close to error colors. | The interface feels assembled from components rather than composed around a task. | Use fewer surfaces, quieter navigation, compact headings, and a clear distinction between action and semantic status colors. |

What works and should carry forward: severity sorting and search, the desktop list/detail foundation, genuine source evidence, explicit runtime authorization, local/cloud distinctions, theme support, clipboard fallback, download support, source freshness warnings, and accessible modal focus management. Preserve these behaviors while changing their placement.

## What the reference research supports

These references establish useful patterns. They do not prove that a copied layout or palette will work for PRAXIS.

| Source | Relevant observation | Application to PRAXIS |
| --- | --- | --- |
| [Linear, March 12 2026 design refresh](https://linear.app/now/behind-the-latest-design-refresh) | Navigation and decorative structure should recede so task content has more visual priority. Consistency of headers and action placement matters as a product grows. | Reduce emphasis on chrome and repeated labels; give each action a predictable location. |
| [Linear, March 28 2024 redesign process](https://linear.app/now/how-we-redesigned-the-linear-ui) | The team evaluated different view types and states, defined behavior, and iterated through internal use before broad release. | Review library, findings, checks, work, empty, loading, error, and long-content states together. A good home screenshot is insufficient. |
| [Vercel, January 22 2026 dashboard navigation](https://vercel.com/changelog/new-dashboard-navigation-available) | A sidebar and consistent project/team navigation organize frequently used workflows. Mobile has its own navigation treatment. | Use persistent desktop orientation and a deliberate small-screen interaction model. A sidebar is justified by project switching and multiple work areas, not fashion. |
| [Vercel Geist tabs](https://vercel.com/geist/tabs) | Tabs represent sibling views and should preserve active state through the URL. | Keep review scope explicit; make views and selected findings linkable and restorable. |
| [GitHub Primer layout](https://primer.style/product/getting-started/foundations/layout/) | Split layouts support list/detail work while keeping selection context. Main content and the supporting pane have different jobs. | Use a persistent issue queue beside an evidence inspector on wide screens. Do not stack both panes into a long mobile report. |
| [Sentry issue-details redesign, February 6 2025](https://sentry.io/changelog/new-issue-details-ui-now-available/) | Workflow actions, issue data, and supporting context are organized separately, with drawers for secondary detail. | Give action, evidence, and activity their own areas. Keep technical provenance accessible without placing every field in the main reading path. |
| [Nielsen Norman Group: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Frequently used controls belong up front; secondary content needs a clear, predictable entry point. Excess disclosure levels can also hurt usability. | Replace generic `More tools` and nested information dumps with named destinations. Hiding everything is not the design goal. |
| [Microsoft HAX guidelines](https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/) | Capability and reliability expectations are part of human–AI interaction design. | Keep `Source reviewed`, `Tests not run`, and provider failures clear. Move orchestration details behind the scenes without making stronger success claims. |
| [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) and [focus visibility](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) | Dense controls still need sufficient target size/spacing and unobscured keyboard focus. | Compact desktop rows must retain usable controls; aim for 44px touch targets on mobile. A sticky action bar must not obscure focused content. |

The strongest shared pattern is stable context, a compact work area, a meaningful next action, and details available in context. Decorative dashboards, extra charts, or visible agent graphs do not solve the measured problems.

## Recommended product structure

Use one project workspace for people building with AI, developers, and teams. The core hierarchy should be identical for all three; explanation depth and work allocation can differ when requested.

```text
Desktop
┌─────────────────┬──────────────────────────────────────────────────────┐
│ PRAXIS          │ Project / selected review        Source scope · age  │
│ Project switcher├──────────────────────────────────────────────────────┤
│                 │ View title     Search / filters       Primary action │
│ Overview        ├─────────────────────┬────────────────────────────────┤
│ Findings        │ Finding queue       │ Selected finding               │
│ Checks          │ Title               │ Observed issue and impact      │
│ Work            │ Priority · location │ Source / test evidence         │
│                 │ Evidence type       │ What remains uncertain         │
│ Files           │                     │                                │
│ History         │                     │ Copy to agent · Draft plan     │
│                 │                     │                                │
│ Settings · Help │                     │                                │
└─────────────────┴─────────────────────┴────────────────────────────────┘
Mobile: project bar → current view → list OR selected detail → contextual action.
```

This is a layout proposal, not a new set of backend capabilities. Each destination below must reuse the existing contracts.

### 1. Home and project library

Returning users see saved projects/reviews and a single `New review` action. First-time users see a short `Review a project` state with three source choices. Creation should fit a normal laptop viewport with the chosen source, optional goal, and primary action visible.

The backend already exposes project identity. Use actual `project_id` associations. Existing records without that association remain in a clearly named saved-review group; never infer identity from matching display names, silently link history, or migrate old evidence.

Source import remains upload, local path, or GitHub. Label a browser folder copy accurately; do not promise that a browser picker grants persistent local filesystem access. Desktop native folder selection may prefill the local path through its existing integration. Model review and runtime execution remain optional, explicitly chosen operations.

### 2. Overview

Lead with the current assessment, exact evidence scope, freshness, and the next useful action. Show the highest-priority recorded issues as compact rows and disclose what has not run.

Avoid a generic numerical health score: the current backend does not establish one. Do not replace a missing workflow test with a green global state. Process completion, observed checks, source concerns, and production readiness remain separate concepts.

Offer concise plain-English language without changing evidence strength. Examples: `Tests have not run` instead of a paragraph describing all runtime internals; `Some checks are unavailable` linked to their recorded reasons. A genuine blocker must stay visible.

### 3. Findings

On desktop, use a compact, scrollable queue beside a readable inspector. Keep title, priority, location, and evidence type in the queue; put observed behavior, impact, evidence, and suggested response in the inspector. Retain every underlying finding and its confidence/limits.

Use one contextual action group. `Copy to agent` stays available without a provider. `Draft plan` explains its provider requirement. Preparing, implementing, verifying, and applying remain distinct steps. A “fix available” flag is not proof that an automatic repair will succeed.

On mobile, selected detail replaces the queue and has an explicit back action. Preserve selected finding, filters, and list scroll position. Do not rely on a long scroll to communicate selection.

### 4. Checks

Group source inspection, executed project checks, and external observations. An unavailable tool has its recorded reason; a skipped check has not passed. Prefer a compact outcome list with expandable output over an empty command panel followed by a large tool inventory.

Runtime setup should explain the concrete operation and permissions at the point of execution. Keep local/Docker selection, network choice, budget implications, command preview, and consent. Advanced browser journey definition can have its own focused editor; it should not crowd routine test execution.

### 5. Work, files, and history

`Work` organizes existing plans, proposed changes, shared tasks, decisions, and agent handoffs. A model's report remains an unverified report until independently checked. `Files` exposes the existing source explorer. `History` exposes saved runs and activity with stable links.

Plans and changes need a clear progression: plan → approve handoff → inspect proposed patch → check → explicitly apply/export. Steps unavailable in the current record should explain how to proceed. Do not create operational buttons for unimplemented backend states.

### 6. Settings and AI

Connections, provider status, spending limits, appearance, and local service diagnostics belong in Settings. Show the selected connection only where it affects an action. Keep provider availability distinct from successful authentication, credits, and model quality.

The home page should not ask customers to choose between orchestration modes such as a team or independent model perspectives. Retain expert configuration in a named advanced section while presenting a single understandable optional model review. Any default change needs a documented request/budget contract, not a copy-only rename.

## Visual system proposal

These values are starting hypotheses for a prototype, not findings proved by external research.

- Desktop sidebar: approximately 224px, collapsible. Project/context bar: approximately 56px. View toolbar: 48–56px. Main work content starts within the first 160px at 1440×900.
- Use a full-width workspace for evidence inspection. Constrain prose within the inspector to readable line lengths instead of placing every screen inside a marketing-style centered column.
- Findings queue: roughly 320–400px on wide screens; rows around 64–80px where content permits. Preserve wrapping and accessible names for long paths/titles. Avoid forcing all content into fixed-height clipped cards.
- Page titles: 22–28px; body: 14–16px; secondary metadata: 12–13px. Use the existing Geist family and monospace only for source locations, commands, and identifiers.
- Use neutral light/dark surfaces with subtle elevation. Retain the PRAXIS mascot as a small identity element. Restrict saturated brand color to a few accents; use distinct red/amber/green for evidence status. Test both themes, and preserve saved appearance choice.
- Use one primary action per work area. Avoid repeated tinted explanation cards, decorative badges, oversized empty states, and permanent promotional copy inside the app.
- Motion should explain selection, loading, and completion. Keep transitions brief and respect reduced-motion preferences. No decorative 3D scene is needed for this local workflow.
- Small screens use one working pane at a time, a compact section switcher, and reachable actions. Do not shrink a three-column desktop layout into unreadable controls.

## Backend and frontend mapping

| Proposed area | Existing implementation to preserve/reuse | Work required |
| --- | --- | --- |
| Project library | `/api/projects`, `/api/projects/{id}/status`, `/api/jobs`, `ReviewHistory` | Use persisted identity; preserve unlinked old jobs. Define a bounded summary contract if the list needs assessment data. |
| Routing and shell | `page.tsx`, `AppHeader`, `ReviewWorkspace`, `use-workspace.ts` | Stable section/finding URLs, history handling, preserved filter state, responsive shell. Keep old links working. |
| Findings inspector | `Findings`, `AgentBrief`, existing `Finding` records | Reduce duplication, preserve evidence/confidence, add mobile detail navigation and contextual actions. |
| Checks | `Execution`, `ActionModal`, `RuntimeControls`, `JourneyEditor`, `ExternalEvidence` | Reorganize presentation and setup steps; preserve trust, failure, freshness, and evidence contracts. |
| Work | `Changes`, `SharedWorkspace`, `ProjectWork`, job action endpoints | Group existing actions around user intent; preserve approval, revision checks, cancellation, and apply boundaries. |
| Files/history | `SourceExplorer`, existing event stream and stored jobs | Place in stable destinations; preserve event meaning and source identity. |
| Settings | `ProviderModal`, existing provider/settings endpoints, `Appearance` | Extract into a coherent settings surface without exposing keys or changing budget accounting. |

The current `/api/jobs` list includes basic job metadata, not assessment summaries or finding counts. A richer library must not invent outcome badges or eagerly fetch full evidence for every historical review. Design and test a bounded summary response, or display only established metadata until it exists.

The accepted Option C marketplace remains a separate planned product boundary. This local redesign can leave room in the architecture for it, but should not show seller cards, orders, payments, or a working marketplace destination before those contracts exist. Payment work is outside this redesign.

## Implementation order and acceptance criteria

1. Build and review the shell, returning-user library, and finding/detail layout against real saved records. Use a development-only preview rather than accumulating another layer of global CSS overrides. Keep the existing app usable until the new routes are wired.
2. Implement stable URL state and migrate the real Findings and Overview components into the shell. Validate refresh, back/forward, filter restoration, selected-item focus, and legacy links.
3. Move checks, work, files, history, and settings into their permanent destinations. Preserve all guarded operations and error states. Add a summary API only if needed and only with scoped tests.
4. Consolidate obsolete layout rules after the new components replace them. Preserve functional modules and public contracts. Do not delete user work or old review records.
5. Run the required backend regressions, TypeScript, production build, existing public/source contracts when affected, and full assurance journey. Recheck privacy/package gates if core CLI files change.
6. Evaluate task performance with people from all three user groups before calling the redesign successful.

Proposed measurable gates:

| Test | Target |
| --- | --- |
| Resume a saved review at 1440×900 | At least five review rows visible without scrolling past intake, when five records exist |
| Start a basic review | Source control and start action visible without initial scrolling at 1366×768; no key/Docker setup required for source-only review |
| Inspect findings on desktop | First issue appears at y≤160 in the reference layout; at least six ordinary rows visible at 1440×900 |
| Inspect on mobile | Selecting a row opens detail at the top; Back restores list position; no stacked second inspector below the queue |
| Navigation persistence | Refresh and browser history retain review, section, selected issue, and valid filters |
| Evidence semantics | Completed scan never implies tests passed; stale, missing, failed, and unsupported evidence remain visible and distinct |
| Source safety | Copy/download never mutates source; model handoff, runtime execution, and apply retain their existing explicit authorization |
| Accessibility | Keyboard-only paths, focus return, zoom/reflow, reduced motion, long-content overflow, and light/dark contrast checks pass; automated axe checks supplement manual review |
| Responsive behavior | Review at 320, 390, 768, 1024, 1366, and 1440px; test long titles, paths, errors, and large finding sets |

For a small formative usability study, recruit two people who build with AI, two developers, and two team users. Ask them to resume a project, identify one serious issue and its evidence, explain what has not been tested, copy an agent brief, and locate the authorization for running checks. Observe confusion and recovery without coaching. Proposed pilot targets: five of six complete the core triage/handoff task unassisted; all six distinguish “review finished” from “tests passed.” These are product acceptance targets, not measured results or statistically conclusive research.

## Limits and tooling notes

- The audit covers one real review's loaded data and nine states. The changes view was empty; populated plans, long patches, agent conflicts, provider outages, active streaming, and assistive-technology use need additional state-specific review during implementation.
- No external users were interviewed during this turn. User discomfort is established by the project owner's feedback; broader usability findings are evidence-informed hypotheses awaiting observation.
- The browser-control connector failed to initialize because of its Windows helper. Installed Playwright was used for read-only local screenshots and measurements.
- The requested gstack setup retry reached version `1.91.68.0` but exited 1 because its hook checker refused six TypeScript hook registrations. A direct Bun bundle of one named hook succeeded; the setup failure is not evidence that that hook's TypeScript is broken. No hook validation was bypassed. This did not block the separate design-critique workflow.
- Product source, stored reviews, providers, and backend behavior were not changed by this research pass. The running local services were already present and were left running.
