# Publish PRAXIS manually

Release candidate: **praxis-memory 0.14.2**. Version 0.14.1 is already on npm;
published versions cannot be overwritten. This setup does not publish anything.
Use the full source checkout for release work, not an installed npm copy.

## Prepare and check

From `E:\BrosKi\PRAXIS` with Node 22+, Python 3.11+, and Git:

```powershell
npm ci --ignore-scripts
npm ci --prefix apps/workbench --ignore-scripts
python -m venv apps/workbench/.venv
apps/workbench/.venv/Scripts/python.exe -m pip install -r apps/workbench/backend/requirements.txt
apps/workbench/.venv/Scripts/python.exe -m pip check
apps/workbench/.venv/Scripts/python.exe -m playwright install chromium
npm run release:check
```

On macOS/Linux substitute `apps/workbench/.venv/bin/python`. Core CLI users
do not need these development dependencies; these commands prepare the release
gates, golden evaluations and optional app. Do not run setup while the same
Workbench environment is serving an active job.

`release:check` checks version/lockfile/release notes, actual packed paths and
the 3.85 MiB package budget, the public registry's immutable version list,
core regressions, installed-package smoke, historical and Verify receipts,
Promptfoo's CONTRADICTED recall/precision gate, backend tests, TypeScript,
production build, rendered true/false workflow and high/critical production npm
advisories. Install the Workbench Playwright Chromium runtime before the browser
gate; on Linux use its `playwright install --with-deps chromium` command. It stops on
failure. It makes no paid model call and does not apply source patches.
Network access is needed for registry and audit checks. Missing release
tooling fails honestly; tests are never skipped to publish.

The production dependency audit and development-tooling audit have different
scopes. The 2026-10-07 full Workbench audit is clear. The root development
tree still reports three high entries from one unpatched dependency chain,
`promptfoo -> jks-js -> node-forge@1.4.0`
([upstream issue](https://github.com/digitalbazaar/forge/issues/1149),
[proposed fix](https://github.com/digitalbazaar/forge/pull/1152)). This dependency
does not enter the dependency-free CLI or bundled Workbench runtime. No advisory
is suppressed, no signature library is stubbed, and no forced Promptfoo
downgrade is applied. Recheck the full development audit when a vendor patch is
published. The golden gate uses the project-owned provider rather than JKS
certificate inputs; that boundary is not a claim that every Promptfoo provider
is safe. PRAXIS receipt signatures use Node's built-in Ed25519 implementation.

Native desktop artifacts have a separate build and release gate. They never
enter the npm tarball. See [desktop delivery](../apps/desktop/README.md); signed
clean-install evidence is required before offering a public installer.

Review the final package before publishing:

```powershell
npm run release:metadata
npm pack --dry-run
git status --short
```

The package includes CLI, optional Workbench source, launcher and setup docs.
It excludes local credentials, `.praxis`, `.regen`, virtual environments,
installed dependencies, generated builds, private brand/vault material and
sample repositories. A successful gate validates its recorded scope,
not every model/provider or production user journey.

## Publish from your terminal

Use your npm account that owns or can publish `praxis-memory`; complete npm's
browser login and required two-factor challenge yourself. Do not put an npm
token in this repository or in the application's `.env`.

```powershell
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish --access public --registry=https://registry.npmjs.org/
npm view praxis-memory@0.14.2 version dist.integrity --registry=https://registry.npmjs.org/
```

`npm publish` runs `prepublishOnly`, which repeats the full gate before upload.
Publishing advances `latest`; do not add `--ignore-scripts` to bypass the gate.
For the next release, bump package and lockfile together with
`npm version patch --no-git-tag-version --ignore-scripts`, add dated release
notes, and run the checks again. Review and commit only intended source files,
preserving existing work and privacy.

## Optional manual GitHub release with provenance

The **Manual npm release** workflow has only `workflow_dispatch`; pushing
a version tag alone does not publish. Once you have reviewed and pushed your
release commit and matching tag, choose that tag in Actions and run the workflow.
It validates the same checkout on the configured OS/Node matrix, runs golden
and Workbench gates, and uses the existing `release` environment control point.

Configure npm's trusted publisher as `vaishak-v-nair / PRAXIS / release.yml /
release` and the GitHub environment yourself before selecting this route.
Those external settings were not changed or verified by this audit. Trusted
publishing needs npm 11.5.1+ and Node 22.14+; the workflow uses Node 24/npm 11.
Local terminal publishing does not create a CI OIDC provenance attestation.
Choose one route for a version, since it can be published only once.

Sources: [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/),
[manual public publishing and 2FA](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/),
[trusted publishers](https://docs.npmjs.com/trusted-publishers/).
