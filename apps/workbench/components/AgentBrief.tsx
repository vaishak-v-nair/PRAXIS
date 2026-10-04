"use client";
import { useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, Clipboard, Download, FileText } from "lucide-react";
import type { Job } from "@/lib/contracts";
import { localAgentBrief } from "@/lib/agent-brief.mjs";
import { Notice } from "./ui";

export function AgentBrief({ job, findingIds, compact = false, id }: { job: Job; findingIds?: string[]; compact?: boolean; id?: string }) {
  const result = useMemo(() => { try { return { text: localAgentBrief(job, findingIds), error: "" }; } catch (error) { return { text: "", error: error instanceof Error ? error.message : "This review cannot be copied yet." }; } }, [job, findingIds]);
  const [copiedText, setCopiedText] = useState(""); const [copyError, setCopyError] = useState("");
  const preview = useRef<HTMLDetailsElement>(null); const textArea = useRef<HTMLTextAreaElement>(null);
  async function copy() {
    setCopyError("");
    try { await navigator.clipboard.writeText(result.text); setCopiedText(result.text); }
    catch { setCopiedText(""); setCopyError("Clipboard access is unavailable. Select the brief below to copy it, or download it."); if (preview.current) preview.current.open = true; textArea.current?.focus(); textArea.current?.select(); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([result.text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "praxis-project-review-brief.txt"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const copied = !!result.text && copiedText === result.text;
  return <section id={id} tabIndex={id ? -1 : undefined} className={`agent-brief ${compact ? "compact" : ""}`} aria-label="Findings handoff">
    <div className="agent-brief-heading"><span className="brief-icon"><FileText size={20} /></span><div><div className="section-label">Your next step</div><h3>{compact ? "Take this finding to your agent." : "Give your agent a clear next step."}</h3><p>Copy the recorded findings, project context and evidence limits. No connected provider or model request is needed.</p></div></div>
    {(result.error || copyError) && <Notice error>{result.error || copyError}</Notice>}
    <div className="agent-brief-actions"><button type="button" className="button primary" disabled={!result.text} onClick={() => void copy()}>{copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? "Findings copied" : "Copy findings to my agent"}<ArrowUpRight size={16} /></button><button type="button" className="button" disabled={!result.text} onClick={download}><Download size={16} />Download brief</button></div>
    <p className="micro">Copying is not repair approval. Your agent should check the current source and show you a plan before changing it.</p>
    {result.text && <details ref={preview} className="brief-preview"><summary>Preview exactly what will be copied</summary><textarea ref={textArea} aria-label="Findings handoff text" readOnly value={result.text} spellCheck={false} /></details>}
  </section>;
}
