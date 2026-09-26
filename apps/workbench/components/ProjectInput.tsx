"use client";
import { useRef, useState } from "react";
import { ArrowRight, FolderOpen, Github, LockKeyhole, Search, Upload } from "lucide-react";
import { api } from "./types";
import { prepareFolder, type UploadedFolder } from "./folderUpload";

export function ProjectInput({ onScan, busy }: { onScan: (source: string) => Promise<void>; busy: boolean }) {
  const [mode, setMode] = useState<"folder" | "github" | "upload">("folder");
  const [sources, setSources] = useState({ folder: "", github: "" });
  const [uploaded, setUploaded] = useState<UploadedFolder | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadError, setUploadError] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const source = mode === "upload" ? uploaded?.source || "" : sources[mode];
  const disabled = busy || uploading;
  const chooseFolder = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true); setUploadError(""); setMessage(""); setUploaded(null);
    try {
      const payload = await prepareFolder(list);
      const result = await api<UploadedFolder>("/uploads", { files: payload.files });
      setUploaded(result);
      setMessage(`${result.accepted_files} ${result.accepted_files === 1 ? "file" : "files"} ready · ${result.skipped_files + payload.skipped} excluded. Click Scan project to start review.`);
    } catch (error) { setUploadError(error instanceof Error ? error.message : "Folder upload failed."); }
    finally { setUploading(false); if (picker.current) picker.current.value = ""; }
  };
  return <section className="intake-card">
    <div className="card-eyebrow"><span className="tiny-dot" /> YOUR NEXT CLEAN START</div>
    <h2>Good code starts with<br />a second pair of eyes.</h2>
    <p className="intake-copy">Give PRAXIS Workbench your project. Get a clear picture of what needs attention, and a team of agents to help put it right.</p>
    <div className="input-tabs" role="tablist" aria-label="Project source">
      <button role="tab" disabled={uploading} aria-selected={mode === "folder"} onClick={() => setMode("folder")} className={mode === "folder" ? "active" : ""}><FolderOpen size={16} /> Local folder</button>
      <button role="tab" disabled={uploading} aria-selected={mode === "github"} onClick={() => setMode("github")} className={mode === "github" ? "active" : ""}><Github size={16} /> GitHub repository</button>
      <button role="tab" disabled={uploading} aria-selected={mode === "upload"} onClick={() => setMode("upload")} className={mode === "upload" ? "active" : ""}><Upload size={16} /> Upload folder</button>
    </div>
    <form onSubmit={async event => { event.preventDefault(); if (source.trim()) await onScan(source.trim()); }}>
      <label className="sr-only" htmlFor="project-source">{mode === "upload" ? "Uploaded project folder" : mode === "folder" ? "Absolute project folder path" : "GitHub repository URL"}</label>
      <div className="project-input"><span>{mode === "github" ? <Github size={19} /> : <FolderOpen size={19} />}</span><input id="project-source" value={mode === "upload" ? uploaded?.name || "" : source} readOnly={mode === "upload"} disabled={disabled} onChange={event => { if (mode !== "upload") setSources(previous => ({ ...previous, [mode]: event.target.value })); }} placeholder={mode === "upload" ? "Choose your project folder" : mode === "folder" ? "E:\\projects\\your-project" : "https://github.com/you/your-project"} required autoComplete="off" spellCheck={false} />{mode === "upload" && <button className="secondary" type="button" disabled={disabled} onClick={() => picker.current?.click()}>{uploading ? "Uploading…" : "Choose folder"}</button>}<button className="primary" disabled={disabled || !source.trim()} type="submit">{busy ? "Starting…" : "Scan project"}<ArrowRight size={17} /></button></div>
      <input ref={picker} type="file" multiple {...{ webkitdirectory: "", directory: "" }} hidden aria-label="Choose project folder" onChange={event => void chooseFolder(event.target.files)} />
    </form>
    {mode === "upload" && <p className="upload-status" role="status">{message || "Uploads create a separate copy. Credentials and generated files are excluded; fixes are downloaded for your original folder."}</p>}
    {mode === "upload" && uploadError && <p className="error-banner" role="alert">{uploadError}</p>}
    <div className="input-footnote"><LockKeyhole size={13} /><span>Your source stays untouched. API requests may include relevant code with detected secrets redacted.</span></div>
    <div className="scan-types"><span><Search size={14} /> Security & secrets</span><span>Code quality</span><span>UI & accessibility</span><span>Real functionality</span></div>
  </section>;
}
