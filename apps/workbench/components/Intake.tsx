"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, FolderUp, Github, Folder, Lock } from "lucide-react";
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
  useEffect(() => {
    const project = new URLSearchParams(window.location.search).get("project");
    // Desktop folder picker is a prefill, never an execution instruction.
    if (project && project.length <= 4096) {
      setMode("folder"); setSource(previous => ({ ...previous, folder: project }));
      const url = new URL(window.location.href); url.searchParams.delete("project"); url.searchParams.set("new", "1");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, []);
  const busy = disabled || uploading;
  const value = mode === "upload" ? upload?.source || "" : source[mode];
  const selectedProvider = health?.settings?.provider || "";
  const selectedConfigured = !!health?.providers?.find(item => item.name === selectedProvider)?.configured;
  const invalidOptions = (runChecks && (!runtime || !trust || (runtime === "docker" && !health?.docker?.ready))) || (aiReview && !selectedConfigured);
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
      <h2 id="intake-title">Start a review</h2>
      <p className="muted">Choose a project. PRAXIS inspects its source first; model analysis and project commands run only if you choose them.</p>
      <div className="source-picker" role="group" aria-label="Project source">
        {[{ id: "upload" as const, label: "Upload folder", Icon: FolderUp }, { id: "folder" as const, label: "Local path", Icon: Folder }, { id: "github" as const, label: "GitHub URL", Icon: Github }].map(({ id, label, Icon }) => <button key={id} disabled={busy} aria-pressed={mode === id} onClick={() => { setMode(id); setTrust(false); setError(""); }}><Icon size={16} />{label}</button>)}
      </div>
      <form onSubmit={async event => { event.preventDefault(); if (busy || !value.trim() || invalidOptions) return; setError(""); try { await start({ source: value.trim(), budget: Number(budget), ai_review: aiReview, review_mode: reviewMode, review_goal: goal.trim(), run_checks: runChecks, trust_confirmed: runChecks && trust, runtime_mode: runtime || "docker", allow_network: runChecks && runtime === "docker" && network }); } catch (error) { setError(message(error)); } }}>
        {mode === "upload" ? <div className="upload-zone"><FolderUp size={28} /><strong>{upload?.name || "Your project, kept local"}</strong><p>{upload ? `${upload.accepted_files.toLocaleString()} files ready · ${upload.skipped_files.toLocaleString()} excluded` : progress ? `Uploading ${progress.files.toLocaleString()} of ${progress.totalFiles.toLocaleString()} files · ${(progress.bytes / 1024 / 1024).toFixed(1)} of ${(progress.totalBytes / 1024 / 1024).toFixed(1)} MiB` : "Large projects upload in safe batches. Dependencies, credentials, generated output and files above 2 MiB are excluded."}</p>{progress && <progress aria-label="Folder upload progress" max={progress.totalBytes || progress.totalFiles} value={progress.totalBytes ? progress.bytes : progress.files} />}<button type="button" className="button" disabled={busy} onClick={() => picker.current?.click()}>{uploading ? "Uploading project…" : upload ? "Choose another folder" : "Choose folder"}</button><input type="file" ref={picker} multiple {...{ webkitdirectory: "", directory: "" }} hidden aria-label="Upload project folder" onChange={e => void choose(e.target.files)} /></div> : <label className="field">{mode === "folder" ? "Project folder path" : "Repository URL"}<input id="project-source" disabled={busy} value={value} onChange={e => { setSource(prev => ({ ...prev, [mode]: e.target.value })); setTrust(false); }} placeholder={mode === "folder" ? "E:\\projects\\my-app" : "https://github.com/owner/repository"} spellCheck={false} autoComplete="off" required /> <small>{mode === "folder" ? "PRAXIS reviews a separate snapshot, including uncommitted changes." : "Private repositories use your existing local Git credentials."}</small></label>}
        <label className="field">What should it do? <small>Optional · helps focus the review</small><textarea maxLength={4000} rows={3} value={goal} disabled={busy} onChange={e => setGoal(e.target.value)} placeholder="For example: a user can sign in and save a project." /></label>
        <div className="intake-ai-option"><label className="check-label"><input type="checkbox" checked={aiReview} disabled={busy || (!selectedConfigured && !aiReview)} onChange={e => setAiReview(e.target.checked)} /><span><strong>Use AI for a deeper review</strong><small>{selectedConfigured ? `Optional analysis with ${selectedProvider}. Access is checked when the review starts.` : "Optional. Connect a model to enable it; source inspection works without one."}</small></span></label><button type="button" className="text-link" disabled={busy} onClick={models}>{selectedConfigured ? "Manage AI" : "Connect AI"}</button></div>
        {aiReview && <div className="intake-ai-budget"><label className="field inline-field"><span>AI spending limit<small>Shared across review and repair · USD</small></span><input aria-label="Model budget in dollars" type="number" min="0.01" max="1000" step="0.01" value={budget} required disabled={busy} onChange={e => setBudget(e.target.value)} /></label><p className="micro">AI observations support the review; they do not establish that the project works.</p></div>}
        <details className="review-details"><summary>Checks and advanced settings<span>Project execution is off by default</span></summary>
          {aiReview && <label className="field">Review approach<select value={reviewMode} disabled={busy} onChange={e => setReviewMode(e.target.value)}><option value="team">Collaborative AI review and peer challenge</option><option value="ultra">Independent model perspectives</option></select></label>}
          <div className="review-option"><label className="check-label"><input type="checkbox" checked={runChecks} disabled={busy} onChange={e => { setRunChecks(e.target.checked); setTrust(false); }} /><span><strong>Also run project commands</strong><small>Optional install, test, lint and build checks. Choose an environment and authorize execution first.</small></span></label></div>
          {runChecks && <RuntimeControls runtime={runtime} network={network} accepted={trust} busy={busy} docker={health?.docker} setRuntime={next => { setRuntime(next); setTrust(false); setNetwork(false); }} setNetwork={next => { setNetwork(next); setTrust(false); }} setAccepted={setTrust} />}
        </details>
        {error && <Notice error>{error}</Notice>}
        <div className="intake-submit"><span><Lock size={13} />Original source stays untouched</span><button className="button primary" disabled={busy || !value.trim() || invalidOptions} type="submit">{uploading ? "Preparing folder…" : "Review project"}<ArrowUpRight size={18} /></button></div>
        <p className="micro review-scope-line">This review starts with source inspection{aiReview ? " and AI analysis" : ""}{runChecks && runtime && trust ? `, plus authorized ${runtime === "host" ? "local" : "Docker"} checks` : ""}. No project command runs without your approval.</p>
      </form>
    </section>
  </div>;
}
