# Project intake and coding-agent workflow

PRAXIS has two connected responsibilities with distinct execution and evidence
contracts. The workbench reviews and repairs submitted projects in copies using
the selected model API. Core PRAXIS runs installed coding CLIs, manages draft
approval, and records whatever evidence it can establish. Existing interfaces and
formats are preserved; a successful process is not automatically verified work.

## Project intake

Run `npm run dev` from PRAXIS and open `http://127.0.0.1:3000`.

1. Choose **Local folder**, **GitHub repository**, or **Upload folder**.
2. A folder upload uses the browser's directory picker. Selection stages an
   isolated copy locally without running a scan or model call. The ready-file
   count shows exclusions. Click **Scan project** to begin the budgeted review.
3. Inspect findings and coverage gaps, select fixable issues, and review the
   specialists' patches and independent review.
4. Authorize runtime checks only for a project you trust. Download a patch or
   project copy for GitHub and uploaded sources. Local path submissions retain
   explicit source-apply confirmation, freshness checks, backups, and rollback.

Uploads accept one folder, up to 25,000 reviewable files, 2 MiB per file,
100 MiB total, and 32 MiB per encoded request batch. Large selections are sent
through resumable bounded batches. Two uploads may run concurrently. Credentials,
dependency directories, generated output, and private memory directories are
excluded. Traversal, Windows reserved names, duplicate names ignoring case,
and file/directory conflicts are rejected before writing files. Empty folders
are not represented by browser directory uploads. Large data projects can use
an existing local folder path.

GitHub intake accepts HTTPS repository URLs. Existing Git credentials handle
private repositories. Proxy and certificate settings are passed only to Git;
submitted project commands still receive the stripped execution environment.
TLS verification remains enabled. Network, authentication, TLS, missing Git,
and cancellation errors have distinct guidance. Restart services in a normal
terminal if their parent coding-agent terminal restricts network access.

Development API reload watches `backend/regen`. On Windows, the Node launcher
restarts only its owned Python process tree to avoid Uvicorn's shared-console
Ctrl+C broadcast. Test-file changes do not restart the app. Interrupted active
jobs retain the existing recovery behavior and are not marked successful.

## Installed coding CLIs

`praxis init` and the `praxis` welcome command discover installed Claude, Codex,
Gemini, OpenCode, and Cursor. Claude, Gemini, and OpenCode receive project-scoped
PRAXIS MCP links where their documented project configuration safely supports it.
Codex and Cursor receive the portable `AGENTS.md` instructions; PRAXIS does not
silently create their project startup configuration because doing so can affect
repository startup and client trust prompts. Run `node src/cli.js connect --json`
to refresh supported links after installing a client; `connect --check --json`
checks CLI availability without writing settings. Existing PRAXIS entries, other
servers, and malformed configurations are preserved. Clients must restart and
apply their own project trust and authentication controls. Discovery means
installed, and configuration means linked on disk; neither proves a running
client has connected. Custom adapters are discovered by executable; unknown
clients need their documented MCP configuration rather than guessed hooks.
Automatic capture remains specific to clients with supported transcripts or hooks.

`praxis init` also converts the shipped `/praxis-*` templates into portable
Agent Skills under the ignored project `.agents/skills` directory. If Codex is
installed, the same generated skills are refreshed under `~/.codex/skills`.
PRAXIS-generated skills carry an ownership marker; a user-authored skill with a
colliding name is preserved. Init repairs legacy personal Claude/Codex hook
commands from bare `praxis capture` to `npx -y praxis-memory capture` without
changing hooks owned by other tools. Restart the coding client to reload skills.

For an explicit live speed check of configured `.env` API credentials:

```powershell
apps/workbench/.venv/Scripts/python.exe -B apps/workbench/tools/select_fast_model.py --select
```

This checks four fast model candidates, makes at most two tiny JSON calls per
candidate with a $0.02 budget per call, and stores the fastest successful choice
and measurements under ignored `.regen`. Timeout billing is marked unknown.
It measures small-request latency including catalog access, not coding quality
or remaining credit. No project source is sent. Environment model overrides
still take precedence over saved settings. It runs only when explicitly invoked.

