import { Modal } from "./ui";

export function ProjectGuide({ close }: { close: () => void }) {
  return <Modal title="How PRAXIS works" onClose={close}>
    <div className="guide">
      <p>Review the project you built with AI, understand its gaps, and decide what to repair. PRAXIS inspects a separate snapshot; your original source stays in place.</p>
      <h3>1. Add your project</h3>
      <p>Choose a local folder path, a GitHub URL, or a folder upload. PRAXIS maps the stack, plans, entry points, tests, and source relationships. Existing PRAXIS conversation memory stays private.</p>
      <h3>2. Choose what can run</h3>
      <p>Model reviews send bounded, redacted source excerpts to your configured providers within one shared budget. Runtime checks require your trust confirmation and a local Linux Docker engine. Dependency downloads require separate network permission.</p>
      <h3>3. Read the evidence</h3>
      <p>Findings explain the issue, impact, source evidence, and recommended response. Execution shows exact commands, outcomes, and gaps. A source finding is a hypothesis; passing tests alone do not establish complete correctness or production readiness.</p>
      <h3>4. Review the fix plan</h3>
      <p>Select findings and draft a plan. Confirm the model handoff or copy the plan into your coding agent. Proposed edits happen in copies. Local apply requires confirmation, freshness checks, backups, and rollback; GitHub and upload reviews use exports.</p>
      <details className="disclosure"><summary>Prepare the Docker runtime</summary>
        <pre className="code-block">docker pull node:22-bookworm-slim{"\n"}docker pull python:3.12-slim</pre>
        <p>The container runner supports Node and Python commands. It does not currently drive browser journeys. Homepage reachability is separate from task-specific, end-to-end evidence. Provider keys stay on the backend.</p>
      </details>
    </div>
  </Modal>;
}
