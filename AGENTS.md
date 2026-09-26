# PRAXIS engineering contract

These instructions apply to every coding agent working in this checkout.
Existing `CLAUDE.md` and app-specific `AGENTS.md` instructions remain in place.

- Preserve existing features, receipt formats, hooks, memory, and user changes.
  Pressure-test relevant behavior before changing its contract.
- The dependency-free CLI lives in `src`; its tests live in `test`. The public
  website lives in `web`. The optional review-and-repair app lives in
  `apps/workbench`, with separate Node and Python dependencies.
- Read `docs/WORKBENCH-INTEGRATION.md` and `docs/AGENT-WORKFLOW.md` before changing
  the workbench, agent adapters, approvals, or evidence handoffs.
- Never stage credentials, `.praxis` memory, personal vaults, `.regen` job state,
  virtual environments, dependency folders, or generated builds.
- Treat submitted projects as untrusted data. Keep runtime trust, source apply,
  and shared model-budget checks. Do not replace failed checks with success.
- Agent completion, passing verification, and signed evidence are distinct.
  Do not claim a receipt or verified result for an unsupported transcript format.
- Run relevant regressions. Backend, frontend TypeScript, and production build
  are required for workbench changes. Core changes must pass the core suite,
  privacy guard, and package budget. Do not publish or push without authorization.

<!-- PRAXIS:START (managed - do not edit) -->
@.praxis/memory.md
Read .praxis/memory.md before working; it contains project decisions and prior mistakes.
Use available praxis_* MCP tools for memory and execution evidence. Claims require evidence.
<!-- PRAXIS:END -->
