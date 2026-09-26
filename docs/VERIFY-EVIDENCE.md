# Official MCP evidence

PRAXIS Verify keeps the committed diff as its baseline evidence. An MCP source can add context or a stronger runtime observation through an explicit policy:

~~~bash
praxis verify --manifest claims.json --mcp-policy verify-mcp.json
~~~

The policy is data, not code. It can select only the vendor-maintained sources and tool families in src/lib/verify/mcp-sources.js. URLs cannot be supplied by the policy.

| Source | Fixed server | Verdict role |
| --- | --- | --- |
| GitHub | https://api.githubcopilot.com/mcp/ | PR context, code-scanning alerts, and Dependabot state are supporting evidence. They never replace the local diff or verify a claim alone. |
| Playwright | Microsoft @playwright/mcp on 127.0.0.1:8931/mcp | An observed accessibility-tree interaction is direct UI runtime evidence. |
| Sentry | https://mcp.sentry.dev/mcp | A deterministic production-error expectation is direct production evidence. |
| Supabase | https://mcp.supabase.com/mcp | A deterministic schema or data expectation is direct database evidence. PRAXIS always adds project_ref, read_only=true, and features=database,debugging. |

Start the reviewed Microsoft server before a Playwright check:

~~~bash
npx -y @playwright/mcp@0.0.82 --headless --port 8931
~~~

Authentication remains in the process environment. PRAXIS accepts PRAXIS_GITHUB_MCP_TOKEN or GITHUB_TOKEN, SENTRY_ACCESS_TOKEN, and SUPABASE_ACCESS_TOKEN with SUPABASE_PROJECT_REF. Tokens and raw MCP responses are excluded from receipts. Receipts contain the official source identity plus request and response digests.

A minimal policy looks like this:

~~~json
{
  "schema": "praxis.verify.mcp-evidence-policy/v1",
  "checks": [
    {
      "id": "login-visible",
      "source": "playwright",
      "claimIds": ["login-ui"],
      "calls": [
        { "tool": "browser_navigate", "arguments": { "url": "http://127.0.0.1:3000/login" } },
        { "tool": "browser_snapshot", "arguments": {} }
      ],
      "expectation": { "type": "text-includes", "value": "Sign in" }
    }
  ]
}
~~~

Supported expectations are text-includes, text-not-includes, json-path-equals, count-zero, and count-positive. The engine evaluates these deterministically. An LLM does not assign the verdict.

Community servers and tools outside the reviewed allowlist fail policy validation with unreviewed-mcp-source or unreviewed-mcp-tool. Adding one requires a separate source review and code change.

## Evaluation gates

Run the required golden dataset locally with:

~~~bash
npm run eval:verify
~~~

Promptfoo executes the real verification pipeline for a true fix, plausible false claim, stale passing test, silent mock fallback, and partial fix claimed as complete. The metric gate checks CONTRADICTED recall first and precision second against evals/verify/baseline.json.

The periodic adversarial pass is:

~~~bash
npm run redteam:verify
~~~

It probes the false-VERIFIED failure mode with intent, jailbreak-template, base64, and ROT13 attacks. .github/workflows/verify-redteam.yml runs weekly, manually, and on changes to verdict aggregation. Blocking merge mode remains opt-in and should not be enabled until this pass is green on the target repository.