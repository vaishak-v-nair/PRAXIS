import type { Job } from "@/lib/contracts";
import { Status } from "./ui";

export function EvidenceGates({ dimensions }: { dimensions: NonNullable<Job["assessment"]>["dimensions"] }) {
  return <section className="assessment-dimensions" aria-labelledby="dimensions-title">
    <div className="section-heading"><div><div className="section-label">EVIDENCE GATES</div><h2 id="dimensions-title">What the project has actually demonstrated</h2></div><span className="micro">Recorded scope, no readiness score</span></div>
    <div className="dimension-grid">{dimensions?.length ? dimensions.map(item => <article key={item.id}>
      <div className="dimension-heading"><h3>{item.label}</h3><Status value={item.status} /></div><p>{item.detail}</p>
      <span>{item.evidence_count} displayed evidence record{item.evidence_count === 1 ? "" : "s"}</span>
      {!!item.evidence?.length && <details className="evidence-trace"><summary>Inspect evidence</summary><ul>{item.evidence.map((record, index) => <li key={`${record.kind}-${index}`}><div><strong>{record.label}</strong><Status value={record.status} /></div>{record.detail && <p>{record.detail}</p>}{record.source && <code className="evidence-source">{record.source}</code>}</li>)}</ul></details>}
      {!!item.limits?.length && <details className="dimension-limits"><summary>Check limits · {item.limits.length}</summary><ul>{item.limits.map((limit, index) => <li key={index}>{limit}</li>)}</ul></details>}
    </article>) : <p className="muted">Evidence gates appear after project inventory completes.</p>}</div>
  </section>;
}
