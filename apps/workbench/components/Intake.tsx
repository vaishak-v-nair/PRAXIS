"use client";
import { useRef, useState } from "react";
import { ArrowUpRight, FolderUp, Github, Folder, Lock, ChevronRight, Cpu, FileSearch, CheckCircle2 } from "lucide-react";
import { message } from "@/lib/client";
import { prepareFolder, uploadFolder, type UploadedFolder, type UploadProgress } from "@/lib/upload";
import type { Health, RuntimeMode } from "@/lib/contracts";
import { Notice } from "./ui";
import { RuntimeControls } from "./RuntimeControls";

type SourceMode = "folder" | "github" | "upload";

export function Intake({ disabled, health, start, models }: { disabled: boolean; health: Health | null; start: (body: unknown) => Promise<unknown>; models: () => void }) {
  const [mode, setMode] = useState<SourceMode>("upload");
  const [source, setSource] = useState({ folder: "", github: "" });
  const [upload, setUpload] = useState<UploadedFolder | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [trust, setTrust] = useState(false); const [network, setNetwork] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeMode | "">("");
  const [runChecks, setRunChecks] = useState(false); const [aiReview, setAiReview] = useState(false);
  const [budget, setBudget] = useState("5");
  const [goal, setGoal] = useState("");
  const [reviewMode, setReviewMode] = useState("team");
  const picker = useRef<HTMLInputElement>(null);
  const busy = disabled || uploading;
  const value = mode === "upload" ? upload?.source || "" : source[mode];
  const configured = health?.providers?.filter(item => item.configured).length || 0;
  const invalidOptions = (runChecks && (!runtime || !trust || (runtime === "docker" && !health?.docker?.ready))) || (aiReview && !configured);
  async function choose(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true); setError(""); setUpload(null); setTrust(false);
    try {
      const data = await prepareFolder(files);
      setProgress({ files: 0, totalFiles: data.files.length, bytes: 0, totalBytes: data.bytes });
      setUpload(await uploadFolder(data, setProgress));
    } catch (error) { setError(message(error)); }
    finally { setUploading(false); setProgress(null); if (picker.current) picker.current.value = ""; }
  }
  return <div className="intake-layout">
    <section className="intake-panel" aria-labelledby="intake-title">
      <div className="section-label">New review</div>
      <h2 id="intake-title">What have you been building?</h2>
      <p className="muted">Find gaps in your project before people find them. The first source review needs no Docker or API key.</p>
      <div className="intake-facts" aria-label="Review capabilities"><span><Lock size={14} />Separate review copy</span><span><FileSearch size={14} />Source inspection included</span><span><CheckCircle2 size={14} />No project commands by default</span></div>
      <div className="source-picker" role="group" aria-label="Project source">
        {[{ id: "upload" as const, label: "Upload folder", Icon: FolderUp }, { id: "folder" as const, label: "Local path", Icon: Folder }, { id: "github" as const, label: "GitHub URL", Icon: Github }].map(({ id, label, Icon }) => <button key={id} disabled={busy} aria-pressed={mode === id} onClick={() => { setMode(id); setTrust(false); setError(""); }}><Icon size={16} />{label}</button>)}
      </div>
      <form onSubmit={async event => { event.preventDefault(); if (busy || !value.trim() || invalidOptions) return; setError(""); try { await start({ source: value.trim(), budget: Number(budget), ai_review: aiReview, review_mode: reviewMode, review_goal: goal.trim(), run_checks: runChecks, trust_confirmed: runChecks && trust, runtime_mode: runtime || "docker", allow_network: runChecks && runtime === "docker" && network }); } catch (error) { setError(message(error)); } }}>
        {mode === "upload" ? <div className="upload-zone"><FolderUp size={28} /><strong>{upload?.name || "Your project, kept local"}</strong><p>{upload ? `${upload.accepted_files.toLocaleString()} files ready · ${upload.skipped_files.toLocaleString()} excluded` : progress ? `Uploading ${progress.files.toLocaleString()} of ${progress.totalFiles.toLocaleString()} files · ${(progress.bytes / 1024 / 1024).toFixed(1)} of ${(progress.totalBytes / 1024 / 1024).toFixed(1)} MiB` : "Large projects upload in safe batches. Dependencies, credentials, generated output and files above 2 MiB are excluded."}</p>{progress && <progress aria-label="Folder upload progress" max={progress.totalBytes || progress.totalFiles} value={progress.totalBytes ? progress.bytes : progress.files} />}<button type="button" className="button" disabled={busy} onClick={() => picker.current?.click()}>{uploading ? "Uploading project…" : upload ? "Choose another folder" : "Choose folder"}</button><input type="file" ref={picker} multiple {...{ webkitdirectory: "", directory: "" }} hidden aria-label="Upload project folder" onChange={e => void choose(e.target.files)} /></div> : <label className="field">{mode === "folder" ? "Project folder path" : "Repository URL"}<input id="project-source" disabled={busy} value={value} onChange={e => { setSource(prev => ({ ...prev, [mode]: e.target.value })); setTrust(false); }} placeholder={mode === "folder" ? "E:\\projects\\my-app" : "https://github.com/owner/repository"} spellCheck={false} autoComplete="off" required /> <small>{mode === "folder" ? "PRAXIS reviews a separate snapshot, including uncommitted changes." : "Private repositories use your existing local Git credentials."}</small></label>}
        <label className="field">What should this project do? <small>Optional · keep the review focused on your intended workflow</small><textarea maxLength={4000} rows={3} value={goal} disabled={busy} onChange={e => setGoal(e.target.value)} placeholder="Describe the user workflow and anything you want checked." /></label>
        <div className="source-check-note"><FileSearch size={19} /><div><strong>Source inspection is included.</strong><p>Look for code-backed risks, exposed secrets, incomplete paths and missing checks. Source inspection alone cannot establish runtime behavior or production readiness.</p></div></div>
        <details className="review-details"><summary>Optional: AI review and project checks<span>Add depth when you need it</span></summary>
          <div className="review-option"><label className="check-label"><input type="checkbox" checked={aiReview} disabled={busy || (!configured && !aiReview)} onChange={e => setAiReview(e.target.checked)} /><span><strong>Add connected model review</strong><small>{configured ? `${configured} provider${configured === 1 ? " has" : "s have"} a configured key. Access and credits are checked only on a request.` : "No provider is configured. Your source review still works without one."}</small></span></label><button type="button" className="button small" disabled={busy} onClick={models}><Cpu size={14} />Manage model connection</button></div>
          {aiReview && <><label className="field">Review approach<select value={reviewMode} disabled={busy} onChange={e => setReviewMode(e.target.value)}><option value="team">Collaborative AI team · review and peer challenge</option><option value="ultra">Independent model perspectives</option></select></label><label className="field inline-field"><span>Model spending limit<small>Shared across review and repair · USD</small></span><input aria-label="Model budget in dollars" type="number" min="0.01" max="1000" step="0.01" value={budget} required disabled={busy} onChange={e => setBudget(e.target.value)} /></label><p className="micro">Model review sends bounded, redacted source excerpts to your chosen providers. Model opinions remain separate from executed evidence.</p></>}
          <div className="review-option"><label className="check-label"><input type="checkbox" checked={runChecks} disabled={busy} onChange={e => { setRunChecks(e.target.checked); setTrust(false); }} /><span><strong>Also run project commands</strong><small>Optional install, test, lint and build checks. Choose an environment and authorize execution first.</small></span></label></div>
          {runChecks && <RuntimeControls runtime={runtime} network={network} accepted={trust} busy={busy} docker={health?.docker} setRuntime={next => { setRuntime(next); setTrust(false); setNetwork(false); }} setNetwork={next => { setNetwork(next); setTrust(false); }} setAccepted={setTrust} />}
        </details>
        {error && <Notice error>{error}</Notice>}
        <div className="intake-submit"><span><Lock size={13} />Original source stays untouched</span><button className="button primary" disabled={busy || !value.trim() || invalidOptions} type="submit">{uploading ? "Preparing folder…" : "Review project"}<ArrowUpRight size={18} /></button></div>
        <p className="micro review-scope-line">Source inspection{aiReview ? " · Connected model review" : " · No model calls"}{runChecks && runtime && trust ? ` · Authorized ${runtime === "host" ? "local" : "Docker"} project commands` : runChecks ? " · Project checks awaiting authorization" : " · No project commands"}</p>
      </form>
    </section>
    <aside className="method-panel"><div className="section-label">From uncertainty to a next step</div><h2>You built it.<br />Now take a closer look.</h2><ol>{[
      ["Find the gap", "Start with a source review. No Docker or model key needed."], ["Inspect the evidence", "See the affected code, its practical risk and what remains untested."], ["Give your agent a brief", "Copy findings and context, then review a repair plan before making changes."]
    ].map(([name, detail], i) => <li key={name}><span className="method-index">0{i + 1}</span><div><h3>{name}</h3><p>{detail}</p></div><ChevronRight size={15} /></li>)}</ol>
      <div className="method-boundary"><Lock size={18} /><p>Your first review inspects a separate copy. Running project commands is an explicit, optional next step.</p></div>
      <p className="micro data-boundary">Dependency lookup may send package names and versions to OSV. Local conversation memory stays private.</p>
    </aside>
  </div>;
}
