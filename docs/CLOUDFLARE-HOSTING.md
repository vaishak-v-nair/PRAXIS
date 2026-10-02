# PRAXIS on Cloudflare

The existing Cloudflare Worker is `praxis`, at
<https://praxis.vaishak-v-nair-dev.workers.dev/>. On 2026-10-02, Wrangler OAuth
was confirmed and the complete curated site was deployed as version
`8c9514ca-f1e0-498a-a457-3a47ac123c80`. The account had no custom domains,
resource bindings or other Workers. Deployment succeeded, but the subsequent
unauthenticated browser check reached a Cloudflare Access sign-in page. Public
access to the trial remains unconfirmed until that Access policy is resolved.

Cloudflare's free address format is `worker.account.workers.dev`; `praxis` is
already the Worker name. Changing the account subdomain to `praxis` would remove
the personal name and produce `praxis.praxis.workers.dev`, if available. The
documented create-subdomain API rejected an in-place change with error 10036.
Use **Workers & Pages → Your subdomain → Change** for a rename. The existing
namespace was not deleted. A shorter custom domain requires a domain the user
owns. See the [official routing guidance](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

`wrangler.jsonc` serves the complete curated static site, including the private
browser scanner, setup guide, receipt explorer and presentation assets. No API,
Python server, model keys, submitted projects, `.env` or `.regen` evidence is
uploaded. The browser trial uses the canonical source scanner in a worker on the
user's device; full Project Review and isolated execution stay local.

Prepare and validate from this checkout:

```powershell
npm run build:site
npm run cloudflare:check
```

Wrangler's build command regenerates scanner hashes from the canonical backend
and stages only public assets. Staging replaces one checked, dedicated generated
directory so stale files cannot be accidentally uploaded. Static responses get
the checked `_headers` rules, including the JavaScript module MIME type. Missing
routes remain real 404s rather than becoming a fake successful landing page.

For the existing Cloudflare account, authenticate and deploy explicitly:

```powershell
npx --yes wrangler@4.146.0 login
npx --yes wrangler@4.146.0 whoami
npm run cloudflare:deploy
```

Select the account owning the existing Worker if Cloudflare offers more than one.
The config names the existing `praxis` Worker; it creates no database, bucket or
paid bindings. Do not deploy the whole checkout as static assets. Deployment and
npm publication are separate. The setup page only enables its pinned public
install command after npm metadata confirms that release is available.

After deployment check these real URLs, then run the browser smoke against it:

- `/` — homepage with **Test Your Project**
- `/test-your-project/` — real browser folder inspection
- `/test-your-project/local.html` — installation and release availability
- `/test-your-project/engine/manifest.json` — current canonical hashes
- `/api/health` — 404, because the public host is not the local API

```powershell
$env:PRAXIS_BROWSER_BASE = 'https://praxis.vaishak-v-nair-dev.workers.dev'
apps/workbench/.venv/Scripts/python.exe apps/workbench/tools/browser_review_smoke.py
Remove-Item Env:PRAXIS_BROWSER_BASE
```

The documented Vercel and GitHub Pages hosts remain supported. This change does
not alter their domains or publish from Git automatically.

## Coding-agent setup

The [official Cloudflare setup instructions](https://developers.cloudflare.com/agent-setup/prompt.md)
were applied to Codex on 2026-10-02. All 16 official skills are installed in the
global `.agents/skills` discovery directory. Five official MCP servers are
registered: `cloudflare`, `cloudflare-docs`, `cloudflare-bindings`,
`cloudflare-builds`, and `cloudflare-observability`. OAuth completed for the four
authenticated servers; documentation is public. Existing local MCP configuration
was preserved. Restart Codex to load the new servers into a running session.

These are development tools; this setup does not add them as claim-verification
evidence sources or expose the private local Project Review service. The project
keeps its pinned Wrangler deployment workflow; the optional beta `cf` CLI was
not needed.
