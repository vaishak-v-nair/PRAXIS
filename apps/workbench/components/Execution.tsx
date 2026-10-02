import { Terminal, Play } from "lucide-react";
import { display, type Job } from "@/lib/contracts";
import { Empty, Status } from "./ui";

export function Execution({ job, verify, disabled }: { job: Job; verify: () => void; disabled: boolean }) {
  const checks = (job.checks || []).map(value => value && typeof value === "object" ? value as Record<string, unknown> : { output: value });
  return <section><div className="view-heading"><div><h2>Execution results</h2><p>Captured command outcomes. Successful setup is separate from successful tests.</p></div><button className="button primary" disabled={disabled} onClick={verify}><Play size={15} />Run checks</button></div>
    {checks.length ? <div className="log-list">{checks.map((check, index) => <details key={index} open={check.status === "failed" || check.status === "timeout"}><summary><Terminal size={16} /><code>{display(check.name || check.command || `Check ${index + 1}`)}</code><Status value={String(check.status || "unknown")} /></summary><div className="log-meta"><span>{String(check.runtime || "host")}</span><span>{String(check.kind || "check")}</span>{check.network ? <span>Network: {String(check.network)}</span> : null}{check.exit_code != null ? <span>Exit: {String(check.exit_code)}</span> : null}</div><pre className="code-block">{display(check.output || check.detail || check.message || "No output captured.")}</pre>{check.image ? <p className="micro break">Image: {String(check.image)}</p> : null}</details>)}</div> : <Empty title="No commands have run"><p>Authorize container checks to execute the discovered tests and build commands.</p></Empty>}
    <div className="section-heading"><h3>Check coverage</h3><span className="micro">Unavailable checks are retained</span></div><div className="coverage-list">{job.coverage?.length ? job.coverage.map((item, i) => <article key={i}><div><strong>{item.name || item.tool || "Check"}</strong><Status value={item.status || "unknown"} /></div><p>{item.detail || item.message || "No details supplied."}</p></article>) : <p className="muted">Coverage will appear as the review proceeds.</p>}</div>
  </section>;
}
