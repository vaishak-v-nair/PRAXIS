import { BrainCircuit } from "lucide-react";
import type { Job } from "@/lib/contracts";
import { Status } from "./ui";

export function ModelPerspectives({ perspectives }: { perspectives: Job["pressure_tests"] }) {
  if (!perspectives?.length) return null;
  return <section className="pressure-results" aria-labelledby="perspectives-title"><div className="section-heading"><div><div className="section-label">INDEPENDENT MODEL PERSPECTIVES</div><h2 id="perspectives-title">What the models reported</h2></div><span className="micro">Hypotheses · not runtime proof</span></div>
    <div className="pressure-grid">{perspectives.map((agent, index) => <article key={`${agent.agent}-${agent.provider || index}`}>
      <header><BrainCircuit size={18} /><h3>{agent.agent}</h3><span className="count">{agent.findings_added} added</span></header>
      <div className="perspective-provider"><span>{agent.provider || "Provider not recorded"}</span>{agent.model && <code>{agent.model}</code>}</div>
      <div className="perspective-body">{agent.journeys.length ? agent.journeys.map((journey, i) => <details key={i}><summary><span>{journey.name || "Reported journey"}</span><Status value={journey.result === "works" ? "model says works" : journey.result === "fails" ? "model flags failure" : journey.result || "uncertain"} /></summary><p>{journey.evidence || "No evidence summary was supplied; the reported behavior remains unconfirmed."}</p></details>) : <p className="muted">No user journey result was returned.</p>}</div>
      {!!agent.gaps.length && <details className="perspective-gaps"><summary>{agent.gaps.length} reported gap{agent.gaps.length === 1 ? "" : "s"}</summary><ul>{agent.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></details>}
    </article>)}</div>
  </section>;
}