```powershell
node src/cli.js run "Review the project" --tool claude
node src/cli.js run "Review the project" --tool codex
node src/cli.js run "Review the project" --tool gemini
node src/cli.js run "Review the project" --tool opencode
```

Claude remains the default. Existing `--codex` and `--gemini` flags work;
`--opencode` is also available. `--allow-edits` requests execution with file edits
pre-approved. `--full-auto` explicitly requests the broadest permission mode.
The same agent name is retained when approving a draft. Flow steps accept the
same tool names, and `eval --tool <name>` now honors its advertised selector.
Other pre-existing flow/eval correctness findings remain unresolved.

| Agent | Draft | Edit execution | Setup requirement |
|---|---|---|---|
| Claude Code | Existing plan mode | Existing acceptEdits mode | Installed `claude` and authenticated account |
| Codex | Existing read-only sandbox | Existing workspace-write sandbox | Installed `codex` and authenticated account |
| Gemini CLI | `--approval-mode plan` | `--approval-mode auto_edit` | Installed `gemini`, authentication, and a version supporting headless plan mode |
| OpenCode | Plan agent; permissions deny everything except read/glob/grep/list | Build agent; edits allowed, project commands denied | Installed `opencode` and configured model access |
| Other CLI agents | Explicit user-configured command for draft mode | Explicit user-configured command for edit mode | Installed CLI with noninteractive task input |

Gemini plan-mode support depends on the installed version and can require
experimental planning configuration. It is not silently replaced with an edit
mode when unavailable. OpenCode permissions are passed per job. These agent
policies do not turn host execution into an OS sandbox. No third-party coding
CLI is installed or authenticated automatically.

Built-in invocations follow the official [Gemini headless documentation](https://geminicli.com/docs/cli/headless/),
[Gemini permission modes](https://geminicli.com/docs/reference/configuration/),
and [OpenCode CLI documentation](https://opencode.ai/docs/cli/).

## Additional coding agents

`PRAXIS_AGENT_ADAPTERS` is a JSON object mapping an agent name to explicit argv
arrays for `plan`, `acceptEdits`, and optionally `bypassPermissions`. Select the
agent with `--tool <name>`. The CLI receives the task on stdin; an argv token
`{taskFile}` is replaced with the job's task-file path for file-based input.
Commands are argv arrays, never shell command strings. Set the environment
variable to a JSON serialization of your trusted adapter configuration.

For example, a file-based CLI can use this shape, replacing the example
executable and flags with its documented interface:

```json
{
  "my-agent": {
    "plan": ["my-agent-cli", "--read-only", "--prompt-file", "{taskFile}"],
    "acceptEdits": ["my-agent-cli", "--edit", "--prompt-file", "{taskFile}"]
  }
}
```

Permission semantics belong to the configured CLI. Supply a genuinely read-only
command for `plan`; PRAXIS cannot infer one for every third-party tool. A missing
mode fails before creating a job. The existing `PRAXIS_RUN_CMD` override retains
precedence and its existing behavior. Windows npm shims launch their Node entry
point directly; unknown shell launchers reject shell metacharacters.

Coding clients that support MCP can use the existing PRAXIS stdio server with
`node <absolute-checkout-path>/src/cli.js mcp`. Existing client configuration and
Claude hooks remain intact. Hook capture and transcript-based receipt support
are not automatically implemented for every new client. Generic jobs retain
their real exit code and output; missing transcript evidence stays missing.

## Architecture review

The requested Twilio AI-agent and augmentation architect skills concern voice,
messaging, and contact-center agents. Their explicit handoff, supervision, cost,
and failure-reporting principles inform this workflow. This coding-agent task
does not require Twilio accounts, phone numbers, ConversationRelay, or customer
conversation storage. No Twilio service was provisioned and no voice capability
is claimed.

The completed linkage checks cover intake → snapshot → review → repair →
verification/export, plus CLI selection → task delivery → actual process exit.
Model/API access, coding-CLI authentication, runtime verification, and signed
receipts remain separately observable states. No live coding-agent model call
was made to test these adapters.
