"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { request, message } from "./client";
import type { Job, Health, ProjectStatus, WorkspacePage } from "./contracts";
import { readWorkspaceLocation, workspaceLocation, reviewViews } from "./navigation.mjs";
import { applyProjectStatus, unavailableProjectStatus } from "./project-status.mjs";

async function projectPages(target: number): Promise<WorkspacePage> {
  const first = await request<WorkspacePage>(`/workspace?scope=projects&quick=true&limit=${Math.min(target, 100)}`, undefined, AbortSignal.timeout(15000));
  let result = first;
  while (result.next_offset !== null && result.items.length < target) {
    const next = await request<WorkspacePage>(`/workspace?scope=projects&quick=true&limit=${Math.min(100, target - result.items.length)}&offset=${result.next_offset}`,
      undefined, AbortSignal.timeout(15000));
    if (next.next_offset === result.next_offset || !next.items.length) break;
    result = { ...next, items: [...result.items, ...next.items] };
  }
  return result;
}

export function useWorkspace() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [projectPage, setProjectPage] = useState<WorkspacePage | null>(null);
  const [projectError, setProjectError] = useState("");
  const [loadingMoreProjects, setLoadingMoreProjects] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [view, setView] = useState("overview");
  const [creating, setCreating] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingJob, setLoadingJob] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [streaming, setStreaming] = useState(false);
  const selection = useRef<string | null>(null);
  const loadedProjects = useRef(30);
  const pendingStatus = useRef(new Set<string>());
  const statusCooldown = useRef(new Map<string, number>());
  const disposed = useRef(false);
  const [statusPulse, setStatusPulse] = useState(0);
  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      request<Health>("/health", undefined, AbortSignal.timeout(8000)),
      request<Job[]>("/jobs", undefined, AbortSignal.timeout(8000)),
      projectPages(loadedProjects.current),
    ]);
    if (results[0].status === "fulfilled") { setHealth(results[0].value); setOnline(true); } else setOnline(false);
    if (results[1].status === "fulfilled") setJobs(results[1].value);
    else setError("Could not refresh review history. Your local records have not been deleted.");
    if (results[2].status === "fulfilled") {
      setProjectPage(results[2].value);
      setProjectError("");
    }
    else { setProjectPage(null); setProjectError("Could not load projects from the local service. Review history is still available below."); }
    setLoading(false);
  }, []);
  const loadMoreProjects = useCallback(async () => {
    if (loadingMoreProjects || projectPage?.next_offset == null) return;
    setLoadingMoreProjects(true);
    try {
      const next = await request<WorkspacePage>(`/workspace?scope=projects&quick=true&limit=30&offset=${projectPage.next_offset}`, undefined, AbortSignal.timeout(15000));
      const present = new Set(projectPage.items.map(item => `${item.kind}:${item.id}`));
      loadedProjects.current = Math.max(loadedProjects.current,
        projectPage.items.length + next.items.filter(item => !present.has(`${item.kind}:${item.id}`)).length);
      setProjectPage(current => {
        if (!current) return next;
        const present = new Set(current.items.map(item => `${item.kind}:${item.id}`));
        return { ...next, items: [...current.items, ...next.items.filter(item => !present.has(`${item.kind}:${item.id}`))] };
      });
      setProjectError("");
    } catch { setProjectError("Could not load more projects. Try again."); }
    finally { setLoadingMoreProjects(false); }
  }, [loadingMoreProjects, projectPage]);
  useEffect(() => () => { disposed.current = true; }, []);
  useEffect(() => {
    if (!online || !projectPage) return;
    const available = Math.max(0, 2 - pendingStatus.current.size);
    if (!available) return;
    const candidates = projectPage.items.filter(item => item.kind === "project" && item.freshness === "checking" &&
      item.latest_job_id && item.open_job_id === item.latest_job_id &&
      !pendingStatus.current.has(`${item.id}:${item.project_revision}:${item.latest_job_id}`) &&
      (statusCooldown.current.get(`${item.id}:${item.project_revision}:${item.latest_job_id}`) || 0) <= Date.now()).slice(0, available);
    for (const item of candidates) {
      if (item.kind !== "project" || !item.latest_job_id) continue;
      const key = `${item.id}:${item.project_revision}:${item.latest_job_id}`;
      pendingStatus.current.add(key);
      void request<ProjectStatus>(`/projects/${encodeURIComponent(item.id)}/status`, undefined, AbortSignal.timeout(150000))
        .then(status => { if (!disposed.current) setProjectPage(current => applyProjectStatus(current, status)); })
        .catch(() => {
          statusCooldown.current.set(key, Date.now() + 60000);
          if (!disposed.current) setProjectPage(current => unavailableProjectStatus(current, item.id, item.project_revision, item.latest_job_id));
        })
        .finally(() => {
          pendingStatus.current.delete(key);
          if (!disposed.current) setStatusPulse(value => value + 1);
        });
    }
  }, [online, projectPage, statusPulse]);
  const open = useCallback((next: string | null, replace = false, create = false) => {
    if (selection.current !== next || !next) { setJob(null); setLoadingJob(!!next); }
    selection.current = next; setId(next); setError("");
    setView("overview"); setCreating(create && !next);
    window.history[replace ? "replaceState" : "pushState"](null, "", workspaceLocation(window.location.href, { id: next, creating: create }));
  }, []);
  const navigate = useCallback((next: string) => {
    if (!selection.current || !reviewViews.includes(next)) return;
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("view"); else url.searchParams.set("view", next);
    setView(next);
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
  }, []);
  useEffect(() => {
    const restore = () => {
      const next = readWorkspaceLocation(window.location.href);
      // Back between sections must not discard or refetch the current record.
      if (selection.current !== next.id) { setJob(null); setLoadingJob(!!next.id); }
      selection.current = next.id; setId(next.id); setView(next.view); setCreating(next.creating); setError("");
    };
    restore(); void refresh();
    window.addEventListener("popstate", restore);
    const timer = setInterval(() => void refresh(), 60000);
    return () => { clearInterval(timer); window.removeEventListener("popstate", restore); };
  }, [refresh]);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController(); let stopped = false; let polling = false;
    const receive = (value: Job) => {
      if (stopped || selection.current !== id || value.id !== id) return;
      setJob(previous => previous && (previous.revision ?? 0) > (value.revision ?? 0) ? previous : value);
      setLoadingJob(false);
      setJobs(previous => [value, ...previous.filter(item => item.id !== value.id)]);
    };
    const poll = async () => {
      if (polling) return; polling = true;
      try { receive(await request<Job>(`/jobs/${encodeURIComponent(id)}`, undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]))); }
      catch (error) { if (!stopped) { setError(message(error)); setLoadingJob(false); } }
      finally { polling = false; }
    };
    void poll();
    const stream = new EventSource(`/api/jobs/${encodeURIComponent(id)}/events`);
    stream.onopen = () => { if (!stopped) setStreaming(true); };
    stream.onerror = () => { if (!stopped) setStreaming(false); };
    const update = (event: MessageEvent) => { try { receive(JSON.parse(event.data)); } catch { /* Ignore malformed transport events; polling remains authoritative. */ } };
    stream.onmessage = update; stream.addEventListener("job", update as EventListener);
    const timer = setInterval(() => void poll(), 5000);
    return () => { stopped = true; controller.abort(); stream.close(); clearInterval(timer); setStreaming(false); };
  }, [id]);
  const mutate = async (path: string, body: unknown) => {
    setBusy(true); setError("");
    try {
      const value = await request<Job>(path, body);
      if (value?.id) {
        if (selection.current !== value.id && path === "/scans") open(value.id);
        if (selection.current === value.id) { setJob(value); setLoadingJob(false); }
      }
      await refresh(); return value;
    } catch (error) { setError(message(error)); throw error; }
    finally { setBusy(false); }
  };
  return { jobs, projectPage, projectError, loadingMoreProjects, loadMoreProjects, job, id, view, creating, navigate, health, online, loading, loadingJob, busy, error, streaming, open, refresh, mutate, setError, setHealth };
}
