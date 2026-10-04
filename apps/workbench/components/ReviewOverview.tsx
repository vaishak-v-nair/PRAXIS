import { ArrowRight, BrainCircuit, GitBranch, LockKeyhole, ShieldAlert, Terminal } from "lucide-react";
import type { Job } from "@/lib/contracts";
import { evidenceLabel, reviewPresentation } from "@/lib/status.mjs";
import { Status } from "./ui";
import { AttentionPanel } from "./AttentionPanel";
import { EvidenceGates } from "./EvidenceGates";
import { ModelPerspectives } from "./ModelPerspectives";
import { AgentBrief } from "./AgentBrief";
import { PriorityFinding } from "./PriorityFinding";

export function ReviewOverview({ job, running, navigate, openAttention }: {
  job: Job; running: boolean; navigate: (view: string) => void; openAttention: (area: string) => void;
}) {
  const { readiness, implementation, dimensions, title, sourceConcern } = reviewPresentation(job);
  const understanding = job.plan?.understanding;
  const findings = job.findings || [];
  return <>
    <div className="decision-grid">
      <section className={"final-verdict " + (readiness?.status || "not_established")} aria-labelledby="decision-title">
        <div className="decision-heading"><span className="section-label">Final engineering decision</span><Status value={readiness?.status || "not_established"} /></div>
        <h2 id="decision-title">{readiness?.label || (running ? "Collecting production evidence" : "Production readiness is not established")}</h2>
        <p>{readiness?.detail || "Run the review and authorized checks to separate working behavior from source-only claims."}</p>
        {!running && <div className="decision-shortcuts"><button className="button" onClick={() => navigate("findings")}>Inspect findings<ArrowRight size={14} /></button><a className="button" href="#review-agent-brief">Open agent brief<ArrowRight size={14} /></a></div>}
        {!!readiness?.blockers.length && <details className={`readiness-blockers ${sourceConcern ? "source-concern" : ""}`} open={!sourceConcern && readiness.blockers.length <= 3}><summary><ShieldAlert size={16} /><strong>{sourceConcern ? (readiness.blockers.length === 1 ? evidenceLabel(readiness.blockers[0]) : `${readiness.blockers.length} source concerns to confirm`) : `${readiness.blockers.length} production readiness blocker${readiness.blockers.length === 1 ? "" : "s"}`}</strong><span>Inspect</span></summary><ul>{readiness.blockers.map((blocker, index) => <li key={index}>{evidenceLabel(blocker)}</li>)}</ul></details>}
        {!!readiness?.requirements?.length && <details className="readiness-requirements"><summary>Evidence still required</summary><ul>{readiness.requirements.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
        {sourceConcern && <details className="readiness-requirements"><summary>Inspect saved assessment</summary><p>{job.assessment?.readiness?.label}: {job.assessment?.readiness?.detail} The saved source finding needs confirmation; no runtime failure was recorded.</p></details>}
      </section>
      <PriorityFinding findings={findings} inspect={() => navigate("findings")} running={running} />
      {!running && <AgentBrief job={job} id="review-agent-brief" />}
      <section className="decision-next" aria-labelledby="next-title">
        <div className="section-label">Your next move</div><h2 id="next-title">{title || (running ? "Collecting evidence" : "Review the available evidence")}</h2>
        <div className="next-actions">
          <button onClick={() => navigate("findings")}><ShieldAlert size={19} /><div><strong>{findings.length ? `Inspect ${findings.length} findings` : "Inspect source findings"}</strong><span>Understand the impact and source evidence</span></div><ArrowRight size={16} /></button>
          <button onClick={() => navigate("execution")}><Terminal size={19} /><div><strong>{job.checks?.length ? "Read execution results" : "Review what has not run"}</strong><span>Tests, builds and gaps in recorded proof</span></div><ArrowRight size={16} /></button>
          {(job.fix || job.fix_plan) && <button onClick={() => navigate("changes")}><GitBranch size={19} /><div><strong>{job.fix ? "Review proposed changes" : "Review repair plan"}</strong><span>{job.fix ? "Inspect the patch before applying" : "Confirm the plan before agents edit"}</span></div><ArrowRight size={16} /></button>}
        </div>
      </section>
    </div>
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
  </>;
}
