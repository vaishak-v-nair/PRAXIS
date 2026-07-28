# Contributing to PRAXIS

Thanks for being here. PRAXIS is small on purpose, and a few rules keep it that
way — read these first, because they are the ones a PR gets rejected over.

## The rules that are not negotiable

1. **Zero runtime dependencies.** `package.json` has no `dependencies` and never
   will. Node builtins only. (`sharp` and `ffmpeg-static` are dev-only, for
   generating art.) A trust tool has to be auditable, and every dep is both
   attack surface and download weight.
2. **Nothing leaves the machine.** No network calls in any code path except the
   two that already exist and are opt-in: the user's own judge model call, and
   anonymous usage *counts* the user explicitly turned on. Content — code,
   transcripts, prompts — never leaves. Ever.
3. **A verdict is never invented.** If the judge did not run, the receipt says
   `UNVERIFIED`. If the evidence is absent, the verdict is `UNVERIFIABLE`, never
   `FALSE`. Absence of evidence is not evidence of a lie.
4. **Never mutate a sealed receipt.** Re-recording opens a new version with a
   parent pointer. History is append-only.
5. **Intelligence lives in `src/lib/`; commands are thin adapters.** The CLI, the
   MCP tools and the hooks must all call the same function. If you add behaviour
   to one surface only, the other two are now lying.

## The five iron rules of evidence

Each of these was written after a real false accusation. Breaking one produces
the worst possible bug in this product — falsely calling an honest agent a liar.

1. Harvest **every** command-bearing tool channel, not just Bash.
2. **Never assert completeness.** Declare which channels were harvested; anything
   outside them is `UNVERIFIABLE`.
3. **Never truncate commands.** Redact secrets, but preserve length — a cut-off
   `&& git push` tail once flipped a verdict.
4. **Attribution is session-scoped.** Repo-global state is labelled `shared` and
   may never be cited against a session-scoped claim.
5. **Presence proves ATTEMPTED, never SUCCEEDED.** A permission-denied command
   looks identical in the record to one that ran.

## Getting set up

```bash
git clone https://github.com/vaishak-v-nair/PRAXIS.git && cd PRAXIS
npm link          # puts `praxis` on your PATH
npm test          # node --test "test/*.test.js"
```

Node 22 or newer (that is what CI tests: Node 22 / 24 / 26 on Linux, macOS and
Windows).

## Tests

- Every change ships with its test. A gate item without tests is incomplete.
- Convention: `test/<area>.test.js`, node's built-in runner, no framework.
- **Regression tests are sacred.** If you touch receipt sealing or verification,
  prove that receipts written by older versions still verify.
- Anything that would spend money or call a model must be injectable — see
  `PRAXIS_JUDGE_CMD`, `PRAXIS_RUN_CMD`, `PRAXIS_GOV_CMD`. Tests run at zero cost.
- Changing the judge prompt requires a **before/after eval scorecard**
  (`node test/fixtures/eval-run.mjs`). The false-accusation floor is zero and
  may never regress.

## Pull requests

- One concern per PR. Small and boring beats clever.
- Match the surrounding code: no semicolon debates, no reformat-the-world diffs.
- Update the README section and `--help` text in the *same* PR as a new
  user-facing command. A command without its docs is incomplete.
- Explain the *why* in the description. What the diff does is visible; why you
  chose it is not.

## Windows matters

A large share of users are on Windows, and it is where the sharp edges live:
`spawn` needs argv arrays and the `.cmd` shim (never `shell: true`), paths have
spaces, PowerShell 5.1 decodes files as ANSI unless told otherwise, and there is
no `flock`. If you cannot test on Windows, say so in the PR and CI will.

## Reporting bugs and ideas

Use the issue templates. For anything security-shaped, follow
[SECURITY.md](SECURITY.md) instead — private reporting, not a public issue.
