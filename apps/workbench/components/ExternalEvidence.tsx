"use client";
import { useEffect, useState } from "react";
import { PlugZap, RefreshCw, Lock } from "lucide-react";
import type { Job } from "@/lib/contracts";
import { request, message } from "@/lib/client";
import { Empty, Notice, Status } from "./ui";

type Source = { id: string; vendor: string; configured: boolean; status: string; detail: string };
const operations: Record<string, string> = { github: "pull-request", playwright: "snapshot", sentry: "issue", supabase: "schema" };

export function ExternalEvidence({ job, busy, action }: { job: Job; busy: boolean; action: (name: string, body: unknown) => Promise<unknown> }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [source, setSource] = useState("github");
  const [repository, setRepository] = useState(""); const [pull, setPull] = useState("");
  const [organization, setOrganization] = useState(""); const [issue, setIssue] = useState("");
  const [project, setProject] = useState(""); const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  async function refresh() {
    setLoading(true); setError("");
    try { const result = await request<Source[] | { detail: string }>("/evidence/sources"); if (!Array.isArray(result)) throw new Error(result.detail); setSources(result); }
    catch (error) { setError(message(error)); } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  const configured = sources.find(item => item.id === source)?.configured;
  return <section className="external-evidence">
    <div className="view-heading"><div><div className="section-label">OFFICIAL MCP SOURCES</div><h2>Evidence beyond the review copy</h2><p>Gather a scoped observation from a vendor-maintained server. Source inspection and local runtime checks remain separate.</p></div><button className="button" disabled={loading || busy} onClick={() => void refresh()}><RefreshCw size={14} />Check configuration</button></div>
    <div className="evidence-source-grid">{sources.map(item => <article key={item.id} className="panel"><div className="card-heading"><h3>{item.vendor}</h3><Status value={item.configured ? "configured" : "unavailable"} label={item.configured ? "Key configured" : item.id === "playwright" ? "Local session required" : "Key needed"} /></div><p className="micro">{item.detail}</p></article>)}</div>
    {error && <Notice error>{error}</Notice>}
    <form className="panel evidence-request" onSubmit={async event => {
      event.preventDefault(); if (!authorized || busy || job.status !== "complete") return;
      setError("");
      try { await action("evidence", { source, operation: operations[source], authorized: true,
        ...(source === "github" ? { repository: repository.trim(), pull_number: Number(pull) } : {}),
        ...(source === "sentry" ? { organization: organization.trim(), issue_id: issue.trim() } : {}),
        ...(source === "supabase" ? { project_ref: project.trim() } : {}) }); setAuthorized(false); }
      catch (error) { setError(message(error)); }
    }}>
      <h3><PlugZap size={18} />Gather an observation</h3>
      <label className="field">Evidence source<select value={source} disabled={busy} onChange={e => { setSource(e.target.value); setAuthorized(false); }}><option value="github">GitHub PR, scanning alerts and Dependabot</option><option value="playwright">Microsoft Playwright accessibility snapshot</option><option value="sentry">Sentry issue state</option><option value="supabase">Supabase schema and migration state</option></select></label>
      {source === "github" && <div className="shared-fields"><label className="field">Repository<input required maxLength={201} placeholder="owner/repository" value={repository} disabled={busy} onChange={e => { setRepository(e.target.value); setAuthorized(false); }} /></label><label className="field">Pull request number<input required type="number" min={1} step={1} value={pull} disabled={busy} onChange={e => { setPull(e.target.value); setAuthorized(false); }} /></label></div>}
      {source === "sentry" && <div className="shared-fields"><label className="field">Organization slug<input required maxLength={100} value={organization} disabled={busy} onChange={e => { setOrganization(e.target.value); setAuthorized(false); }} /></label><label className="field">Issue ID<input required maxLength={100} value={issue} disabled={busy} onChange={e => { setIssue(e.target.value); setAuthorized(false); }} /></label></div>}
      {source === "supabase" && <label className="field">Project reference<input required maxLength={64} value={project} disabled={busy} onChange={e => { setProject(e.target.value); setAuthorized(false); }} /><small>Requests are project-scoped and read-only. No SQL or application data writes are exposed here.</small></label>}
      {source === "playwright" && <p className="micro">Explicitly start the official Microsoft server on port 8931 and open your app in its browser first. This reads its current accessibility tree; it does not infer that a workflow passed.</p>}
      {source !== "playwright" && !configured && <Notice><Lock size={16} />Add the vendor’s access token to the server’s environment file, then restart PRAXIS. GitHub: GITHUB_TOKEN; Sentry: SENTRY_ACCESS_TOKEN; Supabase: SUPABASE_ACCESS_TOKEN. Values never belong in this form.</Notice>}
      <label className="check-label consent"><input type="checkbox" checked={authorized} disabled={busy} onChange={e => setAuthorized(e.target.checked)} /><span>I authorize this read-only request for the selected scope. Vendor responses are untrusted observations and cannot authorize a fix or a release.</span></label>
      <button className="button primary" disabled={busy || !authorized || job.status !== "complete" || (source !== "playwright" && !configured)}>Gather evidence</button>
    </form>
    <div className="view-heading"><div><h3>Recorded observations</h3><p>Each request has a timestamp, snapshot reference and query digest. Remote deployment state is not automatically bound to this local copy.</p></div></div>
    {job.external_evidence?.length ? <div className="evidence-observations">{job.external_evidence.map((item, index) => <details className="panel" key={item.id || index}><summary><span>{item.vendor || item.source || "Official source"} · {item.observed_at ? new Date(item.observed_at).toLocaleString() : "Request unavailable"}</span><Status value={item.status} /></summary><p className="muted">{item.limitation || item.detail}</p>{item.scope && <dl className="evidence-scope">{Object.entries(item.scope).map(([name, value]) => <div key={name}><dt>{name.replaceAll("_", " ")}</dt><dd><code>{Array.isArray(value) ? value.join(", ") : String(value)}</code></dd></div>)}</dl>}<p className="micro">Snapshot <code>{item.snapshot_ref?.slice(0, 16)}</code> · Binding: {item.source_binding || "not established"}</p>{item.records?.map((record, i) => <article key={i}><header className="card-heading"><code>{record.tool}</code><Status value={record.status} /></header><p className="micro">Query <code>{record.query_digest?.slice(0, 16)}</code> · {record.observed_at}</p>{record.excerpt ? <pre className="evidence-excerpt">{record.excerpt}</pre> : <p className="muted">{record.detail}</p>}</article>)}</details>)}</div> : <Empty title="No external observations yet"><p>The current local review is available without connecting a vendor.</p></Empty>}
  </section>;
}
