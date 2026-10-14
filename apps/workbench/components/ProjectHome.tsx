"use client";
import { ArrowRight, Check, CircleAlert, Clock3, Folder, FolderGit2, FolderUp, Plus } from "lucide-react";
import { useMemo } from "react";
import type { WorkspaceItem, WorkspaceProjectItem } from "@/lib/contracts";
import { projectState } from "@/lib/project-status.mjs";
import { Empty, Notice } from "./ui";

function reviewDate(value: string | null) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Date unavailable";
}

export function ProjectHome({ items, total, nextOffset, loading, error, loadingMore, loadMore, open, search,
  newReview }: {
  items: WorkspaceItem[]; total: number; nextOffset: number | null; loading: boolean; error: string; search: string;
  loadingMore: boolean; loadMore: () => void; open: (id: string) => void; newReview: () => void;
}) {
  const projects = useMemo(() => items.filter((item): item is WorkspaceProjectItem => item.kind === "project"), [items]);
  const visible = projects.filter(project => project.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="project-home">
    <section className="project-home-intro" aria-labelledby="projects-title">
      <div><span className="section-label">YOUR WORKSPACE</span><h1 id="projects-title">Your projects</h1>
        <p>Open a project to see what its latest review established and what needs attention.</p></div>
    </section>
    {error && <Notice error>{error}</Notice>}
    <section className="project-library" aria-labelledby="library-title">
      <h2 id="library-title" className="sr-only">Saved projects</h2>
      {search.trim() && <p className="project-match-count">{visible.length} matching loaded project{visible.length === 1 ? "" : "s"}</p>}
      {loading ? <div className="loading-surface" aria-busy="true">Loading projects…</div> : visible.length ? <div className="project-list">
        {visible.map(project => {
          const state = projectState(project);
          const Icon = project.source_kind === "github" ? FolderGit2 : project.source_kind === "upload" ? FolderUp : Folder;
          const StateIcon = state.tone === "positive" ? Check : state.tone === "negative" || state.tone === "warning" ? CircleAlert : Clock3;
          const content = <><span className="project-list-icon"><Icon size={19} /></span><span className="project-list-main"><strong>{project.name}</strong><span>{project.source_kind === "github" ? "GitHub repository" : project.source_kind === "upload" ? "Uploaded folder" : "Local folder"} · {reviewDate(project.activity_at)}</span></span>
            <span className={`project-list-state ${state.tone}`}><span><StateIcon size={15} />{state.label}</span><small>{state.detail}</small></span>
            <ArrowRight className="project-list-arrow" size={17} aria-hidden="true" /></>;
          return <button className="project-list-row" key={project.id}
            onClick={() => project.open_job_id ? open(project.open_job_id) : newReview()}
            aria-label={project.open_job_id ? `Open ${project.name}: ${state.label}` : `Start a review for ${project.name}`}>{content}</button>;
        })}
      </div> : <Empty title={search ? "No matching loaded projects" : "Your first project starts here"}><p>{search ? "Try a different name or load more projects." : "Choose a local folder, upload a project, or paste a GitHub URL to begin."}</p>{!search && <button className="button primary" onClick={newReview}><Plus size={15} />Review a project</button>}</Empty>}
      {nextOffset !== null && <button className="button quiet project-load-more" disabled={loadingMore} onClick={loadMore} aria-label={`Load more projects, ${projects.length} of ${total} loaded`}>{loadingMore ? "Loading…" : "Load more projects"}</button>}
    </section>
  </div>;
}
