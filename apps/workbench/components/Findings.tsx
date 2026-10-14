"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, FileCode, ArrowUpRight, ArrowLeft, CircleAlert, Wrench, ShieldCheck } from "lucide-react";
import type { Finding, Job } from "@/lib/contracts";
import { evidenceLabel } from "@/lib/status.mjs";
import { readFindingLocation, findingLocation } from "@/lib/navigation.mjs";
import { Empty, Status } from "./ui";
import { AgentBrief } from "./AgentBrief";

const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const severityMeaning: Record<string, string> = {
  critical: "Act now — this can cause a serious security, privacy, or data-loss incident.",
  high: "Fix before release — this can break an important path or expose the product.",
  medium: "Resolve before production when this path matters to users.",
  low: "Lower scanner priority. Confirm the practical impact against the recorded evidence.",
  info: "Engineering context that can improve maintainability or confidence.",
};

function humanLabel(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function confidence(value: string | number) {
  if (typeof value === "number") return `${Math.round(value <= 1 ? value * 100 : value)}% confidence`;
  if (value === "suggestion") return "Source suggestion · needs confirmation";
  const normalized = String(value || "not scored").replace(/[_-]+/g, " ");
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)} confidence`;
}

function matches(item: Finding, filter: string, query: string) {
  return (filter === "all" || item.severity.toLowerCase() === filter) &&
    `${item.title} ${item.description} ${item.location?.file} ${item.category}`.toLowerCase().includes(query.toLowerCase());
}

export function Findings({ job, findings, canRepair, repair, busy, modelConfigured, openModels }: { job: Job; findings: Finding[]; canRepair: boolean; repair: (ids: string[]) => void; busy: boolean; modelConfigured: boolean; openModels: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [focus, setFocus] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const lastRow = useRef<HTMLButtonElement>(null);
  const listScroll = useRef(0);
  useEffect(() => {
    const restore = () => {
      const location = readFindingLocation(window.location.href);
      setQuery(location.query); setFilter(location.severity);
      setFocus(findings.some(item => item.id === location.finding) ? location.finding : null);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [findings]);
  useEffect(() => {
    if (focus && window.matchMedia("(max-width: 800px)").matches) {
      detailHeading.current?.closest(".evidence-inspector")?.scrollIntoView({ block: "start" });
      detailHeading.current?.focus({ preventScroll: true });
    }
  }, [focus]);
  const writeLocation = (nextFocus: string | null, nextFilter: string, nextQuery: string, push = false) => {
    const next = findingLocation(window.location.href, { finding: nextFocus, severity: nextFilter, query: nextQuery });
    if (next !== window.location.pathname + window.location.search + window.location.hash) {
      window.history[push ? "pushState" : "replaceState"](null, "", next);
    }
  };
  const updateFilter = (nextFilter: string, nextQuery: string) => {
    const nextFocus = focus && findings.some(item => item.id === focus && matches(item, nextFilter, nextQuery)) ? focus : null;
    setFilter(nextFilter); setQuery(nextQuery); setFocus(nextFocus);
    writeLocation(nextFocus, nextFilter, nextQuery);
  };
  const selectFinding = (id: string, button: HTMLButtonElement) => {
    lastRow.current = button;
    listScroll.current = window.scrollY;
    setFocus(id);
    writeLocation(id, filter, query, true);
  };
  const backToList = () => {
    setFocus(null);
    writeLocation(null, filter, query, true);
    requestAnimationFrame(() => {
      window.scrollTo({ top: listScroll.current });
      (lastRow.current || searchInput.current)?.focus({ preventScroll: true });
    });
  };
  const visible = useMemo(() => findings.filter(finding =>
    matches(finding, filter, query))
    .sort((a, b) => (severityOrder[a.severity.toLowerCase()] ?? 5) - (severityOrder[b.severity.toLowerCase()] ?? 5)), [findings, query, filter]);
  const current = visible.find(item => item.id === focus) || visible[0];
  const selected = selection.filter(id => findings.some(finding => finding.id === id && finding.fixable));
  const urgent = findings.filter(item => ["critical", "high"].includes(item.severity.toLowerCase())).length;
  const repairable = findings.filter(item => item.fixable).length;
  const planEnabled = !!current && canRepair && current.fixable && !busy && modelConfigured;

  return <section aria-label="Findings" className={`findings-page ${focus ? "mobile-detail-open" : ""}`}>
    <div className="findings-intro">
      <div><div className="section-label">ENGINEERING FINDINGS</div><h2 id="findings-title">What PRAXIS found</h2><p>Each issue explains the observed evidence, its practical impact, and the safest next action. Findings are ordered by release risk.</p></div>
      <div className="finding-summary" aria-label="Finding summary"><span><CircleAlert size={15} /><strong>{urgent}</strong> urgent</span><span><Wrench size={15} /><strong>{repairable}</strong> repairable</span></div>
    </div>
    <div className="view-toolbar"><label className="search"><Search size={16} /><input ref={searchInput} aria-label="Search findings" placeholder="Search issues or files…" maxLength={200} value={query} onChange={e => updateFilter(filter, e.target.value)} /></label><label className="field compact"><span className="sr-only">Filter severity</span><select aria-label="Filter severity" value={filter} onChange={e => updateFilter(e.target.value, query)}><option value="all">All priorities</option>{Object.keys(severityOrder).map(value => <option key={value} value={value}>{humanLabel(value)}</option>)}</select></label><span className="micro">Showing {visible.length} of {findings.length}</span></div>
    {!visible.length ? <Empty title={findings.length ? "No matching findings" : "No findings reported"}><p>{findings.length ? "Try another search or priority." : "No source issue was reported. Check execution and coverage before treating the project as ready."}</p></Empty> : <div className={`triage ${focus ? "mobile-detail" : ""}`}>
      <div className="finding-queue" aria-label="Finding list">{visible.map((item, index) => {
        const level = item.severity.toLowerCase();
        return <div className={`finding-row ${current?.id === item.id ? "selected" : ""}`} key={item.id}>
          <input type="checkbox" aria-label={`Select ${item.title} for repair`} disabled={!item.fixable || busy} checked={selected.includes(item.id)} onChange={() => setSelection(previous => previous.includes(item.id) ? previous.filter(id => id !== item.id) : [...previous, item.id])} />
          <button onClick={event => selectFinding(item.id, event.currentTarget)} aria-pressed={focus === item.id}>
            <div><span className="finding-number">{String(index + 1).padStart(2, "0")}</span><Status value={level} /><span className="micro">{humanLabel(item.category)}</span></div>
            <strong>{evidenceLabel(item.title)}</strong>
            <span className="file-path">{item.location?.file || "Project-wide"}{item.location?.line ? `:${item.location.line}` : ""}</span>
          </button>
        </div>;
      })}</div>
      {current && <article className="evidence-inspector" aria-label="Finding details">
        <button className="finding-back button quiet" onClick={backToList}><ArrowLeft size={15} />Back to findings</button>
        <div className="section-label">ISSUE BRIEF</div><h2 ref={detailHeading} tabIndex={-1}>{evidenceLabel(current.title)}</h2>
        <div className="inline-meta"><Status value={current.severity.toLowerCase()} /><span>{confidence(current.confidence)}</span><span>{current.fixable ? "AI-assisted fix available" : "Manual review required"}</span></div>
        <section className="finding-explanation"><h3>What PRAXIS observed</h3><p>{current.description || "The scanner identified a condition that needs review."}</p></section>
        <section className="finding-explanation"><h3>Why you should care</h3><p>{current.why || severityMeaning[current.severity.toLowerCase()] || "The practical impact needs human review."}</p></section>
        <section className="recommended-action"><ShieldCheck size={18} /><div><h3>Recommended response</h3><p>{current.fix || "Inspect the affected path and reproduce the behavior before making changes."}</p></div></section>
        <details className="finding-source"><summary><FileCode size={15} />View recorded source evidence</summary><div className="code-caption"><code>{current.location?.file || "Project-wide"}{current.location?.line ? `:${current.location.line}` : ""}</code></div><pre className="code-block">{current.evidence || "No source snippet was captured. Treat this finding as unconfirmed until it is reproduced."}</pre></details>
        <AgentBrief key={current.id} job={job} findingIds={[current.id]} compact actionPrimary={planEnabled} action={<button className={`button ${planEnabled ? "primary" : ""}`} disabled={!planEnabled} onClick={() => repair([current.id])}>Draft a fix plan<ArrowUpRight size={16} /></button>} />
        {current.fixable && !modelConfigured ? <div className="planning-unavailable"><p>Drafting a plan needs a configured AI provider. Copy the agent brief above to use your own coding agent.</p><button className="button" onClick={openModels}>Configure provider</button></div> : <p className="micro">{current.fixable ? "PRAXIS will map files, checks, risks, and delivery first. Planning changes no source file." : "This finding requires manual review. Copy its evidence to your agent before proposing changes."}</p>}
      </article>}
    </div>}
    {!!selected.length && <div className="selection-bar"><span>{selected.length} finding{selected.length === 1 ? "" : "s"} selected for one coordinated plan{!modelConfigured && " · configure a provider or copy the agent brief"}</span><button className="button quiet" onClick={() => setSelection([])}>Clear</button><button className="button primary" disabled={busy || !canRepair || !modelConfigured} onClick={() => repair(selected)}>Draft plan for {selected.length}<ArrowUpRight size={16} /></button></div>}
  </section>;
}
