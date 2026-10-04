import { ArrowRight, FileCode, SearchCheck } from "lucide-react";
import type { Finding } from "@/lib/contracts";
import { evidenceLabel } from "@/lib/status.mjs";
import { Status } from "./ui";

const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function PriorityFinding({ findings, inspect, running }: { findings: Finding[]; inspect: () => void; running: boolean }) {
  const first = findings.reduce<Finding | undefined>((best, item) =>
    !best || (order[item.severity.toLowerCase()] ?? 5) < (order[best.severity.toLowerCase()] ?? 5) ? item : best, undefined);
  if (!first) return null;
  return <section className="priority-finding" aria-label="First finding to inspect">
    <div className="priority-icon"><SearchCheck size={24} /></div>
    <div className="priority-content"><div className="priority-meta"><span className="section-label">{running ? "Finding recorded so far" : "First finding to inspect"}</span><Status value={first.severity.toLowerCase()} /></div>
      <h2>{evidenceLabel(first.title)}</h2><p>{first.why || first.description || "Inspect the recorded evidence to establish whether this affects your project."}</p>
      <div className="priority-location"><FileCode size={14} /><code>{first.location?.file || "Project-wide"}{first.location?.line ? `:${first.location.line}` : ""}</code><span>Recorded finding · confirm against current behavior</span></div>
    </div><button className="button" onClick={inspect}>Inspect finding<ArrowRight size={16} /></button>
  </section>;
}
