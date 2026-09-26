---
description: Launch PRAXIS's local project review and repair workbench
---

The full local review-and-repair application lives at `apps/workbench` in the
PRAXIS source checkout. Start with `npx -y praxis-memory workbench --check --json`.
If the installed CLI cannot locate the checkout, use `--path` with the absolute
`apps/workbench` directory. Read `docs/WORKBENCH-INTEGRATION.md` there for setup.
If the installed CLI does not yet include this unreleased command, use
`node <checkout>/src/cli.js workbench --check --json` from the local checkout.

Launch using `npx -y praxis-memory workbench` (with `--path` if needed), or
`npm run dev` from the PRAXIS checkout. Its interface is at http://127.0.0.1:3000.
Scans use the selected external model provider. Starting services alone does not
spend tokens. Preserve the app's explicit confirmation for project execution and
source application. Do not run live-provider pressure tools automatically.

Keep the existing `praxis demo`, `praxis deck`, memory, and receipt workflows.
Workbench job evidence is not automatically a PRAXIS signed receipt.
