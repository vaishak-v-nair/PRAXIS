"use client";
import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { ArrowRight, Folder, Plus, Search } from "lucide-react";
import type { WorkspaceItem, WorkspaceProjectItem } from "@/lib/contracts";

export function ProjectCommandBar({ items, query, setQuery, openProject, newReview }: {
  items: WorkspaceItem[];
  query: string;
  setQuery: (value: string) => void;
  openProject: (id: string) => void;
  newReview: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter((item): item is WorkspaceProjectItem => item.kind === "project")
      .filter(project => !needle || project.name.toLocaleLowerCase().includes(needle))
      .slice(0, 6);
  }, [items, query]);

  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        setExpanded(true);
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);

  function choose(project: WorkspaceProjectItem) {
    setExpanded(false);
    setQuery("");
    if (project.open_job_id) openProject(project.open_job_id);
    else newReview();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setExpanded(false);
      input.current?.blur();
    } else if (event.key === "Enter" && matches.length) {
      event.preventDefault();
      choose(matches[0]);
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setExpanded(false);
  }

  return <div className="command-dock" onBlur={handleBlur}>
    <div className="command-search" role="search">
      <Search size={18} aria-hidden="true" />
      <input ref={input} type="search" aria-label="Search loaded projects"
        value={query} placeholder="Search loaded projects" onChange={event => { setQuery(event.target.value); setExpanded(true); }}
        onFocus={() => setExpanded(true)} onKeyDown={handleKeyDown} autoComplete="off" />
      <kbd aria-hidden="true">Ctrl/⌘ K</kbd>
    </div>
    {expanded && <div className="command-results" id="command-results" role="region" aria-label="Project search results">
      <div className="command-results-heading">{query.trim() ? "Matching loaded projects" : "Recent loaded projects"}</div>
      {matches.length ? matches.map(project => <button type="button" key={project.id} onClick={() => choose(project)}>
        <Folder size={16} aria-hidden="true" /><span><strong>{project.name}</strong><small>{project.open_job_id ? "Open saved review" : "Start a review"}</small></span><ArrowRight size={15} aria-hidden="true" />
      </button>) : <p>No loaded project matches. Try another name or start a new review.</p>}
      <button type="button" className="command-create" onClick={() => { setExpanded(false); setQuery(""); newReview(); }}><Plus size={16} aria-hidden="true" /><span>New review</span><ArrowRight size={15} aria-hidden="true" /></button>
    </div>}
  </div>;
}
