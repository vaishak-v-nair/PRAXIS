import { ArrowRight, BrainCircuit, LockKeyhole, ShieldAlert, Terminal } from "lucide-react";
import type { Job } from "@/lib/contracts";
import { evidenceLabel, reviewPresentation } from "@/lib/status.mjs";
import { Status } from "./ui";
import { AttentionPanel } from "./AttentionPanel";
import { EvidenceGates } from "./EvidenceGates";
import { ModelPerspectives } from "./ModelPerspectives";
import { AgentBrief } from "./AgentBrief";
import { SummaryMetrics } from "./SummaryMetrics";

const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function ReviewOverview({ job, running, navigate, openAttention }: {
  job: Job; running: boolean; navigate: (view: string) => void; openAttention: (area: string) => void;
}) {
  const { readiness, implementation, dimensions, title, sourceConcern } = reviewPresentation(job);
  const understanding = job.plan?.understanding;
  const findings = job.findings || [];
  const firstFinding = findings.reduce<(typeof findings)[number] | undefined>((best, item) =>
    !best || (severityOrder[item.severity.toLowerCase()] ?? 5) < (severityOrder[best.severity.toLowerCase()] ?? 5) ? item : best, undefined);
  const nextStep = running
    ? { view: "activity", label: "Follow review progress", detail: "See work as it is recorded", Icon: Terminal }
    : findings.length
      ? { view: "findings", label: `Inspect ${findings.length} finding${findings.length === 1 ? "" : "s"}`, detail: "Read the impact and source evidence", Icon: ShieldAlert }
      : job.checks?.length
        ? { view: "execution", label: "Read execution results", detail: "See what the recorded checks established", Icon: Terminal }
        : { view: "execution", label: "Review what has not run", detail: "Understand the limits of this review", Icon: Terminal };
  return <>
    <div className="decision-grid">
      <section className={"final-verdict " + (readiness?.status || "not_established")} aria-labelledby="decision-title">
        <div className="decision-heading"><span className="section-label">Review result</span><Status value={readiness?.status || "not_established"} /></div>
        <h2 id="decision-title">{readiness?.label || (running ? "Collecting production evidence" : "Production readiness is not established")}</h2>
        <p>{readiness?.detail || "Run the review and authorized checks to separate working behavior from source-only claims."}</p>
        {!!readiness?.blockers.length && <details className={`readiness-blockers ${sourceConcern ? "source-concern" : ""}`} open={!sourceConcern && readiness.blockers.length <= 3}><summary><ShieldAlert size={16} /><strong>{sourceConcern ? (readiness.blockers.length === 1 ? evidenceLabel(readiness.blockers[0]) : `${readiness.blockers.length} source concerns to confirm`) : `${readiness.blockers.length} production readiness blocker${readiness.blockers.length === 1 ? "" : "s"}`}</strong><span>Inspect</span></summary><ul>{readiness.blockers.map((blocker, index) => <li key={index}>{evidenceLabel(blocker)}</li>)}</ul></details>}
        {!!readiness?.requirements?.length && <details className="readiness-requirements"><summary>Evidence still required</summary><ul>{readiness.requirements.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
        {sourceConcern && <details className="readiness-requirements"><summary>Inspect saved assessment</summary><p>{job.assessment?.readiness?.label}: {job.assessment?.readiness?.detail} The saved source finding needs confirmation; no runtime failure was recorded.</p></details>}
        {firstFinding && <div className="result-focus"><span className="section-label">{running ? "Finding recorded so far" : "First issue to inspect"}</span><div><Status value={firstFinding.severity.toLowerCase()} /><strong>{evidenceLabel(firstFinding.title)}</strong><button type="button" className="text-link" onClick={() => navigate("findings")}>View issue<ArrowRight size={14} aria-hidden="true" /></button></div></div>}
      </section>
      <section className="decision-next" aria-labelledby="next-title">
        <span className="section-label">Next step</span>
        <h2 id="next-title">{title || (running ? "Collecting evidence" : "Review the available evidence")}</h2>
        <button type="button" className="next-step-button" onClick={() => navigate(nextStep.view)}><nextStep.Icon size={18} aria-hidden="true" /><span><strong>{nextStep.label}</strong><small>{nextStep.detail}</small></span><ArrowRight size={16} aria-hidden="true" /></button>
      </section>
    </div>
    {!running && !!findings.length && <details className="review-share"><summary>Share this review with a coding agent</summary><AgentBrief job={job} id="review-agent-brief" compact /></details>}
    <details className="review-more"><summary>How PRAXIS reached this result</summary>
    <div className="reality-grid">
      <article><BrainCircuit size={19} /><div><span>Implementation reality</span><h3>{implementation?.label || "Not established"}</h3><p>{implementation?.detail || "No end-to-end behavior has been demonstrated yet."}</p></div><Status value={implementation?.status || "not_established"} /></article>
      <article><LockKeyhole size={19} /><div><span>Private continuity</span><h3>{understanding?.continuity.status === "available" ? "Project memory detected" : "Source context only"}</h3><p>{understanding?.continuity.detail || "Conversation memory remains in the local PRAXIS layer and outside review/model payloads."}</p></div><Status value={understanding?.continuity.status || "not_detected"} /></article>
    </div>
    <EvidenceGates dimensions={dimensions} />
    <AttentionPanel items={job.assessment?.attention_items || []} running={running} open={openAttention} />
    <ModelPerspectives perspectives={job.pressure_tests} team={job.team} />
    <details className="disclosure project-context"><summary>Project understanding <span className="micro">Stack, entrypoints and discovered checks</span></summary>
      <dl className="understanding-list"><div><dt>Stack</dt><dd>{understanding?.languages.join(", ") || job.languages?.join(", ") || "Not detected"}</dd></div><div><dt>Planning sources</dt><dd>{understanding?.planning_files.length || 0}</dd></div><div><dt>Entrypoints</dt><dd>{understanding?.entrypoints.length || 0}</dd></div><div><dt>Tests</dt><dd>{job.plan?.test_file_count || 0}</dd></div><div><dt>Commands</dt><dd>{understanding?.commands_discovered ?? job.commands?.length ?? 0}</dd></div></dl>
    </details>
    <details className="review-metrics"><summary>Review numbers</summary><SummaryMetrics job={job} /></details>
    </details>
  </>;
}
