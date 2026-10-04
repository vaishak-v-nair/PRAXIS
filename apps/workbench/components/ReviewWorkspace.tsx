"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { ArrowLeft, Square, RotateCw, Terminal, ShieldAlert, Play, BrainCircuit, LayoutDashboard, ListChecks, Network, Activity } from "lucide-react";
import { type ConnectedModel, type Job } from "@/lib/contracts";
import { Findings } from "./Findings";
import { Execution } from "./Execution";
import { Changes } from "./Changes";
import { Empty, Notice, Status } from "./ui";
import { ReviewOverview } from "./ReviewOverview";
import { SummaryMetrics } from "./SummaryMetrics";
import { SharedWorkspace } from "./SharedWorkspace";

const SourceExplorer = dynamic(() => import("./SourceExplorer"), { ssr: false, loading: () => <div className="loading-surface">Loading source explorer…</div> });
const active = ["queued", "scanning", "analyzing", "planning_fix", "fixing", "verifying"];

export function ReviewWorkspace({ job, connectedModel, openModels, busy, streaming, back, action, verify, apply }: {
  job: Job; busy: boolean; streaming: boolean; back: () => void;
  connectedModel?: ConnectedModel; openModels: () => void;
  action: (name: string, body: unknown) => Promise<unknown>; verify: () => void; apply: () => void;
}) {
  const [view, setView] = useState("overview");
  const running = active.includes(job.status);
  const findings = job.findings || [];
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
    <nav className="workspace-nav" aria-label="Review sections">{[{ name: "overview", Icon: LayoutDashboard }, { name: "findings", Icon: ShieldAlert }, { name: "execution", Icon: Terminal }, { name: "changes", Icon: ListChecks }, { name: "workspace", Icon: BrainCircuit }, { name: "source map", Icon: Network }, { name: "activity", Icon: Activity }].map(({ name, Icon }) => <button key={name} aria-current={view === name ? "page" : undefined} onClick={() => setView(name)}><Icon size={15} aria-hidden="true" />{name}{name === "findings" && <span>{findings.length}</span>}{name === "changes" && job.fix?.diff && <span className="new-marker" />}</button>)}</nav>
    <div key={view} className="workspace-body">
      {view === "overview" && <ReviewOverview job={job} running={running} navigate={setView} openAttention={openAttention} />}
      {view === "findings" && <Findings findings={findings} canRepair={["complete", "error"].includes(job.status)} busy={busy || running} repair={ids => { setView("changes"); action("fix-plan", { finding_ids: ids }); }} />}
      {view === "workspace" && <SharedWorkspace job={job} busy={busy} action={action} />}
      {view === "execution" && <Execution job={job} verify={verify} disabled={busy || job.status !== "complete"} />}
      {view === "changes" && <Changes job={job} connectedModel={connectedModel} openModels={openModels} verify={verify} apply={apply} busy={busy || running} repair={() => job.fix_plan && action("fix", { finding_ids: job.fix_plan.finding_ids, plan_id: job.fix_plan.id, run_checks: false, trust_confirmed: false })} />}
      {view === "source map" && (job.plan ? <SourceExplorer plan={job.plan} /> : <Empty title="Source map not available"><p>This review has no recorded source inventory. Start a new review to create one.</p></Empty>)}
      {view === "activity" && <section><div className="view-heading"><div><h2>Review activity</h2><p>Messages recorded by the backend, in execution order.</p></div><span className="micro">{streaming ? "Live connection" : "Polling every 5 seconds"}</span></div>{job.events?.length ? <ol className="event-log">{job.events.map((event, i) => <li key={i}><span className="event-index">{String(i + 1).padStart(2, "0")}</span><div><p>{event.message}</p><time>{event.time ? new Date(event.time).toLocaleString() : ""}</time></div></li>)}</ol> : <Empty title="No activity recorded"><p>Events appear here when the backend starts work.</p></Empty>}</section>}
    </div>
  </div>;
}
