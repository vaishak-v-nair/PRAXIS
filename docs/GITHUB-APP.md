# PRAXIS Verify GitHub App

The GitHub App runs the same claim-verification engine as `npx praxis verify`
against the exact base and head SHAs in a signed pull-request webhook. It posts
one updated PR comment and one check run. The default is advisory: findings are
visible, while the check concludes `neutral` and does not become a merge gate.

## Register the app

Create a GitHub App with this webhook URL:

```text
https://YOUR-HOST/webhooks/github
```

Subscribe only to **Pull requests**. Grant these repository permissions:

- Contents: read
- Pull requests: read and write (for the timeline comment)
- Checks: read and write

Set a high-entropy webhook secret and generate an RSA private key. The service
validates `X-Hub-Signature-256` against the original request bytes before it
parses or processes a delivery.

## Run the service

```powershell
$env:PRAXIS_GITHUB_APP_ID = "123456"
$env:PRAXIS_GITHUB_WEBHOOK_SECRET = "replace-with-a-long-random-secret"
$env:PRAXIS_GITHUB_PRIVATE_KEY_FILE = "C:\secure\praxis-app.pem"
node src/cli.js github-app --check
node src/cli.js github-app --port 8787
```

The listener binds to `127.0.0.1`. Put it behind an HTTPS reverse proxy for a
public deployment. Signed receipts and the stable App signing key are stored in
`~/.praxis/github-app` by default. Set `PRAXIS_GITHUB_STATE_DIR` to a durable,
private volume in production. The installation token is repository-scoped and
is passed to Git through process environment configuration, not a clone URL.

Claim extraction uses the existing Claude path: an authenticated `claude` CLI,
or `ANTHROPIC_API_KEY`. Verification failure is reported as failure to complete;
the App never issues a receipt for a failed run.

## Opt into blocking mode

Commit this file to the protected base branch:

```json
{
  "mode": "blocking"
}
```

at `.github/praxis-verify.json`. The App reads it at the webhook's base commit,
so a pull request cannot enable blocking by editing its own branch. In blocking
mode, any contradicted, unsupported, incomplete, or human-review claim concludes
the check with `failure`; only a complete set of verified claims concludes with
`success`. Repository administrators still decide whether to make that named
check required in branch protection.

## Public receipt explorer

GitHub Pages serves `/receipt/`. Open a `praxis.verify.receipt/v1` JSON file to
verify its Ed25519 signature in the browser. **Copy this receipt link** embeds
one receipt in the URL fragment. The browser does not send fragments to the
server, and the page's content security policy disables network requests.
