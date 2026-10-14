"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

type Action = "navigate" | "fill" | "click" | "assert_text" | "assert_url";
type Step = { action: Action; path?: string; role?: string; control_name?: string; value?: string; text?: string };
type StateCheck = { name: string; path: string; json_pointer: string; expected: string; type: "text" | "number" | "boolean" | "null" };
export type JourneySpec = { name: string; steps: Step[]; state_assertions: Array<{ name: string; path: string; json_pointer: string; expected: unknown; require_change: true }> };
const localPath = (value = "") => /^\/[A-Za-z0-9_./~-]*$/.test(value) && !value.startsWith("//") && !value.split("/").some(part => part === "." || part === "..");
const actionLabels: Record<Action, string> = { navigate: "Open route", fill: "Fill field", click: "Click control", assert_text: "Observe text", assert_url: "Observe route" };

function expectedValue(check: StateCheck): unknown {
  if (check.type === "null") return null;
  if (check.type === "text") return check.expected;
  if (check.type === "boolean") { if (!["true", "false"].includes(check.expected)) throw new Error(); return check.expected === "true"; }
  if (!check.expected.trim() || !Number.isFinite(Number(check.expected))) throw new Error();
  return Number(check.expected);
}

export function JourneyEditor({ disabled, change }: { disabled: boolean; change: (spec: JourneySpec | null) => void }) {
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<Step[]>([{ action: "navigate", path: "/" }, { action: "click", role: "button", control_name: "" }, { action: "assert_text", text: "" }]);
  const [checks, setChecks] = useState<StateCheck[]>([]);
  function emit(nextName: string, nextSteps: Step[], nextChecks: StateCheck[]) {
    let interacted = false, observed = false;
    const valid = nextSteps.every(step => {
      if (step.action === "navigate" || step.action === "assert_url") { if (!localPath(step.path)) return false; }
      if (step.action === "fill" || step.action === "click") { interacted = true; if (!step.control_name?.trim()) return false; }
      if (step.action === "assert_text" && !step.text?.trim()) return false;
      if (interacted && (step.action === "assert_text" || step.action === "assert_url")) observed = true;
      return true;
    });
    if (!nextName.trim() || !valid || !interacted || !observed || nextSteps[0]?.action !== "navigate" || !["assert_text", "assert_url"].includes(nextSteps.at(-1)?.action || "")) { change(null); return; }
    try {
      if (nextChecks.some(check => !check.name.trim() || !localPath(check.path) || (check.json_pointer && !check.json_pointer.startsWith("/")))) throw new Error();
      change({ name: nextName.trim(), steps: nextSteps, state_assertions: nextChecks.map(check => ({ name: check.name.trim(), path: check.path, json_pointer: check.json_pointer, expected: expectedValue(check), require_change: true })) });
    } catch { change(null); }
  }
  function updateStep(index: number, patch: Partial<Step>) {
    const next = steps.map((step, i) => i === index ? { ...step, ...patch } : step); setSteps(next); emit(name, next, checks);
  }
  function updateCheck(index: number, patch: Partial<StateCheck>) {
    const next = checks.map((check, i) => i === index ? { ...check, ...patch } : check); setChecks(next); emit(name, steps, next);
  }
  return <div className="journey-editor">
    <p className="micro">Define the workflow you want observed. A complete journey also needs an independent, read-only API state change. Form values stay in this run’s memory; use non-sensitive test data.</p>
    <label className="field">Journey name<input required maxLength={80} disabled={disabled} value={name} onChange={e => { setName(e.target.value); emit(e.target.value, steps, checks); }} /></label>
    <ol className="journey-steps">{steps.map((step, index) => <li key={index}>
      <div className="journey-step-heading"><strong>Step {index + 1}</strong><select aria-label={`Step ${index + 1} action`} value={step.action} disabled={disabled || index === 0} onChange={e => {
        const action = e.target.value as Action;
        const nextStep: Step = action === "navigate" || action === "assert_url" ? { action, path: "/" } : action === "assert_text" ? { action, text: "" } : { action, role: action === "fill" ? "textbox" : "button", control_name: "", ...(action === "fill" ? { value: "" } : {}) };
        const next = steps.map((item, i) => i === index ? nextStep : item); setSteps(next); emit(name, next, checks);
      }}>{Object.entries(actionLabels).map(([action, label]) => <option key={action} value={action}>{label}</option>)}</select>
      {index > 0 && <button className="button icon-button" type="button" aria-label={`Remove step ${index + 1}`} disabled={disabled} onClick={() => { const next = steps.filter((_, i) => i !== index); setSteps(next); emit(name, next, checks); }}><Trash2 size={14} /></button>}</div>
      {(step.action === "navigate" || step.action === "assert_url") && <label className="field">Local route<input required maxLength={200} value={step.path || ""} disabled={disabled} onChange={e => updateStep(index, { path: e.target.value })} /></label>}
      {(step.action === "click" || step.action === "fill") && <div className="shared-fields"><label className="field">Accessible role<select aria-label="Accessible role" value={step.role} disabled={disabled} onChange={e => updateStep(index, { role: e.target.value })}>{(step.action === "fill" ? ["textbox", "combobox"] : ["button", "link"]).map(role => <option key={role}>{role}</option>)}</select></label><label className="field">Accessible name<input required maxLength={120} disabled={disabled} value={step.control_name || ""} onChange={e => updateStep(index, { control_name: e.target.value })} /></label></div>}
      {step.action === "fill" && <label className="field">Test input<input maxLength={500} autoComplete="off" disabled={disabled} value={step.value || ""} onChange={e => updateStep(index, { value: e.target.value })} /><small>No passwords, tokens or personal information.</small></label>}
      {step.action === "assert_text" && <label className="field">Text that should become visible<input required maxLength={200} disabled={disabled} value={step.text || ""} onChange={e => updateStep(index, { text: e.target.value })} /></label>}
    </li>)}</ol>
    <button type="button" className="button" disabled={disabled || steps.length >= 12} onClick={() => { const next: Step[] = [...steps, { action: "assert_text", text: "" }]; setSteps(next); emit(name, next, checks); }}><Plus size={14} />Add step</button>
    <h3>Independent backend state</h3><p className="micro">Only local GET requests are allowed. The expected value must be absent before the workflow and present afterward. An unchanged success response fails this check.</p>
    {checks.map((check, index) => <div className="journey-state-check" key={index}><div className="journey-step-heading"><strong>State check {index + 1}</strong><button type="button" className="button icon-button" disabled={disabled} aria-label={`Remove state check ${index + 1}`} onClick={() => { const next = checks.filter((_, i) => i !== index); setChecks(next); emit(name, steps, next); }}><Trash2 size={14} /></button></div>
      <label className="field">What should change?<input required maxLength={80} disabled={disabled} value={check.name} onChange={e => updateCheck(index, { name: e.target.value })} /></label>
      <div className="shared-fields"><label className="field">Local API route<input required maxLength={200} disabled={disabled} value={check.path} onChange={e => updateCheck(index, { path: e.target.value })} placeholder="/api/items" /></label><label className="field">JSON value path<input maxLength={200} disabled={disabled} value={check.json_pointer} onChange={e => updateCheck(index, { json_pointer: e.target.value })} placeholder="/count" /><small>A JSON pointer; leave empty for a scalar response.</small></label></div>
      <div className="shared-fields"><label className="field">Value type<select aria-label="Value type" value={check.type} disabled={disabled} onChange={e => updateCheck(index, { type: e.target.value as StateCheck["type"] })}><option value="text">Text</option><option value="number">Number</option><option value="boolean">True / false</option><option value="null">Null</option></select></label><label className="field">Expected value<input required={check.type !== "null"} disabled={disabled || check.type === "null"} maxLength={300} value={check.expected} onChange={e => updateCheck(index, { expected: e.target.value })} /></label></div>
    </div>)}
    <button type="button" className="button" disabled={disabled || checks.length >= 4} onClick={() => { const next: StateCheck[] = [...checks, { name: "", path: "", json_pointer: "", expected: "", type: "text" }]; setChecks(next); emit(name, steps, next); }}><Plus size={14} />Add state check</button>
    {!checks.length && <p className="micro">Without a state check, this records UI interaction only and leaves the full journey unproven.</p>}
  </div>;
}
