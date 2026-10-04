import { Box, CheckCircle2, Laptop, ShieldAlert } from "lucide-react";
import type { Health, Job, RuntimeMode } from "@/lib/contracts";

export function RuntimeControls({ runtime, network, accepted, busy, docker, commands, setRuntime, setNetwork, setAccepted }: {
  runtime: RuntimeMode | ""; network: boolean; accepted: boolean; busy: boolean; docker?: Health["docker"];
  commands?: Job["commands"]; setRuntime: (value: RuntimeMode | "") => void;
  setNetwork: (value: boolean) => void; setAccepted: (value: boolean) => void;
}) {
  return <div className="runtime-controls">
    <label className="field">Execution environment<select aria-label="Execution environment" required disabled={busy} value={runtime} onChange={e => setRuntime(e.target.value as RuntimeMode | "")}>
      <option value="">Choose where checks run</option>
      <option value="host">This computer · trusted projects only</option>
      <option value="docker">Docker · optional isolated execution</option>
    </select></label>
    {runtime === "host" ? <div className="runtime-disclosure" role="status"><Laptop size={20} /><div><strong>Local commands can access this computer.</strong><p>Install, test and build scripts can access files, the internet and your local network. A review copy is not a sandbox. Choose this only for a project you trust.</p></div></div>
      : runtime === "docker" ? <><div className={`docker-readiness ${docker?.ready ? "ready" : "attention"}`} role="status"><div className="runtime-disclosure-heading">{docker?.ready ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}<strong>{docker?.ready ? "Docker is ready" : "Optional Docker runtime needs setup"}</strong></div><p>{docker?.detail || "Docker readiness has not been established. Source inspection is still available."}</p>{docker?.images && <div className="runtime-images">{Object.values(docker.images).map(item => <code key={item.image}>{item.ready ? "Ready" : "Unavailable"} · {item.image}</code>)}</div>}</div><p className="micro">Browser journeys are not supported by this Docker runtime.</p><label className="check-label"><input type="checkbox" checked={network} disabled={busy} onChange={e => setNetwork(e.target.checked)} /><span>Allow network access for installs and project commands, including local-network access.</span></label></>
        : <p className="micro runtime-choice"><Box size={16} />Choose an environment before authorizing commands. PRAXIS never silently switches environments.</p>}
    {commands !== undefined && <div className="command-preview" aria-label="Discovered project commands">{commands.length ? commands.map((item, i) => <code key={i}>{Array.isArray(item) ? item.join(" ") : item.argv?.join(" ") || item.label}</code>) : <p>No supported test/build command was discovered. That is a coverage gap, not a passing result.</p>}</div>}
    {runtime && <label className="check-label consent"><input type="checkbox" required checked={accepted} disabled={busy || (runtime === "docker" && !docker?.ready)} onChange={e => setAccepted(e.target.checked)} /><span>I trust this project and authorize {commands !== undefined ? "the displayed commands" : "its discovered install, test, lint and build commands"} {runtime === "host" ? "on this computer, with access to its files and network." : "in the selected Docker environment."}</span></label>}
  </div>;
}
