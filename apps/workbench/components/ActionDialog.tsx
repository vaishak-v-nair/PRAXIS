"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { Job } from "./types";

export function ActionDialog({ kind, job, onClose, onConfirm }: { kind: "verify" | "apply"; job: Job; onClose: () => void; onConfirm: (command?: string) => Promise<void> }) {
  const [accepted, setAccepted] = useState(false);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="action-dialog" onCancel={onClose} aria-labelledby="dialog-title">
    <button className="dialog-close icon-button" onClick={onClose} aria-label="Close dialog"><X size={20} /></button>
    <div className="dialog-icon"><AlertTriangle size={23} /></div>
    <h2 id="dialog-title">{kind === "verify" ? "Trust this project's commands?" : "Apply these changes to your source?"}</h2>
    <p>{kind === "verify" ? "Verification runs project commands in the isolated working copy. These commands can execute code and access your computer. Only continue for a project you trust." : "PRAXIS Workbench will copy the reviewed changes into the original project. It will first check that the source has not changed since this scan."}</p>
    {kind === "verify" && <><div className="command-list">{job.commands?.length ? job.commands.map((item, index) => <code key={index}>{Array.isArray(item) ? item.join(" ") : item.argv?.join(" ") || item.label}</code>) : <p>No build or test commands were discovered.</p>}{job.start_command && <code>Browser start: {Array.isArray(job.start_command) ? job.start_command.join(" ") : job.start_command}</code>}{!job.start_command && <p>Add a start command below to enable browser checks.</p>}</div><label className="field-label" htmlFor="start-command">Web start command <span>(optional override)</span></label><input className="standalone-input" id="start-command" placeholder="npm run dev -- --port 3001" value={command} onChange={e => setCommand(e.target.value)} /></>}
    <label className="trust-check"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /><span>{kind === "verify" ? "I trust this project and authorize the commands shown above and my override, if provided." : "I have reviewed the diff and want to apply it to my original project."}</span></label>
    {error && <div role="alert" className="error-banner">{error}</div>}
    <div className="dialog-actions"><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={!accepted || busy} onClick={async () => { setBusy(true); try { await onConfirm(command.trim() || undefined); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); } finally { setBusy(false); } }}>{busy ? "Working…" : kind === "verify" ? "Run verification" : "Apply changes"}</button></div>
  </dialog>;
}
