export interface Finding {
  id: string; category: string; severity: string; confidence: string | number;
  title: string; description: string; why: string;
  location?: { file?: string; line?: number }; evidence?: string; fix?: string; fixable: boolean;
}
export interface Job {
  id: string; source: string; name?: string; status: string; findings?: Finding[];
  coverage?: Array<{ name?: string; tool?: string; status?: string; detail?: string; message?: string }>;
  languages?: string[]; files_scanned?: number; commands?: Array<string[] | { argv?: string[]; label?: string }>;
  budget?: number | { limit?: number; spent?: number }; cost?: number; start_command?: string | string[]; applied?: boolean;
  events?: Array<{ time?: string; message: string }>; error?: string; created_at?: string;
  fix?: { diff?: string; changes?: unknown[]; review?: unknown; agents?: unknown[]; branch?: string };
  checks?: unknown[];
}
export interface Health {
  settings?: { provider?: string; model?: string; input_price?: number | null; output_price?: number | null };
  status?: string; providers?: unknown; tools?: unknown; [key: string]: unknown;
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, body === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof value.detail === "string" ? value.detail : value.error || `Request failed (${response.status})`);
  return value as T;
}
export function display(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) || "";
}
export function money(value: number | undefined): string { return `$${(value || 0).toFixed(2)}`; }
export function budgetOf(job: Job) {
  return typeof job.budget === "number" ? job.budget : job.budget?.limit ?? 5;
}
