# PRAXIS Receipt Format — v1

A **receipt** is the proof-of-work record of one AI coding session: what the
agent actually did, what it claimed, and whether those claims held up. It is a
hash-chained, Ed25519-signed JSONL file that lives in the project at
`.praxis/receipts/`, written locally, never uploaded.

This document specifies the on-disk format so that anything — a CI step, a PR
bot, another tool, a human with `jq` — can read and verify a receipt without
PRAXIS installed. The format is the contract; the intelligence that fills it is
swappable.

## Design goals

1. **Tamper-evident, not tamper-proof.** Every line is chained to the one
   before it; the final line is signed. Nothing after sealing can be edited,
   inserted, or dropped without breaking the chain. It is *not* third-party
   proof: the keyholder signs their own receipts. What it proves is that the
   record you are reading is the record that was written at the time.
2. **Deterministic evidence, honest verdicts.** Evidence comes from the session
   transcript by pure functions — same input, same record. Judgments (an LLM
   ruling claims TRUE/FALSE) are optional, clearly attributed, and never
   fabricated: a receipt with no judge run says `UNVERIFIED`, not `VERIFIED`.
3. **Local-first.** Receipts are files in your repo's `.praxis/` directory
   (gitignored by default). Sharing one is your choice, one file at a time.

## File layout

```
.praxis/receipts/
  r-1a2b3c4d.jsonl        # version 1 of receipt r-1a2b3c4d
  r-1a2b3c4d.v2.jsonl     # version 2 (a resumed session after sealing)
  r-9f8e7d6c.jsonl
```

- **Receipt id** = `r-` + first 8 hex chars of `sha256(sessionId)`. Derived,
  never random: the same session always maps to the same receipt, so retro
  capture and the session-end hook cannot double-create.
- **Versions.** A sealed receipt is immutable. If the same session produces
  more work (a resume, a later verify run), a **new version file** is opened
  with a `parent` pointer. History is only ever appended, never rewritten.

## Entries

A receipt file is JSONL: one JSON object per line, in write order. Three entry
types:

### 1. `open` — always the first line

```json
{"t":"open","v":1,"id":"r-1a2b3c4d","version":1,"sessionId":"<session>","project":"my-app","baseRef":null,"parent":null,"openedAt":"2026-07-24T10:00:00Z","hash":"…"}
```

`v` is the format version (this spec: `1`). `parent` names the prior version
(`"r-1a2b3c4d.v1"`) when `version > 1`.

### 2. `evidence` — zero or more

The deterministic record of what the agent did, harvested from the session
transcript:

```json
{"t":"evidence","channels_harvested":["Bash","PowerShell"],"completeness_note":"…","commands_run":[{"channel":"Bash","command":"npm test"}],"files_edited":["src/auth.js"],"git_activity":[…],"test_activity":[…],"build_activity":[…],"counts":{…},"hash":"…"}
```

Iron rules the collector obeys (each learned from a real false accusation):

- **Every command channel is harvested** — any tool call carrying an
  `input.command`, whatever the tool's name. Reading only `Bash` once caused a
  real session's PowerShell `git push` to be missed and the agent falsely
  accused.
- **`completeness_note` declares the limits.** Absence of an action in the
  record means "not in the harvested channels", never "did not happen".
  Verdicts must map absence to `UNVERIFIABLE`, never `FALSE`.
- **Commands are never truncated.** Secrets are redacted; length is preserved
  (a cut-off `… && git push` tail once flipped a verdict).
- **Session-scoped attribution.** Evidence is this session's tool calls only.
  Repo-global state (git log) may appear only marked `"shared": true`, and may
  not be cited as proof against a session-scoped claim.

### 3. `final` — always the last line of a sealed receipt

```json
{"t":"final","verdict":"VERIFIED","claims":[{"claim":"all tests pass","verdict":"TRUE","evidence_cited":"npm test","reasoning":"…"}],"finalizedAt":"…","hash":"…","sig":{"alg":"ed25519","key":"<16-hex fingerprint>","signature":"<base64>"}}
```

Headline `verdict` is one of:

| Verdict | Meaning |
|---|---|
| `VERIFIED` | every extracted claim ruled TRUE against the evidence |
| `CLAIMS_FAILED` | at least one claim contradicted by the evidence |
| `PARTIAL` | no failures, but some claims could not be confirmed |
| `NO_CLAIMS` | the agent made no factual work-claims |
| `UNVERIFIED` | evidence sealed; no judge has ruled the claims |

Per-claim verdicts are `TRUE`, `FALSE`, `UNVERIFIABLE`, or `NOT_A_CLAIM`. A
`FALSE` requires *contradicting* evidence, cited; absence alone is never
`FALSE`.

## Hashing and signing

