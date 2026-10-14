import { CircleAlert, Files, Terminal, Gauge } from "lucide-react";
import { type Job, money, budgetOf } from "@/lib/contracts";

function ProgressRing({ value, max, label, tone }: { value: number; max: number; label: string; tone: "risk" | "budget" }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const portion = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return <svg className={`metric-ring ${tone}`} viewBox="0 0 44 44" role="img" aria-label={label}>
    <circle className="metric-ring-track" cx="22" cy="22" r={radius} fill="none" strokeWidth="5" />
    <circle className="metric-ring-value" cx="22" cy="22" r={radius} fill="none" strokeWidth="5"
      strokeDasharray={circumference} strokeDashoffset={circumference * (1 - portion)} transform="rotate(-90 22 22)" />
  </svg>;
}

export function SummaryMetrics({ job }: { job: Job }) {
  const findings = job.findings || [];
  const priority = findings.filter(item => ["high", "critical"].includes(item.severity.toLowerCase())).length;
  const passed = job.assessment?.commands_passed ?? 0, failed = job.assessment?.checks_failed ?? 0;
  const budget = budgetOf(job);
  return <div className="metric-strip" aria-label="Recorded review metrics">
    <article><div><span>Findings</span><CircleAlert size={16} /></div><div className="metric-value"><strong>{findings.length}</strong><ProgressRing value={priority} max={findings.length} tone="risk" label={`${priority} high priority of ${findings.length} recorded findings`} /></div><small>{priority} high priority</small></article>
    <article><div><span>Source files</span><Files size={16} /></div><strong>{job.files_scanned ?? "—"}</strong><small>{job.languages?.join(" / ") || "Awaiting inventory"}</small><span className="metric-note">Snapshot inventory</span></article>
    <article><div><span>Execution</span><Terminal size={16} /></div><strong>{passed}</strong><small>commands passed · {failed} failed checks</small><span className="metric-note">{job.checks?.length ? `${job.checks.length} recorded check outcomes` : "No command outcome recorded"}</span></article>
    <article><div><span>Model spend</span><Gauge size={16} /></div><div className="metric-value"><strong>{money(job.cost)}</strong><ProgressRing value={job.cost || 0} max={budget} tone="budget" label={`${money(job.cost)} accounted model spend of ${money(budget)} budget`} /></div><small>of {money(budget)} budget</small></article>
  </div>;
}
