import { CircleAlert, Files, Terminal, Gauge } from "lucide-react";
import { type Job, money, budgetOf } from "@/lib/contracts";

export function SummaryMetrics({ job }: { job: Job }) {
  const findings = job.findings || [];
  const priority = findings.filter(item => ["high", "critical"].includes(item.severity.toLowerCase())).length;
  const passed = job.assessment?.commands_passed ?? 0, failed = job.assessment?.checks_failed ?? 0;
  const budget = budgetOf(job);
  return <div className="metric-strip" aria-label="Recorded review metrics">
    <article><div><span>Findings</span><CircleAlert size={16} /></div><strong>{findings.length}</strong><small>{priority} high priority</small>{findings.length > 0 && <meter aria-label="High priority share of recorded findings" min={0} max={findings.length} value={priority} />}</article>
    <article><div><span>Source files</span><Files size={16} /></div><strong>{job.files_scanned ?? "—"}</strong><small>{job.languages?.join(" / ") || "Awaiting inventory"}</small><span className="metric-note">Snapshot inventory</span></article>
    <article><div><span>Execution</span><Terminal size={16} /></div><strong>{passed}</strong><small>commands passed · {failed} failed checks</small><span className="metric-note">{job.checks?.length ? `${job.checks.length} recorded check outcomes` : "No command outcome recorded"}</span></article>
    <article><div><span>Model spend</span><Gauge size={16} /></div><strong>{money(job.cost)}</strong><small>of {money(budget)} budget</small>{budget > 0 && <meter aria-label="Accounted model budget used" min={0} max={budget} value={Math.min(job.cost || 0, budget)} />}</article>
  </div>;
}
