"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowUpRight, BookOpen, CircleHelp, Code2, FolderGit2, Leaf, Plus, Settings2, ShieldCheck, Sparkles, Waves, X } from "lucide-react";
import { ActionDialog } from "@/components/ActionDialog";
import { JobReport } from "@/components/JobReport";
import { ProjectInput } from "@/components/ProjectInput";
import { ModelSettings } from "@/components/ModelSettings";
import { api, type Health, type Job } from "@/components/types";

export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"verify" | "apply" | null>(null);
  const [help, setHelp] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [streamOnline, setStreamOnline] = useState(false);
  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([api<Health>("/health"), api<Job[] | { jobs: Job[] }>("/jobs")]);
    if (results[0].status === "fulfilled") { setHealth(results[0].value); setConnected(true); } else setConnected(false);
    if (results[1].status === "fulfilled") setJobs(Array.isArray(results[1].value) ? results[1].value : results[1].value.jobs || []);
  }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 15000); return () => clearInterval(timer); }, [refresh]);
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    const stream = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
    stream.onopen = () => setStreamOnline(true);
    stream.onerror = () => setStreamOnline(false);
    const update = (event: MessageEvent) => {
      try { const value = JSON.parse(event.data) as Job; if (value.id && !stopped) { setJob(value); setJobs(prev => [value, ...prev.filter(item => item.id !== value.id)]); } } catch { /* Heartbeats are not job messages. */ }
    };
    stream.onmessage = update;
    stream.addEventListener("job", update as EventListener);
    stream.addEventListener("update", update as EventListener);
    const fallback = setInterval(() => { void api<Job>(`/jobs/${encodeURIComponent(jobId)}`).then(value => { if (!stopped) setJob(value); }).catch(() => undefined); }, 5000);
    return () => { stopped = true; stream.close(); clearInterval(fallback); setStreamOnline(false); };
  }, [jobId]);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { const value = await fn(); if (value && typeof value === "object" && "id" in value) setJob(value as Job); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Something went wrong. Please try again."); }
    finally { setBusy(false); }
  };
  const selectJob = async (id: string) => action(async () => api<Job>(`/jobs/${encodeURIComponent(id)}`));
  const postJob = (path: string, body: unknown) => api<Job>(`/jobs/${encodeURIComponent(job!.id)}/${path}`, body);
  const providerCount = health?.providers && typeof health.providers === "object" ? Object.entries(health.providers).filter(([, v]) => typeof v === "boolean" ? v : v && typeof v === "object" ? Boolean((v as Record<string, unknown>).configured ?? (v as Record<string, unknown>).available) : Boolean(v)).length : 0;
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="/" aria-label="PRAXIS Workbench home"><span className="brand-mark"><Waves size={24} strokeWidth={2.5} /></span>PRAXIS<span className="brand-period">.</span></a><div className="sidebar-caption">A FRESH START FOR YOUR CODE</div>
      <div className="sidebar-nav"><div className="nav-label">WORKSPACE</div><button className={!job ? "nav-item active" : "nav-item"} onClick={() => { setJob(null); setError(""); }}><Plus size={18} />New scan</button><button className={job ? "nav-item active" : "nav-item"} onClick={() => jobs[0] && void selectJob(jobs[0].id)}><FolderGit2 size={18} />Your projects ({jobs.length})</button></div>
      <div className="history"><div className="nav-label">RECENT PROJECTS</div>{jobs.slice(0, 8).map(item => <button key={item.id} className={`history-item ${job?.id === item.id ? "selected" : ""}`} onClick={() => void selectJob(item.id)}><span className={`history-dot ${item.status}`} /><span>{item.name || item.source?.split(/[\\/]/).filter(Boolean).pop() || "Project"}</span></button>)}{!jobs.length && <p className="no-history">Your projects will appear here<br />after your first scan.</p>}</div>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setHelp(true)}><BookOpen size={17} />How PRAXIS Workbench works<ArrowUpRight size={14} /></button><div className="local-card"><div><ShieldCheck size={16} /><strong>Your workspace. Your control.</strong></div><p>Repairs stay in a separate copy until you review and apply them.</p><span><span className="tiny-dot" />LOCAL WORKSPACE</span></div><div className="sidebar-profile"><span className="profile-avatar">L</span><div><strong>Local developer</strong><small>Personal workspace</small></div><span className={`connection-dot ${connected ? "online" : ""}`} title={connected ? "Backend connected" : "Backend disconnected"} /></div></div>
    </aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumb">Workspace<span>/</span><strong>{job ? "Project report" : "New scan"}</strong></div><div className="topbar-right"><span className={`connection-label ${connected ? "online" : ""}`}><span className="connection-dot" />{connected ? "Backend connected" : "Backend offline"}</span><button className="icon-button" aria-label="Model settings" title="Model settings" onClick={() => setSettingsOpen(true)}><Settings2 size={19} /></button><button className="icon-button" aria-label="Help" onClick={() => setHelp(true)}><CircleHelp size={19} /></button></div></header>
      <div className="page-content"><div className="page-heading"><div><div className="eyebrow"><Leaf size={13} /> LESS NOISE. BETTER CODE.</div><h1>{job ? "Let’s make it ship-ready." : "Built fast? Ship with confidence."}</h1><p>{job ? "Understand the issues. Review the fixes. Keep control of every change." : "Find the hidden issues. Understand what matters. Fix with a little help."}</p></div>{job && <button className="secondary" onClick={() => { setJob(null); setError(""); }}><Plus size={16} />New scan</button>}</div>
        {error && <div className="error-banner dismissible" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError("")}><X size={16} /></button></div>}
        {!connected && <div className="offline-banner"><Activity size={17} /><span>Waiting for your local PRAXIS Workbench service. Start PRAXIS Workbench and retry.</span><button className="text-button" onClick={() => void refresh()}>Retry connection</button></div>}
        {job ? <><div className="live-status"><span className={`tiny-dot ${streamOnline ? "" : "gray"}`} />{streamOnline ? "Live updates connected" : "Reconnecting live updates · refreshing every 5 seconds"}</div><JobReport key={job.id} job={job} busy={busy} onFix={ids => action(() => postJob("fix", { finding_ids: ids, run_checks: false, trust_confirmed: false }))} onVerify={() => setDialog("verify")} onApply={() => setDialog("apply")} onCancel={() => action(() => postJob("cancel", {}))} onBudget={() => action(() => postJob("budget", { amount: 5 }))} /></> : <><ProjectInput busy={busy || !connected} onScan={source => action(() => api<Job>("/scans", { source, budget: 5 }))} /><div className="how-heading"><span>FROM “IT WORKS” TO “IT’S READY”</span><span>Three steps. A clearer codebase.</span></div><div className="steps-grid"><div className="step-card"><div className="step-top"><span className="step-icon"><Code2 size={21} /></span><span>01</span></div><h3>Bring your project</h3><p>A local folder or GitHub repo. PRAXIS Workbench reads a snapshot, so your source stays untouched.</p></div><div className="step-card"><div className="step-top"><span className="step-icon"><ShieldCheck size={21} /></span><span>02</span></div><h3>See what needs attention</h3><p>Security gaps, unfinished code, and UI issues. Clear explanations, backed by evidence.</p></div><div className="step-card"><div className="step-top"><span className="step-icon"><Sparkles size={21} /></span><span>03</span></div><h3>Let the team fix it</h3><p>Choose the issues. Agents work together. You review the changes before applying them.</p></div></div><div className="workspace-note"><span className="note-icon"><ShieldCheck size={19} /></span><div><strong>A thoughtful review, with boundaries.</strong><p>PRAXIS Workbench separates confirmed issues from suggestions and shows skipped checks. Each new job starts with a $5 model budget.{providerCount > 0 ? ` ${providerCount} provider${providerCount === 1 ? " is" : "s are"} configured.` : ""}</p></div></div></>}
        <footer className="page-footer"><span>PRAXIS Workbench · A little clarity goes a long way.</span><span><LockIcon />API keys stay on the backend</span></footer>
      </div>
    </main>
    {dialog && job && <ActionDialog kind={dialog} job={job} onClose={() => setDialog(null)} onConfirm={async command => { const value = await postJob(dialog === "verify" ? "verify" : "apply", dialog === "verify" ? { trust_confirmed: true, start_command: command } : { confirm: true }); if (value?.id) setJob(value); await refresh(); }} />}
    {help && <Help onClose={() => setHelp(false)} />}
    {settingsOpen && <ModelSettings health={health} onClose={() => setSettingsOpen(false)} onSaved={value => { setHealth(value); void refresh(); }} />}
  </div>;
}
function LockIcon() { return <ShieldCheck size={12} />; }
function Help({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="help-card" onCancel={onClose} aria-labelledby="help-title"><button className="dialog-close icon-button" onClick={onClose} aria-label="Close help"><X size={20} /></button><div className="eyebrow">YOUR CODE, WITH A SECOND LOOK</div><h2 id="help-title">How PRAXIS Workbench works</h2><p>Enter an absolute local folder path, a GitHub URL, or choose Upload folder. Uploads stage a copy; click Scan project when ready. Private repositories use the Git credentials already configured on your computer.</p><p>PRAXIS Workbench combines available scanners and AI analysis. The findings explain the issue, the evidence, and a possible fix. Missing tools appear as coverage gaps.</p><p>Select fixable findings to start parallel repairs in separate working copies. Review the patch and authorize project commands for verification. Download fixes for GitHub and uploaded folders; local path projects also support explicitly applying changes.</p><p>Relevant code is sent to your configured model provider. Keys stay on the server, detected secrets are redacted, and each job starts with a $5 budget.</p><button className="primary" onClick={onClose}>Got it</button></dialog>;
}
