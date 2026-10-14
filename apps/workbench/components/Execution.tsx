import { Terminal, Play } from "lucide-react";
import { display, type Job } from "@/lib/contracts";
import { Empty, Status, Notice } from "./ui";

const records = (value: unknown) => Array.isArray(value) ? value.filter(item => item && typeof item === "object") as Record<string, unknown>[] : [];
const actions: Record<string, string> = { navigate: "Opened the selected route", fill: "Filled a non-sensitive field", click: "Clicked the selected control", assert_text: "Observed the expected text", assert_url: "Observed the expected route" };
function JourneyEvidence({ check }: { check: Record<string, unknown> }) {
  const steps = records(check.steps), state = records(check.state_evidence);
  if (!steps.length && !state.length) return null;
  return <div className="journey-proof">
    <p className="micro">Scope: {check.evidence_scope === "user_journey" ? "Local workflow with independent API state observations" : "Browser interaction; full backend outcome not established"}</p>
    {check.false_success === true && <Notice error><strong>Success was displayed, but the backend outcome did not hold up.</strong><p>One or more independent state checks failed. The visible message cannot establish completion.</p></Notice>}
    {!!steps.length && <ol>{steps.map((step, index) => <li key={index}><span>{actions[String(step.action)] || "Requested action"}</span><Status value={String(step.status || "unknown")} /></li>)}</ol>}
    {!!state.length && <div className="journey-state-results">{state.map((item, index) => <article key={index}><header><strong>{String(item.name || "Independent state check")}</strong><Status value={String(item.status || "unknown")} /></header><p><code>{String(item.path || "")}</code> · <code>{String(item.json_pointer || "Root value")}</code></p><p className="micro">{item.changed === true ? "State changed after the action." : "A required state change was not observed."} {item.expected_matched_after === true ? "The expected outcome matched." : "The expected outcome was not demonstrated."} {item.repeatable === true ? "A repeat observation confirmed it." : "Repeat confirmation is not established."}</p></article>)}</div>}
    <p className="micro">These observations cover the selected API fields. Database durability and external side effects require their own evidence.</p>
  </div>;
}

export function Execution({ job, verify, disabled }: { job: Job; verify: () => void; disabled: boolean }) {
  const checks = (job.checks || []).map(value => value && typeof value === "object" ? value as Record<string, unknown> : { output: value });
  return <section><div className="view-heading"><div><h2>Execution results</h2><p>Captured command outcomes. Successful setup is separate from successful tests.</p></div><button className="button primary" disabled={disabled} onClick={verify}><Play size={15} />Run checks</button></div>
    {job.evidence_freshness && job.evidence_freshness.freshness !== "current" && <Notice><strong>Historical outcomes</strong><p>These checks belong to the earlier reviewed copy. Their recorded statuses are preserved and do not count toward current readiness.</p></Notice>}
    {checks.length ? <div className="log-list">{checks.map((check, index) => <details key={index}><summary><Terminal size={16} /><code>{display(check.name || check.command || `Check ${index + 1}`)}</code><Status value={String(check.status || "unknown")} /></summary><div className="log-meta"><span>{String(check.runtime || "Runtime not recorded")}</span><span>{String(check.kind || "check")}</span>{check.network ? <span>Network: {String(check.network)}</span> : null}{check.exit_code != null ? <span>Exit: {String(check.exit_code)}</span> : null}</div><JourneyEvidence check={check} /><pre className="code-block">{display(check.output || check.detail || check.message || "No output captured.")}</pre>{check.image ? <p className="micro break">Image: {String(check.image)}</p> : null}</details>)}</div> : <Empty title="No commands have run"><p>Source inspection does not execute your project. Choose trusted local checks or optional Docker checks, inspect the commands and authorize them first.</p></Empty>}
    <details className="check-coverage"><summary>What these checks cover</summary><div className="coverage-list">{job.coverage?.length ? job.coverage.map((item, i) => <article key={i}><div><strong>{item.name || item.tool || "Check"}</strong><Status value={item.status || "unknown"} /></div><p>{item.detail || item.message || "No details supplied."}</p></article>) : <p className="muted">Coverage will appear as the review proceeds.</p>}</div></details>
  </section>;
}
