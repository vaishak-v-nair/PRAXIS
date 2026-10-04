"use client";
import { useRef, useState } from "react";
import { ArrowUpRight, FolderUp, Github, Folder, Lock, ChevronRight, Cpu, Box, FileSearch, Gauge, CheckCircle2, AlertCircle, Layers3 } from "lucide-react";
import { message } from "@/lib/client";
import { prepareFolder, uploadFolder, type UploadedFolder, type UploadProgress } from "@/lib/upload";
import type { Health } from "@/lib/contracts";
import { Notice } from "./ui";

export function Intake({ disabled, health, start, models }: { disabled: boolean; health: Health | null; start: (body: unknown) => Promise<unknown>; models: () => void }) {
  const [mode, setMode] = useState("folder");
  const [source, setSource] = useState({ folder: "", github: "" });
  const [upload, setUpload] = useState<UploadedFolder | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [trust, setTrust] = useState(false); const [network, setNetwork] = useState(false);
  const [budget, setBudget] = useState("5");
  const [goal, setGoal] = useState("");
  const [reviewMode, setReviewMode] = useState("team");
  const picker = useRef<HTMLInputElement>(null);
  const busy = disabled || uploading;
  const value = mode === "upload" ? upload?.source || "" : source[mode as "folder" | "github"];
  const configured = health?.providers?.filter(item => item.configured).length || 0;
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
      <h2 id="intake-title">Start with your project.</h2>
      <p className="muted">Choose a source. PRAXIS reviews a separate copy.</p>
      <div className="intake-facts" aria-label="Workspace capabilities"><span><Lock size={14} />Local workspace</span><span><Gauge size={14} />100 MiB batched upload</span><span className={health?.docker?.ready ? "ready" : "attention"}>{health?.docker?.ready ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{!health ? "Checking Docker…" : health.docker?.ready ? "Docker ready" : "Docker setup needed"}</span></div>
      <div className="source-picker" role="group" aria-label="Project source">
        {[{ id: "folder", label: "Local path", Icon: Folder }, { id: "github", label: "GitHub URL", Icon: Github }, { id: "upload", label: "Upload folder", Icon: FolderUp }].map(({ id, label, Icon }) => <button key={id} disabled={busy} aria-pressed={mode === id} onClick={() => { setMode(id); setTrust(false); setError(""); }}><Icon size={16} />{label}</button>)}
      </div>
      <form onSubmit={async event => { event.preventDefault(); setError(""); try { await start({ source: value.trim(), budget: Number(budget), ai_review: true, review_mode: reviewMode, review_goal: goal.trim(), run_checks: true, trust_confirmed: trust, allow_network: network }); } catch (error) { setError(message(error)); } }}>
        {mode === "upload" ? <div className="upload-zone"><FolderUp size={28} /><strong>{upload?.name || "Your project, kept local"}</strong><p>{upload ? `${upload.accepted_files.toLocaleString()} files ready · ${upload.skipped_files.toLocaleString()} excluded` : progress ? `Uploading ${progress.files.toLocaleString()} of ${progress.totalFiles.toLocaleString()} files · ${(progress.bytes / 1024 / 1024).toFixed(1)} of ${(progress.totalBytes / 1024 / 1024).toFixed(1)} MiB` : "Large projects upload in safe batches. Dependencies, credentials, generated output and files above 2 MiB are excluded."}</p>{progress && <progress aria-label="Folder upload progress" max={progress.totalBytes || progress.totalFiles} value={progress.totalBytes ? progress.bytes : progress.files} />}<button type="button" className="button" disabled={busy} onClick={() => picker.current?.click()}>{uploading ? "Uploading project…" : upload ? "Choose another folder" : "Choose folder"}</button><input type="file" ref={picker} multiple {...{ webkitdirectory: "", directory: "" }} hidden aria-label="Upload project folder" onChange={e => void choose(e.target.files)} /></div> : <label className="field">{mode === "folder" ? "Project folder path" : "Repository URL"}<input id="project-source" disabled={busy} value={value} onChange={e => { setSource(prev => ({ ...prev, [mode]: e.target.value })); setTrust(false); }} placeholder={mode === "folder" ? "E:\\projects\\my-app" : "https://github.com/owner/repository"} spellCheck={false} autoComplete="off" required /> <small>{mode === "folder" ? "PRAXIS reviews a separate snapshot, including uncommitted changes." : "Private repositories use your existing local Git credentials."}</small></label>}
        <label className="field">What should this project do? <small>Optional · helps specialists focus on your intended workflow</small><textarea maxLength={4000} rows={3} value={goal} disabled={busy} onChange={e => setGoal(e.target.value)} placeholder="Describe the user workflow and anything you want checked." /></label>
        <details className="review-details"><summary>What this review includes<span>Source · models · runtime</span></summary>
        <label className="field">Review approach<select value={reviewMode} disabled={busy} onChange={e => setReviewMode(e.target.value)}><option value="team">Collaborative AI team · review and peer challenge</option><option value="ultra">Independent model perspectives</option></select></label>
        <section className="unified-review" aria-label="Complete review pipeline">
          <div className="unified-review-title"><Layers3 size={19} /><div><strong>PRAXIS full engineering review</strong><small>Every available layer contributes to one evidence-backed decision.</small></div></div>
          <ol>
            <li><FileSearch size={17} /><div><strong>Inspect the source</strong><small>Inventory, syntax, leakage, dependencies, incomplete paths, and false-success patterns.</small></div><StatusMark ready label="Local" /></li>
            <li><Cpu size={17} /><div><strong>Challenge it with connected models</strong><small>Four specialists inspect redacted source, then challenge each other’s findings. All calls share your spending limit.</small></div><StatusMark ready={!!health?.providers?.some(item => item.configured)} label={health?.providers?.some(item => item.configured) ? "Configured" : "Unavailable"} /></li>
            <li><Box size={17} /><div><strong>Execute discovered checks</strong><small>Install, test, lint, and build commands run in the isolated Docker copy.</small></div><StatusMark ready={!!health?.docker?.ready} label={health?.docker?.ready ? "Ready" : "Unavailable"} /></li>
          </ol>
        </section>
        </details>
        <p className={`runtime-readiness ${health?.docker?.ready ? "ready" : "attention"}`} role="status">{health?.docker?.detail || "Checking Docker readiness…"}</p>
        <label className="field inline-field"><span>Model spending limit<small>Shared across review and repair · USD</small></span><input aria-label="Model budget in dollars" type="number" min="0.01" max="1000" step="0.01" value={budget} required disabled={busy} onChange={e => setBudget(e.target.value)} /></label>
        <div className="consent"><label><input type="checkbox" checked={network} disabled={busy} onChange={e => { setNetwork(e.target.checked); setTrust(false); }} /><span>Allow network access for dependency downloads and project commands. This includes local-network access.</span></label><label><input type="checkbox" required checked={trust} disabled={busy} onChange={e => setTrust(e.target.checked)} /><span>I trust this project and authorize its discovered install, test, lint and build commands in the isolated Docker copy.</span></label></div>
        {error && <Notice error>{error}</Notice>}
        <div className="intake-submit"><span><Lock size={13} />Original source stays untouched</span><button className="button primary" disabled={busy || !value.trim() || !trust} type="submit">{uploading ? "Preparing folder…" : "Run complete review"}<ArrowUpRight size={18} /></button></div>
      </form>
    </section>
    <aside className="method-panel"><div className="section-label">A second look, with proof</div><h2>Clarity before<br />your next release.</h2><ol>{[
      ["Understand", "Map the stack, plans, entry points, and tests."], ["Inspect", "Find source-backed risks, gaps, and false-success paths."], ["Execute", "Record the outcome of authorized tests and builds."], ["Decide", "Review what was demonstrated and what remains unproven."]
    ].map(([name, detail], i) => <li key={name}><span className="method-index">0{i + 1}</span><div><h3>{name}</h3><p>{detail}</p></div><ChevronRight size={15} /></li>)}</ol>
      <div className="model-setup"><div><Cpu size={17} /><strong>{configured ? `${configured} provider${configured === 1 ? "" : "s"} configured` : "Set up your model"}</strong></div>
        <p>{configured ? "API keys are present. Availability and credit are checked when you make a request." : "Configure a provider key on the backend, then choose your model."}</p>
        <button className="button" onClick={models}>Model settings<ArrowUpRight size={15} /></button>
      </div>
      <p className="micro data-boundary"><Lock size={14} />Model review sends bounded, redacted excerpts to your providers. Dependency lookup may send package names and versions to OSV. Your local conversation memory stays private.</p>
    </aside>
  </div>;
}

function StatusMark({ ready, label }: { ready: boolean; label: string }) {
  return <span className={`scope-status ${ready ? "ready" : "attention"}`}>{ready ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}{label}</span>;
}