- **Canonical form.** Before hashing, an entry's payload (everything except
  `hash` and `sig`) is serialized with keys sorted at every level
  (`stableStringify`), after redaction — so what is hashed is exactly what is
  stored.
- **Chain.** `hash = sha256hex(prevHash + stableStringify(payload))`, with
  `prevHash = ""` for the first line. Any edit to any line changes every hash
  after it.
- **Signature.** Sealing signs the chain-head hash with the machine's Ed25519
  key: `sig.signature = base64(ed25519_sign(hex_decode(final.hash)))`. Because
  the head hash transitively covers every prior line, one signature seals the
  whole file.
- **Key.** Generated lazily at first seal, stored at `~/.praxis/keys/`
  (`ed25519.pkcs8.pem` / `ed25519.spki.pem`, override dir with
  `PRAXIS_KEY_DIR`). Created with an exclusive-create so concurrent first
  sealers cannot fork the key. `sig.key` is the first 16 hex chars of
  `sha256(spki_der_hex)` — enough to spot a key mismatch.

**Verifying** a receipt = recompute every chain hash in order, then check the
final signature against the public key. PRAXIS does this with
`praxis receipt` (integrity line) and the `praxis_verify` MCP tool, but the
algorithm above is the spec — any implementation can do it.

## Crash and failure semantics

- A crash mid-append leaves a torn last line; readers drop it (every complete
  line is valid JSON, a torn one is not) and the chain remains valid up to it.
- Appending to a sealed receipt is rejected; callers open the next version.
- If the judge is unavailable (timeout, no model, no network), the receipt
  seals `UNVERIFIED` with the evidence intact. **A verdict is never invented.**
- Receipt recording is a bonus on the session-end path: any failure is
  swallowed and the user's session is never broken.

## Privacy

- Redaction runs **before** hashing and writing — secrets never touch disk.
- Receipts stay on the machine. Nothing is transmitted. `.praxis/` is
  gitignored by default; sharing a receipt (or its rendered HTML card) is an
  explicit, per-file act.

## Judge independence

The verdict layer is only worth something if the grader is not the graded.
These are architectural rules, not implementation details:

1. **The judge is a separate process with a fresh context.** It never shares a
   conversation, cache, or working directory with the agent that did the work.
   It runs in a neutral directory precisely so its own session can never be
   mistaken for project work.
2. **The agent's narrative is never evidence.** The judge receives two inputs,
   explicitly labeled: the deterministic evidence record (harvested from the
   transcript by pure code — the agent has no hand in writing it) and the
   agent's claims, wrapped in untrusted-data markers. The claims are the thing
   *on trial*; the deterministic record is the only witness. A confident
   summary cannot rubber-stamp itself, because a `FALSE` or `TRUE` verdict must
   cite the deterministic record verbatim.
3. **The judge is swappable — and cross-vendor judging is encouraged.** The
   judge command is injectable (`PRAXIS_JUDGE_CMD`, any CLI that reads a prompt
   and returns JSON). Let one vendor's model do the work and a different
   vendor's model rule the claims; the receipt format doesn't care.
4. **Honest limit:** a judge from the same vendor as the worker shares that
   vendor's blind spots. Same-vendor judging is still meaningful (fresh
   context, adversarial instructions, cited-evidence requirement), but for
   adversarial assurance, use a different vendor — and remember the
   deterministic evidence layer is the backstop that no model, judge or
   worker, gets to edit.

## Evaluating a judge

A judge model earns the right to issue verdicts by passing the eval suite —
the iron rules above rewritten as behaviors (`test/fixtures/eval-scenarios.mjs`):
a supported claim is never FALSE; a denial is contradicted by the recorded
attempt; absence yields UNVERIFIABLE; a "command was blocked" claim survives
the attempt appearing in the record; injected instructions inside the claim
data flip nothing; the untruncated command tail counts; the second channel
counts.

Run it against any judge:

```
node test/fixtures/eval-run.mjs        # grades whatever PRAXIS_JUDGE_CMD points at
```

The bar is asymmetric on purpose: **zero false accusations** (every forbid
rule at 100%) is non-negotiable — a verifier that falsely accuses once is
worse than no verifier — while the allowed-set rate tolerates reasonable
strictness differences (TRUE vs UNVERIFIABLE while command outcomes are
unpaired). Judge-prompt changes must show a before/after scorecard and may
never regress the false-accusation floor.

## How receipts get written

| Surface | When | Cost |
|---|---|---|
| session-end hook | automatically, on Stop | evidence only — zero model calls |
| `praxis_receipt` MCP tool | the model calls it itself (e.g. before saying "done"); `verify:true` runs the judge | opt-in model call |
| `praxis receipt --verify` | a human asks for a ruling now | opt-in model call |

All three call the same recording path; a receipt is identical no matter who
triggered it.
