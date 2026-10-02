"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { request, message } from "./client";
import type { Job, Health } from "./contracts";

export function useWorkspace() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingJob, setLoadingJob] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [streaming, setStreaming] = useState(false);
  const selection = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      request<Health>("/health", undefined, AbortSignal.timeout(8000)),
      request<Job[]>("/jobs", undefined, AbortSignal.timeout(8000)),
    ]);
    if (results[0].status === "fulfilled") { setHealth(results[0].value); setOnline(true); } else setOnline(false);
    if (results[1].status === "fulfilled") setJobs(results[1].value);
    else setError("Could not refresh review history. Your local records have not been deleted.");
    setLoading(false);
  }, []);
  const open = useCallback((next: string | null, replace = false) => {
    selection.current = next; setId(next); setJob(null); setError(""); setLoadingJob(!!next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("job", next); else url.searchParams.delete("job");
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
  }, []);
  useEffect(() => {
    const restore = () => { const next = new URLSearchParams(window.location.search).get("job"); selection.current = next; setId(next); setJob(null); setLoadingJob(!!next); setError(""); };
    restore(); void refresh();
    window.addEventListener("popstate", restore);
    const timer = setInterval(() => void refresh(), 15000);
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
  return { jobs, job, id, health, online, loading, loadingJob, busy, error, streaming, open, refresh, mutate, setError, setHealth };
}
