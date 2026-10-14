"use client";
import dynamic from "next/dynamic";
import { ArrowLeft, Square, RotateCw, Terminal, ShieldAlert, LayoutDashboard, ListChecks } from "lucide-react";
import { type ConnectedModel, type Job } from "@/lib/contracts";
import { Findings } from "./Findings";
import { Execution } from "./Execution";
import { Changes } from "./Changes";
import { Empty, Notice, Status } from "./ui";
import { ReviewOverview } from "./ReviewOverview";
import { SharedWorkspace } from "./SharedWorkspace";
import { ExternalEvidence } from "./ExternalEvidence";
import { sourceLabel } from "@/lib/source-label.mjs";

const SourceExplorer = dynamic(() => import("./SourceExplorer"), { ssr: false, loading: () => <div className="loading-surface">Loading source explorer…</div> });
const active = ["queued", "scanning", "analyzing", "planning_fix", "fixing", "verifying"];

export function ReviewWorkspace({ job, view, setView, connectedModel, openModels, busy, streaming, back, action, verify, apply }: {
  job: Job; busy: boolean; streaming: boolean; back: () => void;
  view: string; setView: (view: string) => void;
  connectedModel?: ConnectedModel; openModels: () => void;
  action: (name: string, body: unknown) => Promise<unknown>; verify: () => void; apply: () => void;
}) {
  const running = active.includes(job.status);
  const findings = job.findings || [];
  const moreView = ["evidence", "workspace", "source map", "activity"].includes(view);
  const openAttention = (area: string) => {
    if (area === "models") openModels();
    else if (area === "findings") setView("findings");
    else setView("execution");
  };

  return <div className="workspace">
    <button className="back-link" onClick={back}><ArrowLeft size={15} />Projects</button>
    <header className="project-heading">
      <div><h1>{job.name || "Project"}</h1><details className="source-disclosure"><summary>{sourceLabel(job.source)} <span>Source details</span></summary><code>{job.source}</code></details></div>
      <div className="project-actions"><Status value={job.status === "complete" ? "recorded" : job.status} label={job.status === "complete" ? "Review recorded" : undefined} />{running && <button className="button" disabled={busy} onClick={() => action("cancel", {})}><Square size={13} />Stop review</button>}</div>
    </header>
    {job.error && <Notice error>{job.error}</Notice>}
    {!running && job.evidence_freshness?.freshness !== undefined && job.evidence_freshness.freshness !== "current" && <Notice error><strong>The saved checks do not establish the current review copy.</strong><p>The copy changed or is unavailable. Recorded outcomes remain in Execution as historical evidence; start a new review of the current project before relying on them.</p></Notice>}
    {!running && ["stale", "unavailable"].includes(job.evidence_freshness?.source_freshness || "") && <Notice><strong>The original project changed or is unavailable.</strong><p>This review describes its prepared copy. Review the current project folder to establish its readiness.</p></Notice>}
    {job.status === "paused" && <Notice><p>The model budget was reached. Existing findings and changes remain available.</p><button className="button" disabled={busy} onClick={() => action("budget", { amount: 5 })}>Add $5 and resume</button></Notice>}
    {running && <div className="run-banner" role="status"><RotateCw className="spin" size={17} /><div><strong>{job.status === "planning_fix" ? "Drafting a source-aware repair plan" : job.status === "fixing" ? "Preparing proposed fixes" : job.status === "verifying" ? "Executing project checks" : "Review in progress"}</strong><p>{job.events?.at(-1)?.message || "Preparing a source snapshot…"}</p></div><span className="micro">{streaming ? "Live" : "Reconnecting"}</span></div>}
    <nav className="workspace-nav" aria-label="Review sections">
      <div className="workspace-primary-tabs">{[
        { name: "overview", label: "Overview", shortLabel: "Review", Icon: LayoutDashboard },
        { name: "findings", label: "Findings", shortLabel: "Issues", Icon: ShieldAlert },
        { name: "execution", label: "Checks", shortLabel: "Checks", Icon: Terminal },
        { name: "changes", label: "Plan & changes", shortLabel: "Plan", Icon: ListChecks },
      ].map(({ name, label, shortLabel, Icon }) => <button key={name} aria-label={label} aria-current={view === name ? "page" : undefined} onClick={() => setView(name)}><Icon size={15} aria-hidden="true" /><span className="tab-label-full">{label}</span><span className="tab-label-short" aria-hidden="true">{shortLabel}</span>{name === "findings" && <span className="tab-count" aria-hidden="true">{findings.length}</span>}{name === "changes" && job.fix?.diff && <span className="new-marker" aria-hidden="true" />}</button>)}</div>
      <label className={`workspace-more${moreView ? " active" : ""}`}><span className="sr-only">More review sections</span><select aria-label="More review sections" value={moreView ? view : ""} onChange={event => setView(event.target.value)}><option value="" disabled>More</option><option value="evidence">Evidence sources</option><option value="workspace">Shared workspace</option><option value="source map">Source map</option><option value="activity">Activity</option></select></label>
    </nav>
    <div key={view} className="workspace-body">
      {view === "overview" && <ReviewOverview job={job} running={running} navigate={setView} openAttention={openAttention} />}
      {view === "findings" && <Findings job={job} findings={findings} modelConfigured={!!connectedModel?.configured} openModels={openModels} canRepair={["complete", "error"].includes(job.status)} busy={busy || running} repair={ids => { setView("changes"); action("fix-plan", { finding_ids: ids }); }} />}
      {view === "workspace" && <SharedWorkspace job={job} busy={busy} action={action} />}
      {view === "evidence" && <ExternalEvidence job={job} busy={busy} action={action} />}
      {view === "execution" && <Execution job={job} verify={verify} disabled={busy || job.status !== "complete"} />}
      {view === "changes" && <Changes job={job} connectedModel={connectedModel} openModels={openModels} verify={verify} apply={apply} busy={busy || running} repair={() => job.fix_plan && action("fix", { finding_ids: job.fix_plan.finding_ids, plan_id: job.fix_plan.id, run_checks: false, trust_confirmed: false })} />}
      {view === "source map" && (job.plan ? <SourceExplorer plan={job.plan} /> : <Empty title="Source map not available"><p>This review has no recorded source inventory. Start a new review to create one.</p></Empty>)}
      {view === "activity" && <section><div className="view-heading"><div><h2>Review activity</h2><p>Messages recorded by the backend, in execution order.</p></div><span className="micro">{streaming ? "Live connection" : "Polling every 5 seconds"}</span></div>{job.events?.length ? <ol className="event-log">{job.events.map((event, i) => <li key={i}><span className="event-index">{String(i + 1).padStart(2, "0")}</span><div><p>{event.message}</p><time>{event.time ? new Date(event.time).toLocaleString() : ""}</time></div></li>)}</ol> : <Empty title="No activity recorded"><p>Events appear here when the backend starts work.</p></Empty>}</section>}
    </div>
  </div>;
}
