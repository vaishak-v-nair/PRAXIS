# PRAXIS frontend rebuild

Research and implementation brief, 29 September 2026. Scope: the active local
Workbench application. Backend contracts, core CLI, historical evidence and
the separate public website/Live demo are preserved.

## Research translated into product decisions

| Source | Observation | Decision for PRAXIS |
| --- | --- | --- |
| [Linear triage](https://linear.app/docs/triage) | Review and prioritize incoming issues before acting. | A filterable findings queue with an adjacent evidence inspector; severity and confidence remain distinct. |
| [GitHub code scanning](https://docs.github.com/en/code-security/concepts/code-scanning/code-scanning-alerts) | Alerts retain source context and related paths. | Each finding exposes file, line, evidence, impact and remediation together. |
| [Cursor reviewing/testing](https://cursor.com/learn/reviewing-testing) | Plausible code and passing tests still need review; reviewable changes matter. | Separate findings, runtime results and patch review. Never label an AI suggestion proven. |
| [Snyk prioritization](https://snyk.io/solutions/risk-based-prioritization/) | Prioritization makes large finding backlogs actionable. | Severity ordering and local search, without inventing reachability or business-risk scores. |
| [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Secondary controls can be deferred until needed. | Source first; execution and model options in explicit review scope controls. |
| [Geist table](https://vercel.com/geist/table) and [skeleton](https://vercel.com/geist/skeleton) | Real data, aligned numbers and distinct loading/empty states aid scanning. | Searchable review history, tabular metrics, loading feedback and useful empty-state actions. |
| [W3C reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) | Content must remain usable at narrow widths. | Mobile-first single-column flow, bounded code scrolling, no page overflow at 320px. |
| [W3C status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) and [modal dialogs](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Asynchronous feedback and focus behavior need explicit semantics. | Announced task status, native modal focus management, keyboard controls and descriptive labels. |

These are design inferences from published guidance, not user interviews or
proof of demand. Vendor claims about their scanners are not PRAXIS capabilities.

## Fresh design

Graphite surfaces, warm amber primary action, high-contrast text, restrained
rounding, system sans typography and monospace source metadata. The interface
is a working engineering tool: no decorative hero, simulated agents, invented
scores or static sample results. Three.js is loaded only inside the source-map
view; file relationships remain usable without WebGL.

## Architecture and acceptance

- `lib/`: API contracts, upload encoding, request handling, job lifecycle.
- `components/`: composable intake, workspace, findings, checks, changes,
  source map and dialogs. No old presentation components or old CSS retained.
- Backend remains authoritative. SSE plus bounded polling reconnects safely;
  stale requests cannot replace another selected project. URL job selection
  supports reload and browser history.
- Preserve folder/GitHub/upload intake, scope/trust gates, cancellation, budget
  extension, model settings/probe, repair selection, patch/zip export and
  confirmed source apply.
- Upload progress remains visible across resumable batches, including accepted
  bytes and excluded-file counts. Intake presents one complete review contract:
  bounded local inspection, all configured provider challenges, and authorized
  Docker checks. Runtime trust and network access remain explicit boundaries.
- A repair starts with a source-aware plan. The Changes view shows ordered
  steps, real file targets, validation, risk, unresolved questions and the
  delivery contract before a repair agent can edit the isolated workspace.
- Validate production build, TypeScript, backend regressions and real browser
  flows. Exercise unavailable service, empty history, failed requests, actual
  passing/failing Docker checks, mobile layouts, keyboard dialogs and no-WebGL.
