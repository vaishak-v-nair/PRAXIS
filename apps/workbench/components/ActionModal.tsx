"use client";
import { useState } from "react";
import { type Health, type Job, type RuntimeMode } from "@/lib/contracts";
import { message } from "@/lib/client";
import { Modal, Notice } from "./ui";
import { RuntimeControls } from "./RuntimeControls";
import { JourneyEditor, type JourneySpec } from "./JourneyEditor";

export function ActionModal({ kind, job, docker, close, submit }: { kind: "verify" | "apply"; job: Job; docker?: Health["docker"]; close: () => void; submit: (body: unknown) => Promise<unknown> }) {
  const [runtime, setRuntime] = useState<RuntimeMode | "">("");
  const [network, setNetwork] = useState(false);
  const [command, setCommand] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [journeyEnabled, setJourneyEnabled] = useState(false);
  const [structured, setStructured] = useState(false);
  const [structuredSpec, setStructuredSpec] = useState<JourneySpec | null>(null);
  const [journeyName, setJourneyName] = useState("");
  const [journeyPath, setJourneyPath] = useState("/");
  const [controlRole, setControlRole] = useState<"button" | "link">("button");
  const [controlName, setControlName] = useState("");
  const [expectedText, setExpectedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const journeyInvalid = journeyEnabled && ((structured ? !structuredSpec : (
    !journeyName.trim() || !controlName.trim() || !expectedText.trim() ||
    !/^\/(?:[A-Za-z0-9_-][A-Za-z0-9/_-]*)?$/.test(journeyPath))) ||
    (!command.trim() && !job.start_command)
  );
  const unavailable = kind === "verify" && (!runtime || (runtime === "docker" && !docker?.ready) || journeyInvalid);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accepted || busy || unavailable) return;
    setBusy(true);
    setError("");
    try {
      await submit(kind === "verify" ? {
        trust_confirmed: true, runtime_mode: runtime,
        allow_network: runtime === "docker" && network,
        start_command: runtime === "host" ? command.trim() || undefined : undefined,
        journey: runtime === "host" && journeyEnabled ? structured ? structuredSpec : {
          name: journeyName.trim(), path: journeyPath, role: controlRole,
          control_name: controlName.trim(), expected_text: expectedText.trim(),
        } : undefined,
      } : { confirm: true });
      close();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={kind === "verify" ? "Run project checks" : "Apply reviewed changes"} onClose={() => { if (!busy) close(); }}>
    <form onSubmit={onSubmit}>
      {kind === "verify" ? <>
        <p className="muted">Go beyond source inspection with real test and build outcomes. Commands run against the current review copy, after your explicit authorization.</p>
        <RuntimeControls runtime={runtime} network={network} accepted={accepted} busy={busy} docker={docker} commands={job.commands || []}
          setRuntime={next => { setRuntime(next); setJourneyEnabled(false); setNetwork(false); setAccepted(false); }}
          setNetwork={next => { setNetwork(next); setAccepted(false); }} setAccepted={setAccepted} />
        {runtime === "host" && <>
          <label className="field">Browser start command (optional)
            <input disabled={busy} value={command} onChange={e => { setCommand(e.target.value); setAccepted(false); }}
              placeholder={Array.isArray(job.start_command) ? job.start_command.join(" ") : "npm run dev"} />
            <small>Starting an app and reaching its homepage do not establish an end-to-end user journey.</small>
          </label>
          <label className="check-label"><input type="checkbox" checked={journeyEnabled} disabled={busy}
            onChange={e => { setJourneyEnabled(e.target.checked); setAccepted(false); }} />
            <span>Observe a user workflow in the browser</span></label>
          {journeyEnabled && <label className="field">Workflow depth<select aria-label="Workflow depth" value={structured ? "structured" : "simple"} disabled={busy} onChange={e => { setStructured(e.target.value === "structured"); setStructuredSpec(null); setAccepted(false); }}><option value="simple">One click and visible text</option><option value="structured">Multiple steps and backend state</option></select></label>}
          {journeyEnabled && structured && <JourneyEditor disabled={busy} change={spec => { setStructuredSpec(spec); setAccepted(false); }} />}
          {journeyEnabled && !structured && <div className="journey-fields">
            <p className="micro">PRAXIS opens the local app, clicks one accessible control, and checks that text becomes visible. The text must be absent before the click.</p>
            <label className="field">Journey name<input required maxLength={80} disabled={busy} value={journeyName}
              onChange={e => { setJourneyName(e.target.value); setAccepted(false); }} placeholder="Open account settings" /></label>
            <label className="field">Route path<input required maxLength={200} disabled={busy} value={journeyPath}
              onChange={e => { setJourneyPath(e.target.value); setAccepted(false); }} placeholder="/" /></label>
            <label className="field">Control type<select disabled={busy} value={controlRole}
              onChange={e => { setControlRole(e.target.value as "button" | "link"); setAccepted(false); }}>
              <option value="button">Button</option><option value="link">Link</option></select></label>
            <label className="field">Control's accessible name<input required maxLength={120} disabled={busy} value={controlName}
              onChange={e => { setControlName(e.target.value); setAccepted(false); }} placeholder="Settings" /></label>
            <label className="field">Text that should appear after click<input required maxLength={200} disabled={busy} value={expectedText}
              onChange={e => { setExpectedText(e.target.value); setAccepted(false); }} placeholder="Account preferences" /></label>
          </div>}
        </>}
      </> : <>
        <p className="muted">This copies the reviewed patch into your original local project. PRAXIS checks for source changes and keeps a backup before applying. Read the diff first.</p>
        <label className="check-label consent"><input type="checkbox" required checked={accepted} disabled={busy}
          onChange={e => setAccepted(e.target.checked)} /><span>I reviewed the patch and authorize applying it to my original source.</span></label>
      </>}
      {error && <Notice error>{error}</Notice>}
      <div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={close}>Cancel</button>
        <button className="button primary" disabled={!accepted || busy || unavailable}>{busy ? "Submitting…" : kind === "verify" ? "Run authorized checks" : "Apply changes"}</button></div>
    </form>
  </Modal>;
}
