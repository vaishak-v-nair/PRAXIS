"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Square, RotateCw, Terminal, GitBranch, ShieldAlert, Play, BrainCircuit, LockKeyhole, LayoutDashboard, ListChecks, Network, Activity } from "lucide-react";
import { type ConnectedModel, type Job } from "@/lib/contracts";
import { Findings } from "./Findings";
import { Execution } from "./Execution";
import { Changes } from "./Changes";
import { Empty, Notice, Status } from "./ui";
import { AttentionPanel } from "./AttentionPanel";
import { SummaryMetrics } from "./SummaryMetrics";
import { EvidenceGates } from "./EvidenceGates";
import { ModelPerspectives } from "./ModelPerspectives";

const SourceExplorer = dynamic(() => import("./SourceExplorer"), { ssr: false, loading: () => <div className="loading-surface">Loading source explorer…</div> });
const active = ["queued", "scanning", "analyzing", "planning_fix", "fixing", "verifying"];

export function ReviewWorkspace({ job, connectedModel, openModels, busy, streaming, back, action, verify, apply }: {
  job: Job; busy: boolean; streaming: boolean; back: () => void;
  connectedModel?: ConnectedModel; openModels: () => void;
  action: (name: string, body: unknown) => void; verify: () => void; apply: () => void;
}) {
  const [view, setView] = useState("overview");
  const running = active.includes(job.status);
  const findings = job.findings || [];
  const understanding = job.plan?.understanding;
  const readiness = job.assessment?.readiness;
  const implementation = job.assessment?.implementation;
  const attention = job.assessment?.attention_items || [];
  const openAttention = (area: string) => {
    if (area === "models") openModels();
    else if (area === "findings") setView("findings");
    else setView("execution");
  };

  return <div className="workspace">
    <button className="back-link" onClick={back}><ArrowLeft size={15} />All reviews</button>
    <header className="project-heading">
      <div><div className="section-label">FINAL PROJECT CHECK / {job.id.slice(0, 8)}</div><h1>{job.name || "Project"}</h1><p className="file-path">{job.source}</p></div>
      <div className="project-actions"><Status value={job.status} />{running
        ? <button className="button" disabled={busy} onClick={() => action("cancel", {})}><Square size={13} />Stop review</button>
        : <button className="button" disabled={busy || job.status !== "complete"} onClick={verify}><Play size={14} />Run checks</button>}</div>
    </header>
    {job.error && <Notice error>{job.error}</Notice>}
    {job.status === "paused" && <Notice><p>The model budget was reached. Existing findings and changes remain available.</p><button className="button" disabled={busy} onClick={() => action("budget", { amount: 5 })}>Add $5 and resume</button></Notice>}
    {running && <div className="run-banner" role="status"><RotateCw className="spin" size={17} /><div><strong>{job.status === "planning_fix" ? "Drafting a source-aware repair plan" : job.status === "fixing" ? "Preparing proposed fixes" : job.status === "verifying" ? "Executing project checks" : "Review in progress"}</strong><p>{job.events?.at(-1)?.message || "Preparing a source snapshot…"}</p></div><span className="micro">{streaming ? "Live" : "Reconnecting"}</span></div>}
    <SummaryMetrics job={job} />
    <nav className="workspace-nav" aria-label="Review sections">{[{ name: "overview", Icon: LayoutDashboard }, { name: "findings", Icon: ShieldAlert }, { name: "execution", Icon: Terminal }, { name: "changes", Icon: ListChecks }, { name: "source map", Icon: Network }, { name: "activity", Icon: Activity }].map(({ name, Icon }) => <button key={name} aria-current={view === name ? "page" : undefined} onClick={() => setView(name)}><Icon size={15} aria-hidden="true" />{name}{name === "findings" && <span>{findings.length}</span>}{name === "changes" && job.fix?.diff && <span className="new-marker" />}</button>)}</nav>
    <div className="workspace-body">
      {view === "overview" && <>
        <section className={"final-verdict " + (readiness?.status || "not_established")}>
          <div><div className="section-label">FINAL ENGINEERING DECISION</div><h2>{readiness?.label || (running ? "Collecting production evidence" : "Production readiness is not established")}</h2><p>{readiness?.detail || "Run the review and authorized checks to separate working behavior from source-only claims."}</p></div>
          <Status value={readiness?.status || "not_established"} />
          {!!readiness?.blockers.length && <details className="readiness-blockers" open={readiness.blockers.length <= 3}><summary><ShieldAlert size={16} /><strong>{readiness.blockers.length} production readiness blocker{readiness.blockers.length === 1 ? "" : "s"}</strong><span>Inspect</span></summary><ul>{readiness.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul></details>}
          {!!readiness?.requirements?.length && <details className="readiness-requirements"><summary>Evidence still required</summary><ul>{readiness.requirements.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
        </section>
        <div className="reality-grid">
          <article><BrainCircuit size={19} /><div><span>IMPLEMENTATION REALITY</span><h3>{implementation?.label || "Not established"}</h3><p>{implementation?.detail || "No end-to-end behavior has been demonstrated yet."}</p></div><Status value={implementation?.status || "not_established"} /></article>
          <article><LockKeyhole size={19} /><div><span>PRIVATE CONTINUITY</span><h3>{understanding?.continuity.status === "available" ? "Project memory detected" : "Source context only"}</h3><p>{understanding?.continuity.detail || "Conversation memory remains in the local PRAXIS layer and outside review/model payloads."}</p></div><Status value={understanding?.continuity.status || "not_detected"} /></article>
        </div>
        <EvidenceGates dimensions={job.assessment?.dimensions} />
        <div className="overview-grid">
          <section><div className="section-label">NEXT ACTION</div><h2>{job.assessment?.title || (running ? "Collecting evidence" : "Review the available evidence")}</h2><p className="muted">PRAXIS compares the product you intended to build with source findings, runtime behavior and missing proof.</p><div className="next-actions">
            <button onClick={() => setView("findings")}><ShieldAlert size={21} /><div><strong>{findings.length ? `Inspect ${findings.length} findings` : "Inspect source findings"}</strong><span>Leakage, security, incomplete paths and remediation</span></div><ArrowRight size={18} /></button>
            <button onClick={() => setView("execution")}><Terminal size={21} /><div><strong>{job.checks?.length ? "Read execution results" : "Review what has not run"}</strong><span>Tests, builds, browser behavior and coverage gaps</span></div><ArrowRight size={18} /></button>
            {(job.fix || job.fix_plan) && <button onClick={() => setView("changes")}><GitBranch size={21} /><div><strong>{job.fix ? "Review proposed changes" : "Review repair plan"}</strong><span>{job.fix ? "Inspect the patch before applying" : "Confirm the plan before agents edit"}</span></div><ArrowRight size={18} /></button>}
          </div></section>
          <aside className="coverage-aside"><div className="section-label">PROJECT UNDERSTANDING</div><h3>Detected context</h3><dl className="understanding-list"><div><dt>Stack</dt><dd>{understanding?.languages.join(", ") || job.languages?.join(", ") || "Not detected"}</dd></div><div><dt>Planning sources</dt><dd>{understanding?.planning_files.length || 0}</dd></div><div><dt>Entrypoints</dt><dd>{understanding?.entrypoints.length || 0}</dd></div><div><dt>Tests</dt><dd>{job.plan?.test_file_count || 0}</dd></div><div><dt>Commands</dt><dd>{understanding?.commands_discovered ?? job.commands?.length ?? 0}</dd></div></dl></aside>
        </div>
        <AttentionPanel items={attention} running={running} open={openAttention} />
        <ModelPerspectives perspectives={job.pressure_tests} />
      </>}
      {view === "findings" && <Findings findings={findings} canRepair={["complete", "error"].includes(job.status)} busy={busy || running} repair={ids => { setView("changes"); action("fix-plan", { finding_ids: ids }); }} />}
      {view === "execution" && <Execution job={job} verify={verify} disabled={busy || job.status !== "complete"} />}
      {view === "changes" && <Changes job={job} connectedModel={connectedModel} openModels={openModels} verify={verify} apply={apply} busy={busy || running} repair={() => job.fix_plan && action("fix", { finding_ids: job.fix_plan.finding_ids, plan_id: job.fix_plan.id, run_checks: false, trust_confirmed: false })} />}
      {view === "source map" && (job.plan ? <SourceExplorer plan={job.plan} /> : <Empty title="Source map not available"><p>This review has no recorded source inventory. Start a new review to create one.</p></Empty>)}
      {view === "activity" && <section><div className="view-heading"><div><h2>Review activity</h2><p>Messages recorded by the backend, in execution order.</p></div><span className="micro">{streaming ? "Live connection" : "Polling every 5 seconds"}</span></div>{job.events?.length ? <ol className="event-log">{job.events.map((event, i) => <li key={i}><span className="event-index">{String(i + 1).padStart(2, "0")}</span><div><p>{event.message}</p><time>{event.time ? new Date(event.time).toLocaleString() : ""}</time></div></li>)}</ol> : <Empty title="No activity recorded"><p>Events appear here when the backend starts work.</p></Empty>}</section>}
    </div>
  </div>;
}
