<!--
Thanks for the PR. Keep this short — the checklist exists to catch the three
things that actually break PRAXIS, not to make you fill in a form.
-->

## What and why

<!-- What changes, and why this way? The diff shows the what; only you know the why. -->

## How it was verified

<!-- `npm test` output, a command you ran, a screenshot of the terminal. -->

## Checklist

- [ ] `npm test` passes locally
- [ ] Tests ship **with** the change (a change without its test is incomplete)
- [ ] **No new runtime dependencies** — `package.json` `dependencies` is still empty
- [ ] **No new network calls** — content never leaves the machine
- [ ] If a user-facing command changed: README section and `--help` updated in *this* PR
- [ ] If receipt sealing or verification changed: receipts from older versions still verify (regression test included)
- [ ] If the judge prompt changed: before/after eval scorecard included, false accusations still zero

## Anything reviewers should push back on?

<!-- Optional. Naming your own weak spot gets a better review than hiding it. -->
