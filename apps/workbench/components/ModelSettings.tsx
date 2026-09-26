"use client";
import { useEffect, useRef, useState } from "react";
import { Settings2, X } from "lucide-react";
import { api, type Health } from "./types";

const defaults = {
  openrouter: { model: "openai/gpt-6-astra", input: "", output: "" },
  gemini: { model: "gemini-3.1-pro-preview", input: "4", output: "18" },
  nvidia: { model: "moonshotai/kimi-k3", input: "0", output: "0" },
  groq: { model: "openai/gpt-oss-120b", input: "0.15", output: "0.75" },
};
type Provider = keyof typeof defaults;
export function ModelSettings({ health, onClose, onSaved }: { health: Health | null; onClose: () => void; onSaved: (health: Health) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const settings = health?.settings;
  const initial = settings?.provider && settings.provider in defaults ? settings.provider as Provider : "openrouter";
  const [provider, setProvider] = useState<Provider>(initial);
  const [model, setModel] = useState(settings?.model || defaults[initial].model);
  const [input, setInput] = useState(settings?.input_price != null ? String(settings.input_price * 1e6) : defaults[initial].input);
  const [output, setOutput] = useState(settings?.output_price != null ? String(settings.output_price * 1e6) : defaults[initial].output);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="action-dialog model-dialog" onCancel={onClose} aria-labelledby="model-settings-title">
    <button className="dialog-close icon-button" onClick={onClose} aria-label="Close settings"><X size={20} /></button>
    <div className="dialog-icon settings-icon"><Settings2 size={23} /></div><h2 id="model-settings-title">Choose your repair model</h2>
    <p>PRAXIS Workbench uses the API keys already in your server’s .env. The selected model handles analysis, repairs, and independent review. There is no automatic fallback.</p>
    <form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(""); try { const value = await api<Health>("/settings", { provider, model: model.trim(), input_price: provider === "openrouter" ? null : Number(input) / 1e6, output_price: provider === "openrouter" ? null : Number(output) / 1e6 }); onSaved(value); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save settings."); } finally { setBusy(false); } }}>
      <label className="field-label" htmlFor="model-provider">Provider</label><select id="model-provider" className="standalone-input" value={provider} onChange={event => { const value = event.target.value as Provider; setProvider(value); setModel(defaults[value].model); setInput(defaults[value].input); setOutput(defaults[value].output); }}><option value="openrouter">OpenRouter</option><option value="gemini">Google Gemini</option><option value="nvidia">NVIDIA NIM</option><option value="groq">Groq</option></select>
      <label className="field-label settings-label" htmlFor="model-id">Model ID</label><input id="model-id" className="standalone-input" value={model} onChange={event => setModel(event.target.value)} required autoComplete="off" spellCheck={false} />
      {provider === "openrouter" ? <p className="settings-note">OpenRouter’s live model prices are checked before paid requests. Price overrides are ignored.</p> : <><div className="price-fields"><div><label className="field-label" htmlFor="input-price">Input USD / million tokens</label><input className="standalone-input" id="input-price" type="number" min="0" step="any" required value={input} onChange={event => setInput(event.target.value)} /></div><div><label className="field-label" htmlFor="output-price">Output USD / million tokens</label><input className="standalone-input" id="output-price" type="number" min="0" step="any" required value={output} onChange={event => setOutput(event.target.value)} /></div></div><p className="settings-note">{provider === "nvidia" ? "NVIDIA’s default 0 / 0 is an estimate for a trial endpoint. It excludes subscription charges and other account costs. Set your actual token rates for paid access." : provider === "gemini" ? "The default 4 / 18 rates are conservative estimates. Adjust them to your account’s actual rates to budget accurately." : "The default 0.15 / 0.75 rates are configurable estimates. Check the rates for your selected model."}</p></>}
      <p className="settings-note">Settings cannot change while a job is active. Saving a model does not verify key access; access is checked when a job starts.</p>
      {error && <div className="error-banner" role="alert">{error}</div>}<div className="dialog-actions"><button className="secondary" type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={busy || !model.trim()}>{busy ? "Saving…" : "Save model settings"}</button></div>
    </form>
  </dialog>;
}
