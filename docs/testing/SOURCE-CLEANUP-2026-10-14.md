# Source cleanup and pre-push review — 2026-10-14

## Scope and method

Reviewed the Git inventory, CLI entrypoints, Workbench app routes and imports,
desktop packaging, website generation, manifests, workflows, documentation,
tests, and public asset references. The import audit parsed 310 JavaScript and
TypeScript files and 101 Python files. Python syntax checks found no errors;
no remaining Workbench component/library or backend engine module was identified
as unreferenced by the corresponding source import audit.

The desktop supervisor's two adjacent service imports are generated runtime
files: `develop.mjs` and `prepare-runtime.mjs` copy the canonical implementations
from `src/lib`. They are not missing source modules.

Static reference analysis cannot establish that every possible file is used.
CLI commands, subprocess entrypoints, framework routes, tray assets, manually
invoked test tools, imported sample projects, and receipt fixtures have contracts
beyond ordinary imports. Those were retained rather than deleted on an import
count alone.

## Removed

- `apps/workbench/components/InspectionIllustration.tsx`: no runtime importer;
  the current project home replaces the earlier introductory panel.
- `apps/workbench/components/PriorityFinding.tsx`: no runtime importer;
  `ReviewOverview` renders the first finding directly.
- `apps/workbench/components/StatusBar.tsx`: no runtime importer;
  the header and project controls already provide its actions and service state.

Removed their exclusive CSS and obsolete smoke-test selector, while keeping
shared agent-brief styles. Updated documentation references and the README's
surface map, desktop release boundary, and actual 3.85 MiB package budget.

## Pre-push privacy review

The public index excludes environment credentials, local memory, review jobs,
personal vaults, private brand masters, dependency folders and generated builds.
The separate local Unreal directory and Blender working file remain on disk;
root-anchored ignore rules and a tested privacy-guard rule now prevent accidental
staging of those experiments.

Scanned indexed text for known provider-token formats and private-key markers,
and changed text files for long quoted credential assignments. Hits were
synthetic redaction/security fixtures and an unrelated documentation URL.
No live credential was identified by these checks. Pattern scanning does not
guarantee the absence of every possible secret format.

## Executed verification

| Gate | Observed result |
| --- | --- |
| Core regressions | 593 tests: 586 passed, 7 opt-in live-judge skips, 0 failures |
| Workbench backend | 322 tests: 319 passed, 3 environment/opt-in skips, 0 failures |
| Workbench presentation/navigation tests | 23 passed |
| Desktop contract tests | 14 passed |
| TypeScript and Workbench production build | Passed |
| Rendered assurance workflow | Passed: authentication, consent, persisted backend change, false-success rejection, uploads, source map, agent handoff, responsive layout |
| Verify golden evaluation | 5 passed; CONTRADICTED recall 1.00 and precision 1.00 on this dataset |
| Installed package and receipt smoke | 9/9 passed, including real Git true/false cases and Ed25519 validation |
| Website generation | Passed |
| Release metadata and package contents | Passed; 270 packed files, 3.81 MiB of 3.85 MiB budget |
| Indexed privacy and whitespace checks | Passed |

The managed readiness command correctly reported an unprepared dedicated home.
The existing default home was refused because it contains unrelated files;
no existing home data was removed or migrated.

These results cover the local Windows checkout and specified fixtures. They do
not establish live-provider quality, every external MCP account, signed desktop
installation, cross-platform runtime behavior, or production scale. Existing
release limitations in `QA-2026-10-12.md` remain applicable. This push publishes
source, not an npm release or a production-readiness certification.
