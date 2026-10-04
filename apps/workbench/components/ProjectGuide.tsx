import { Modal } from "./ui";

export function ProjectGuide({ close }: { close: () => void }) {
  return <Modal title="How PRAXIS works" onClose={close}>
    <div className="guide">
      <p>For people building with AI, developers and teams: understand your project's gaps and agree on a useful next step. PRAXIS inspects a separate snapshot; your original source stays in place.</p>
      <h3>1. Add your project</h3>
      <p>Choose a local folder path, a GitHub URL, or a folder upload. PRAXIS maps the stack, plans, entry points, tests, and source relationships. Existing PRAXIS conversation memory stays private.</p>
      <h3>2. Start without extra setup</h3>
      <p>The default review inspects source without Docker, an API key or project-command execution. Dependency advisory lookup may send package names and versions to OSV. Optional model review sends bounded, redacted excerpts to configured providers within one shared budget.</p>
      <h3>3. Read the evidence</h3>
      <p>Findings explain the issue, impact, source evidence, and recommended response. Execution shows exact commands, outcomes, and gaps. A source finding is a hypothesis; passing tests alone do not establish complete correctness or production readiness.</p>
      <h3>4. Choose deeper checks when needed</h3>
      <p>Inspect discovered commands, choose an execution environment and authorize a trusted project explicitly. Local commands run in the review copy but retain this computer's file and network permissions; a copy is not an OS sandbox. Docker is optional and never silently falls back to local execution. Missing tools remain visible.</p>
      <h3>5. Take the findings to your agent</h3>
      <p>Copy the source-bound findings brief with no model call, or draft a connected-model fix plan. Check current source and confirm a plan before implementation. Proposed edits happen in copies. Local apply requires confirmation, freshness checks, backups and rollback; GitHub and upload reviews use exports.</p>
      <details className="disclosure"><summary>Prepare the Docker runtime</summary>
        <pre className="code-block">docker pull node:22-bookworm-slim{"\n"}docker pull python:3.12-slim</pre>
        <p>The container runner supports Node and Python commands. It does not currently drive browser journeys. Homepage reachability is separate from task-specific, end-to-end evidence. Provider keys stay on the backend.</p>
      </details>
    </div>
  </Modal>;
}
