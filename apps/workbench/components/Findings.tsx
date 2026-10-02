"use client";
import { useMemo, useState } from "react";
import { Search, FileCode, ArrowUpRight, CircleAlert, Wrench, ShieldCheck } from "lucide-react";
import type { Finding } from "@/lib/contracts";
import { Empty, Status } from "./ui";

const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const severityMeaning: Record<string, string> = {
  critical: "Act now — this can cause a serious security, privacy, or data-loss incident.",
  high: "Fix before release — this can break an important path or expose the product.",
  medium: "Resolve before production when this path matters to users.",
  low: "Improve when practical; the immediate product risk is limited.",
  info: "Engineering context that can improve maintainability or confidence.",
};

function humanLabel(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function confidence(value: string | number) {
  if (typeof value === "number") return `${Math.round(value <= 1 ? value * 100 : value)}% confidence`;
  const normalized = String(value || "not scored").replace(/[_-]+/g, " ");
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)} confidence`;
}

export function Findings({ findings, canRepair, repair, busy }: { findings: Finding[]; canRepair: boolean; repair: (ids: string[]) => void; busy: boolean }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [focus, setFocus] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const visible = useMemo(() => findings.filter(finding =>
    (filter === "all" || finding.severity.toLowerCase() === filter) &&
    `${finding.title} ${finding.description} ${finding.location?.file} ${finding.category}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (severityOrder[a.severity.toLowerCase()] ?? 5) - (severityOrder[b.severity.toLowerCase()] ?? 5)), [findings, query, filter]);
  const current = visible.find(item => item.id === focus) || visible[0];
  const selected = selection.filter(id => findings.some(finding => finding.id === id && finding.fixable));
  const urgent = findings.filter(item => ["critical", "high"].includes(item.severity.toLowerCase())).length;
  const repairable = findings.filter(item => item.fixable).length;

  return <section aria-labelledby="findings-title">
    <div className="findings-intro">
      <div><div className="section-label">ENGINEERING FINDINGS</div><h2 id="findings-title">What PRAXIS found</h2><p>Each issue explains the observed evidence, its practical impact, and the safest next action. Findings are ordered by release risk.</p></div>
      <div className="finding-summary" aria-label="Finding summary"><span><CircleAlert size={15} /><strong>{urgent}</strong> urgent</span><span><Wrench size={15} /><strong>{repairable}</strong> repairable</span></div>
    </div>
    <div className="view-toolbar"><label className="search"><Search size={16} /><input aria-label="Search findings" placeholder="Search issues, files, or impact…" value={query} onChange={e => setQuery(e.target.value)} /></label><label className="field compact"><span className="sr-only">Filter severity</span><select aria-label="Filter severity" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All priorities</option>{Object.keys(severityOrder).map(value => <option key={value} value={value}>{humanLabel(value)}</option>)}</select></label><span className="micro">Showing {visible.length} of {findings.length}</span></div>
    {!visible.length ? <Empty title={findings.length ? "No matching findings" : "No findings reported"}><p>{findings.length ? "Try another search or priority." : "No source issue was reported. Check execution and coverage before treating the project as ready."}</p></Empty> : <div className="triage">
      <div className="finding-queue" aria-label="Finding list">{visible.map((item, index) => {
        const level = item.severity.toLowerCase();
        return <div className={`finding-row ${current?.id === item.id ? "selected" : ""}`} key={item.id}>
          <input type="checkbox" aria-label={`Select ${item.title} for repair`} disabled={!item.fixable || busy} checked={selected.includes(item.id)} onChange={() => setSelection(previous => previous.includes(item.id) ? previous.filter(id => id !== item.id) : [...previous, item.id])} />
          <button onClick={() => setFocus(item.id)} aria-pressed={current?.id === item.id}>
            <div><span className="finding-number">{String(index + 1).padStart(2, "0")}</span><Status value={level} /><span className="micro">{humanLabel(item.category)}</span></div>
            <strong>{item.title}</strong>
            <span className="finding-impact">{severityMeaning[level] || "Review the recorded evidence and decide whether this affects release."}</span>
            <span className="file-path">{item.location?.file || "Project-wide"}{item.location?.line ? `:${item.location.line}` : ""}</span>
          </button>
        </div>;
      })}</div>
      {current && <article className="evidence-inspector" aria-label="Finding details">
        <div className="section-label">ISSUE BRIEF</div><h2>{current.title}</h2>
        <div className="inline-meta"><Status value={current.severity.toLowerCase()} /><span>{confidence(current.confidence)}</span><span>{current.fixable ? "AI-assisted fix available" : "Manual review required"}</span></div>
        <section className="finding-explanation"><h3>What PRAXIS observed</h3><p>{current.description || "The scanner identified a condition that needs review."}</p></section>
        <section className="finding-explanation"><h3>Why you should care</h3><p>{current.why || severityMeaning[current.severity.toLowerCase()] || "The practical impact needs human review."}</p></section>
        <div className="code-caption"><FileCode size={15} /><span>Recorded evidence</span><code>{current.location?.file || "Project-wide"}{current.location?.line ? `:${current.location.line}` : ""}</code></div>
        <pre className="code-block">{current.evidence || "No source snippet was captured. Treat this finding as unconfirmed until it is reproduced."}</pre>
        <section className="recommended-action"><ShieldCheck size={18} /><div><h3>Recommended response</h3><p>{current.fix || "Inspect the affected path and reproduce the behavior before making changes."}</p></div></section>
        <button className="button primary" disabled={!canRepair || !current.fixable || busy} onClick={() => repair([current.id])}>Draft a fix plan<ArrowUpRight size={16} /></button>
        <p className="micro">PRAXIS will map the files, checks, risks, and delivery route first. No source file changes during planning.</p>
      </article>}
    </div>}
    {!!selected.length && <div className="selection-bar"><span>{selected.length} finding{selected.length === 1 ? "" : "s"} selected for one coordinated plan</span><button className="button quiet" onClick={() => setSelection([])}>Clear</button><button className="button primary" disabled={busy || !canRepair} onClick={() => repair(selected)}>Draft plan for {selected.length}<ArrowUpRight size={16} /></button></div>}
  </section>;
}
