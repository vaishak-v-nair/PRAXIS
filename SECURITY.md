# Security Policy

PRAXIS produces evidence people are asked to trust. A vulnerability here is not
a bug in a utility — it is a hole in a proof. Reports are taken seriously and
answered by a human.

## Reporting a vulnerability

**Use GitHub's private vulnerability reporting** — the "Report a vulnerability"
button under [Security](https://github.com/vaishak-v-nair/PRAXIS/security).
It is private between you and the maintainer until a fix ships.

Please do **not** open a public issue for a security problem.

**What to expect:**

| | |
|---|---|
| Acknowledgement | within **72 hours** |
| First assessment | within 7 days, with a severity and a plan |
| Fix or mitigation | tracked publicly once a patch is released |
| Credit | your name in the release notes, unless you prefer otherwise |

This is a solo-maintained project. The 72-hour number is a real commitment, not
an enterprise SLA — if it slips, you will hear why rather than hear nothing.

## Supported versions

Only the **latest minor line** receives security fixes. Fixes ship as a patch
release on that line.

| Version | Supported |
|---|---|
| latest minor (0.10.x) | ✅ |
| anything older | ❌ — upgrade; `npx -y praxis-memory` always fetches current |

## In scope — what we most want to hear about

These are the attack classes that matter for a trust product, and the ones we
red-team ourselves before each launch:

1. **Judge manipulation.** Any way to make the claim judge return a verdict the
   evidence does not support — especially prompt injection carried inside a
   transcript, a claim, or a filename. A judge that can be talked out of a
   verdict is worthless.
2. **Chain or signature forgery.** Editing, inserting, reordering, or dropping a
   line in a sealed receipt without breaking verification. Also: anything that
   makes `praxis receipt` report `VERIFIED` for a record that was altered.
3. **Redaction bypass.** A secret shape that survives redaction into a receipt,
   a memory file, an exported receipt, or a vault note. Redaction is
   best-effort by design — but a *systematic* bypass is a real finding.
4. **The local HTTP surface.** `praxis deck`, `praxis approve` and the Governor
   bind to localhost with a per-launch token. DNS rebinding, CSRF, missing
   Origin/Host validation, or token leakage against that surface are in scope —
   this is the one component with execute authority.
5. **Job execution escape.** Anything that lets a queued job run without human
   approval, or run outside the directory it was scoped to.
6. **Supply chain.** Anything about the published tarball, the release workflow,
   or provenance attestation that would let a third party ship code as PRAXIS.

## Out of scope

- The honest limits already documented in
  [RECEIPT-SPEC.md](RECEIPT-SPEC.md): receipts are **tamper-evident, not
  third-party proof** — the keyholder can sign their own receipts, and a fresh
  key can fabricate a corpus. That is a stated boundary, not a vulnerability.
  Third-party countersigning is roadmap.
- Findings that require an attacker who already has write access to your
  machine, your repo, or your `~/.praxis/keys` directory.
- Missing hardening in the agent CLIs PRAXIS drives (report those upstream).
- Denial of service against your own machine by your own configuration.

## Our own posture

- **Zero runtime dependencies.** Every dependency is attack surface, and a
  receipt you cannot audit is not evidence. This is a hard rule, not a
  preference.
- **Redaction runs before hashing**, so what is signed is what is stored.
- **Releases publish from CI via npm trusted publishing (OIDC)** with provenance
  attestation and a human approval gate. No long-lived npm token exists.
- The judge runs in a separate process with a neutral working directory and
  cannot be steered into reading your repository.
