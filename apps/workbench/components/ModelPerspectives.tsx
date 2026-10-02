import { BrainCircuit } from "lucide-react";
import type { Job } from "@/lib/contracts";
import { Status } from "./ui";

function journeyTitle(value?: string) {
  return (value || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function ModelPerspectives({ perspectives, team }: { perspectives: Job["pressure_tests"]; team?: Job["team"] }) {
  if (!perspectives?.length && !team) return null;
  const challenged = new Set(team?.discussions.filter(item => item.position === "challenges").map(item => item.finding_id));
  return <section className="pressure-results" aria-labelledby="perspectives-title"><div className="section-heading"><div><div className="section-label">{team ? "COLLABORATIVE AI TEAM" : "INDEPENDENT MODEL PERSPECTIVES"}</div><h2 id="perspectives-title">{team ? "Specialists working together" : "What the models reported"}</h2></div><span className="micro">Hypotheses · not runtime proof</span></div>
    {team && <div className="team-summary" aria-live="polite"><div><Status value={team.status} /><span>{team.phase === "inspection" ? "Inspecting the shared snapshot" : team.phase === "peer_review" ? "Challenging peer findings" : "Review and peer challenge finished"}</span></div><p>{team.goal || "Source-backed user journey, reliability, security and production review."}</p><span className="micro">{team.agents.length} specialists · one spending limit · {team.discussions.length} source-backed peer comments{challenged.size ? ` · ${challenged.size} challenged finding${challenged.size === 1 ? "" : "s"}` : ""}</span></div>}
    <div className="pressure-grid">{perspectives?.map((agent, index) => <article key={`${agent.agent}-${agent.provider || index}`}>
      <header><BrainCircuit size={18} /><h3>{agent.agent}</h3><span className="count">{agent.findings_added} added</span></header>
      <div className="perspective-provider"><span>{agent.provider || "Provider not recorded"}</span>{agent.model && <code>{agent.model}</code>}</div>
      {team?.agents[index] && <div className="team-agent-state"><span>Inspection <Status value={team.agents[index].status} /></span><span>Peer challenge <Status value={team.agents[index].peer_status === "not_needed" ? "no peer findings" : team.agents[index].peer_status} /></span></div>}
      <div className="perspective-body">{agent.journeys.length ? agent.journeys.map((journey, i) => <details key={i}><summary><span>{journeyTitle(journey.name) || "Reported journey"}</span><Status value={journey.result === "works" ? "model says works" : journey.result === "fails" ? "model flags failure" : journey.result || "uncertain"} /></summary><p>{journey.evidence || "No evidence summary was supplied; the reported behavior remains unconfirmed."}</p></details>) : <p className="muted">No user journey result was returned.</p>}</div>
      {!!agent.gaps.length && <details className="perspective-gaps"><summary>{agent.gaps.length} reported gap{agent.gaps.length === 1 ? "" : "s"}</summary><ul>{agent.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></details>}
    </article>)}</div>
    {!!team?.discussions.length && <details className="team-discussions"><summary>Inspect {team.discussions.length} peer comments <span className="micro">Agreement and disagreements retain their source evidence</span></summary><div>{team.discussions.map((item, i) => <article key={`${item.agent_id}-${item.finding_id}-${i}`}><header><strong>{item.agent}</strong><Status value={item.position === "challenges" ? "model challenges finding" : item.position === "supports" ? "model supports finding" : "uncertain"} /></header><p>{item.reason}</p><div className="file-path">{item.location.file}:{item.location.line}<span>Finding {item.finding_id}</span></div><pre><code>{item.evidence}</code></pre></article>)}</div></details>}
  </section>;
}
