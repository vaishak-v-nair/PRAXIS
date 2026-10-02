"use client";
import { useId, useState } from "react";
import type { Health } from "@/lib/contracts";
import { request, message } from "@/lib/client";
import { Modal, Notice, Status } from "./ui";

type Probe = { provider: string; model: string; compatible: boolean; detail: string; cost: number; elapsed_ms: number };
export function ProviderModal({ health, close, saved }: { health: Health | null; close: () => void; saved: (health: Health) => void }) {
  const initial = health?.settings;
  const [provider, setProvider] = useState(initial?.provider || "openrouter");
  const [model, setModel] = useState(initial?.model || "");
  const [input, setInput] = useState(initial?.input_price != null ? String(Number(initial.input_price) * 1e6) : "");
  const [output, setOutput] = useState(initial?.output_price != null ? String(Number(initial.output_price) * 1e6) : "");
  const [busy, setBusy] = useState(""); const [error, setError] = useState(""); const [probe, setProbe] = useState<Probe | null>(null);
  const [key, setKey] = useState(""); const [keyNotice, setKeyNotice] = useState("");
  const keyId = useId(), keyHelpId = useId();
  const payload = { provider, model: model.trim(), input_price: provider === "openrouter" ? null : Number(input) / 1e6, output_price: provider === "openrouter" ? null : Number(output) / 1e6 };
  const valid = !!model.trim() && (provider === "openrouter" || (input !== "" && output !== "" && Number(input) >= 0 && Number(output) >= 0));
  const providers = Array.isArray(health?.providers) ? health.providers as Array<{ name: string; configured: boolean; key_source?: string }> : [];
  const environmentKey = providers.some(item => item.name === provider && item.key_source === "environment");
  async function saveKey() {
    setBusy("key"); setError(""); setKeyNotice("");
    try {
      saved(await request<Health>("/providers/key", { provider, api_key: key }));
      setKey(""); setKeyNotice("Key saved on this computer. Provider access has not been tested."); setProbe(null);
    } catch (error) { setError(message(error)); } finally { setBusy(""); }
  }
  async function act(kind: "probe" | "save") {
    setBusy(kind); setError("");
    try {
      if (kind === "probe") setProbe(await request<Probe>("/providers/probe", payload));
      else { const value = await request<Health>("/settings", payload); saved(value); if (value.settings?.provider !== provider || value.settings?.model !== model.trim()) setError("Settings saved, but environment overrides are selecting another model. Update REGEN_PROVIDER / REGEN_MODEL in the backend environment."); else close(); }
    } catch (error) { setError(message(error)); } finally { setBusy(""); }
  }
  return <Modal title="Model connection" onClose={() => { if (!busy) close(); }}><p className="muted">Connect your own provider. Keys are stored by the local service and never returned to this interface. Test compatibility before sending project code.</p><div className="provider-availability">{providers.map(item => <span key={item.name}>{item.name}<Status value={item.configured ? "configured" : "missing key"} /></span>)}</div>
    <form onSubmit={event => { event.preventDefault(); void act("save"); }}><label className="field">Provider<select value={provider} disabled={!!busy} onChange={e => { setProvider(e.target.value); setModel(""); setInput(""); setOutput(""); setKey(""); setKeyNotice(""); setProbe(null); }}><option value="openrouter">OpenRouter</option><option value="groq">Groq</option><option value="nvidia">NVIDIA NIM</option><option value="gemini">Google Gemini</option></select></label>
      {environmentKey ? <p className="micro">This provider uses an existing environment key. Its value is hidden; update that environment file to change it.</p> : <div className="provider-key-setup"><label className="field" htmlFor={keyId}>Provider API key<input id={keyId} type="password" value={key} disabled={!!busy} autoComplete="new-password" spellCheck={false} aria-describedby={keyHelpId} maxLength={4096} onChange={event => { setKey(event.target.value); setKeyNotice(""); }} /></label><p id={keyHelpId} className="micro">Saved in the private local data folder. Saving makes no model request.</p><button className="button" type="button" disabled={!!busy || key.length < 8} onClick={() => void saveKey()}>{busy === "key" ? "Saving key…" : "Save key locally"}</button></div>}
      {keyNotice && <p role="status" className="micro">{keyNotice}</p>}
      <label className="field">Model ID<input required disabled={!!busy} value={model} autoComplete="off" spellCheck={false} placeholder="Enter an available model ID" onChange={e => { setModel(e.target.value); setProbe(null); }} /></label>
      {provider === "openrouter" ? <p className="micro">OpenRouter prices are checked against its model catalog.</p> : <div className="price-grid"><label className="field">Input USD / million tokens<input required type="number" min="0" step="any" disabled={!!busy} value={input} onChange={e => { setInput(e.target.value); setProbe(null); }} /></label><label className="field">Output USD / million tokens<input required type="number" min="0" step="any" disabled={!!busy} value={output} onChange={e => { setOutput(e.target.value); setProbe(null); }} /></label></div>}
      <p className="micro">Use your actual token rates. A compatibility test has a $0.05 accounted budget; estimates do not cover subscription charges.</p><button type="button" className="button" disabled={!!busy || !valid} onClick={() => void act("probe")}>{busy === "probe" ? "Testing connection…" : "Test compatibility"}</button>
      {probe && <div className="probe-result" role="status"><Status value={probe.compatible ? "passed" : "failed"} /><strong>{probe.provider} / {probe.model}</strong><p>{probe.detail}</p><small>{(probe.elapsed_ms / 1000).toFixed(1)}s · ${probe.cost.toFixed(5)} accounted</small></div>}
      {error && <Notice error>{error}</Notice>}<div className="modal-actions"><button className="button" type="button" disabled={!!busy} onClick={close}>Cancel</button><button className="button primary" disabled={!!busy || !valid}>{busy === "save" ? "Saving…" : "Save connection"}</button></div>
    </form>
  </Modal>;
}
