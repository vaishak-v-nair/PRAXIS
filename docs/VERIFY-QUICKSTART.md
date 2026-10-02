# PRAXIS Verify v1 quickstart

> Your agent said it was done. This is the receipt that checks.

Run this from the repository containing the agent's commit:

```powershell
npx praxis-memory verify
```

With no flags, PRAXIS selects the latest commit whose author or commit message identifies a supported AI coding agent. If no such metadata exists, it uses `HEAD`. The selected commit message is the completion report and task context. PRAXIS calls Claude with a fixed structured-output schema, binds every accepted claim to the exact base/head commits and trees, runs static verification, and writes a separate Ed25519-signed Verify receipt. There is no PRAXIS account or project configuration.

The package published by this repository is `praxis-memory`. A global or local
installation also provides the `praxis` alias:

```powershell
praxis verify
```

## Explicit input

```powershell
praxis verify --task "Add rate limiting to /login" --report agent-final-message.txt
praxis verify --task-file issue.txt --report agent-final-message.txt
praxis verify --task "Update the docs" --claim "Updated README.md"
praxis verify --task-file ticket.txt --manifest claims.json
```

Reports use Claude extraction by default. PRAXIS uses `ANTHROPIC_API_KEY` with the Anthropic Messages API when available, otherwise it uses an existing authenticated `claude` CLI. If the default CLI extractor is unavailable, a labelled conservative local parser keeps specific file claims checkable and leaves unsupported behavior unproven. Explicitly configured extractor failures fail closed. API and command extraction have a 20-second default wall-clock limit, configurable up to 45 seconds with `PRAXIS_VERIFY_EXTRACT_TIMEOUT_MS`. `PRAXIS_VERIFY_EXTRACTOR_CMD` remains available as a JSON argv array for controlled testing and compatible local adapters. The prompt and JSON schema live together in `src/lib/verify/extract.js`. Every successful extraction is logged locally under `.praxis/verify/extractions`; report text is represented by a digest and validated claims.

The unrelated registry package named `praxis` belongs to another project.
Do not use `npx praxis verify` as a fresh-install command; use the published
package name above. Cold download time depends on network/cache availability.

Use `--preview-claims` when you want extraction without verification:

```powershell
praxis verify --task-file issue.txt --report agent-final-message.txt --preview-claims
```

## Verdicts

Each claim receives exactly one state:

- `VERIFIED`: direct static evidence or coverage-backed dynamic evidence establishes the claim.
- `CONTRADICTED`: direct evidence disproves the claim, including a missing claimed path or a ReGen false-success pattern.
- `UNSUPPORTED`: available evidence is insufficient.
- `NEEDS_HUMAN_REVIEW`: independent direct checks conflict.

A passing command or CI result is supporting evidence. It cannot produce `VERIFIED` by itself.

## Trusted dynamic checks

Static mode never executes project code. Dynamic checks require a committed, reviewed policy:

```json
{
  "schema": "praxis.verify.trust/v1",
  "commands": [
    {
      "id": "tests",
      "argv": ["npm", "test", "--", "--coverage"],
      "evidence": "test-result",
      "claimIds": ["login-rate-limit"],
      "coverageFile": "coverage/coverage-final.json",
      "timeoutMs": 120000
    }
  ],
  "allowedEnv": [],
  "network": "not-guaranteed-denied"
}
```

```powershell
praxis verify --task-file issue.txt --report agent-final-message.txt --mode trusted --trust-policy praxis-verify-trust.json
```

Trusted mode runs argv without a shell in a temporary detached worktree, strips secrets from the environment, bounds time and output, and terminates process trees on timeout. It is controlled host execution, not an operating-system sandbox.

Test success becomes direct evidence only when the supplied Istanbul or coverage.py JSON shows execution of every claimed changed path. A CI result remains supporting evidence.

## Receipt

Verify receipts are separate from every historical PRAXIS receipt format:

```text
.praxis/verify/receipts/v-<id>.json
.praxis/verify/signing/ed25519-public.pem
.praxis/verify/signing/ed25519-private.pem
```

The signed payload includes the task, commit and tree range, atomic claims, per-claim verdicts, observations, verifier version, timestamp, and public key. It uses an Ed25519 public signature. Existing receipt files and their validation behavior are not modified or relabeled.

## Exit codes

| Code | Meaning |
|---:|---|
| 0 | all claims verified and scope complete |
| 1 | at least one claim contradicted |
| 2 | invalid or ambiguous input |
| 3 | unsupported/review-required claim or incomplete scope |
| 4 | infrastructure or signing failure |
| 130 | cancellation |
