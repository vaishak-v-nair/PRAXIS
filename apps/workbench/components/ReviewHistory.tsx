"use client";
import { useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import type { Job } from "@/lib/contracts";
import { money } from "@/lib/contracts";
import { Empty, Status } from "./ui";

export function ReviewHistory({ jobs, loading, open }: {
  jobs: Job[]; loading: boolean; open: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const filtered = jobs.filter(job => `${job.name || ""} ${job.source}`.toLowerCase().includes(search.toLowerCase()));
  const visible = search || showAll ? filtered : filtered.slice(0, 8);
  return <section className="history-section" aria-labelledby="history-title">
    <div className="section-heading">
      <div><div className="section-label">Your workspace</div>
        <h2 id="history-title">Recent reviews <span className="count">{jobs.length}</span></h2>
        <p className="history-description">Return to the findings, evidence, and proposed changes from a saved review.</p>
      </div>
      <label className="search"><Search size={16} /><input type="search" aria-label="Search reviews"
        placeholder="Find a project…" value={search} onChange={event => setSearch(event.target.value)} /></label>
    </div>
    {loading ? <div className="loading-surface" aria-busy="true">Loading review history…</div> : filtered.length ? <>
      <div className="review-table">
        <div className="table-labels" aria-hidden="true"><span>Project</span><span>Review state</span><span>Created</span><span>Model spend</span><span /></div>
        {visible.map(job => <button className="review-row" key={job.id} onClick={() => open(job.id)}>
          <div><strong>{job.name || "Project"}</strong><span className="file-path">{job.source}</span></div>
          <Status value={job.status} />
          <time>{job.created_at ? new Date(job.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}</time>
          <span className="mono">{typeof job.cost === "number" ? money(job.cost) : "—"}</span><ArrowUpRight size={17} />
        </button>)}
      </div>
      {!search && filtered.length > 8 && <button className="history-more button quiet" onClick={() => setShowAll(value => !value)}>
        {showAll ? "Show recent only" : `Show all ${filtered.length} reviews`}
      </button>}
    </> : <Empty title={search ? "No matching reviews" : "Your first review starts here"}>
      <p>{search ? "Try a different project name or path." : "Choose your source above. Your review will stay in this local workspace, ready to revisit."}</p>
    </Empty>}
  </section>;
}
