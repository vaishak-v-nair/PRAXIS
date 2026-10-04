"use client";
import { useState } from "react";
import { type Health, type Job, type RuntimeMode } from "@/lib/contracts";
import { message } from "@/lib/client";
import { Modal, Notice } from "./ui";
import { RuntimeControls } from "./RuntimeControls";

export function ActionModal({ kind, job, docker, close, submit }: { kind: "verify" | "apply"; job: Job; docker?: Health["docker"]; close: () => void; submit: (body: unknown) => Promise<unknown> }) {
  const [runtime, setRuntime] = useState<RuntimeMode | "">(""); const [network, setNetwork] = useState(false);
  const [command, setCommand] = useState(""); const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const unavailable = kind === "verify" && (!runtime || (runtime === "docker" && !docker?.ready));
  return <Modal title={kind === "verify" ? "Run project checks" : "Apply reviewed changes"} onClose={() => { if (!busy) close(); }}>
    <form onSubmit={async event => { event.preventDefault(); if (!accepted || busy || unavailable) return; setBusy(true); setError(""); try { await submit(kind === "verify" ? { trust_confirmed: true, runtime_mode: runtime, allow_network: runtime === "docker" && network, start_command: runtime === "host" ? command.trim() || undefined : undefined } : { confirm: true }); close(); } catch (error) { setError(message(error)); } finally { setBusy(false); } }}>
      {kind === "verify" ? <><p className="muted">Go beyond source inspection with real test and build outcomes. Commands run against the current review copy, after your explicit authorization.</p><RuntimeControls runtime={runtime} network={network} accepted={accepted} busy={busy} docker={docker} commands={job.commands || []} setRuntime={next => { setRuntime(next); setNetwork(false); setAccepted(false); }} setNetwork={next => { setNetwork(next); setAccepted(false); }} setAccepted={setAccepted} />{runtime === "host" && <label className="field">Browser start command (optional)<input disabled={busy} value={command} onChange={e => { setCommand(e.target.value); setAccepted(false); }} placeholder={Array.isArray(job.start_command) ? job.start_command.join(" ") : "npm run dev"} /><small>Starting an app and reaching its homepage do not establish an end-to-end user journey.</small></label>}</> : <><p className="muted">This copies the reviewed patch into your original local project. PRAXIS checks for source changes and keeps a backup before applying. Read the diff first.</p><label className="check-label consent"><input type="checkbox" required checked={accepted} disabled={busy} onChange={e => setAccepted(e.target.checked)} /><span>I reviewed the patch and authorize applying it to my original source.</span></label></>}
      {error && <Notice error>{error}</Notice>}<div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={close}>Cancel</button><button className="button primary" disabled={!accepted || busy || unavailable}>{busy ? "Submitting…" : kind === "verify" ? "Run authorized checks" : "Apply changes"}</button></div>
    </form>
  </Modal>;
}
