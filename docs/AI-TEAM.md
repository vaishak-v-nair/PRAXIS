# People and AI teams in one project review

The **Workspace** tab adds a shared local discussion for people and agents.
Contributor sessions can post goals, questions and decisions addressed to the
team or a specialist. Another browser on the same computer sees the saved notes
through the existing live job stream. Names are labels, not authenticated
identities, and this does not expose the API on the LAN or the public Internet.

Notes stay local by default. Only notes explicitly marked **Share this note
with configured models** enter the bounded context of the next agent round.
Notes addressed to a specialist reach that specialist; team notes reach all roles.
Use **Ask agents to review shared notes** for an explicit new source-review
round, sharing the remaining job budget and without running project commands.
Human notes never grant runtime, source-apply, merge or credential permissions.
After proposed fixes, use a fresh review rather than mixing source snapshots.
The local discussion is bounded to 100 notes and 16 contributor sessions per
review. Remote invitation and authentication are a separate deployment boundary.

The import provenance manifest and duplicate checkout setup README remain in
Git. The consumer download retains its required workflow and setup guides.

PRAXIS now supports `review_mode: "team"` alongside the existing standard,
deep and ultra modes. The local interface defaults to the team; **What this
review includes → Review approach** retains independent model perspectives.
An optional plain-text project goal focuses review without executing instructions.

Four specialist roles inspect the same isolated, redacted source snapshot:
user journey, reliability, security and production architecture. They use the
existing configured model adapters in a bounded four-worker pool. Providers
are assigned in their configured order and may be reused when fewer than four
are configured. Four roles do not mean four different models or four people.

Each specialist retrieves actual relevant source with the existing bounded
file/function context reader. Their findings pass the existing real-path,
line, nearby-snippet and raw Python syntax checks. Their validated hypotheses
are then exchanged in a second round. Peer comments must reference an exchanged
finding ID and a real source snippet. Invalid comments are discarded. Supporting
or challenging a hypothesis cannot promote it to verified execution or erase it.

The board streams real inspection and peer-review states through the existing
job event transport. Partial findings, coverage and discussions are persisted
as they arrive, including on provider failure or shared-budget exhaustion.
Cancellation reaches the existing provider cancellation checks. In-flight HTTP
requests still finish or reach their existing bounded timeout; cancellation is
not an instantaneous remote-request abort. No keys are exposed by progress events.

All calls reserve against the existing single thread-safe job budget. Missing
credentials, invalid responses, rate limits and exhausted credit stay visible
as unavailable or partial results. Redacted excerpts go to configured providers;
this is local storage and execution, not fully offline model inference.

After review, authorized project commands use the existing isolated Docker
runtime. Deterministic assessment still decides what was actually demonstrated
from current-snapshot execution evidence. The AI team never issues a receipt,
changes PRAXIS Verify verdicts, applies source edits or pushes submitted projects.
Fix planning, handoff confirmation, freshness checks, backups and rollback remain
separate. The browser-only public trial performs source inspection without this
server-side team, project execution or API credentials.

Implementation: `apps/workbench/backend/regen/team.py`, existing `provider.py`
adapters, `app.py` durable job emitter and `ModelPerspectives.tsx` presentation.
No new runtime dependency, framework, database, account or cloud upload is added.

Regression coverage includes real concurrency, shared budgets, exchanged
evidence, invented paths and IDs, disagreements, unavailable providers,
cancellation, budget pause durability, API redaction and responsive UI states.
