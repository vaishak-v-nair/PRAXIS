---
description: Slop-risk score for a commit — triage before you review
---

Run `praxis gate` with the Bash tool (pass through a commit ref if I gave one;
default is the latest commit) and show me the output. Then explain in one short
paragraph: the risk score, WHY it scored that way, and whether this commit
deserves a careful human review before it ships.

If the command is not found, tell the user to install it:
`npm install -g praxis-memory`
