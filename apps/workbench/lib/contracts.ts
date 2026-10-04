export interface Finding {
  id: string; category: string; severity: string; confidence: string | number;
  title: string; description: string; why: string;
  location?: { file?: string; line?: number }; evidence?: string; fix?: string; fixable: boolean;
}
export interface Job {
  review_goal?: string;
  collaboration?: { revision: number; participants: Array<{ session_id: string; name: string }>;
    notes: Array<{ id: string; author: string; kind: string; text: string; assigned_to: string; share_with_agents: boolean; created_at: string }> };
  team?: { status: string; phase: string; goal: string; max_parallel: number;
    agents: Array<{ id: string; agent: string; provider: string; model: string; status: string; peer_status: string; findings_added: number }>;
    discussions: Array<{ agent_id: string; agent: string; finding_id: string; position: "supports" | "challenges" | "uncertain";
      reason: string; location: { file: string; line: number }; evidence: string }> };
  revision?: number; id: string; source: string; name?: string; status: string; findings?: Finding[];
  coverage?: Array<{ name?: string; tool?: string; status?: string; detail?: string; message?: string }>;
  languages?: string[]; files_scanned?: number; commands?: Array<string[] | { argv?: string[]; label?: string }>;
  budget?: number | { limit?: number; spent?: number }; cost?: number; start_command?: string | string[]; applied?: boolean;
  events?: Array<{ time?: string; message: string }>; error?: string; created_at?: string;
  fix?: { diff?: string; changes?: unknown[]; review?: unknown; agents?: unknown[]; branch?: string };
  fix_plan?: { id: string; finding_ids: string[]; source_kind: "local" | "github" | "upload"; objective: string;
    assumptions: string[]; steps: Array<{ title: string; intent: string; files: string[]; validation: string; risk: string }>;
    user_journeys: string[]; unresolved: string[]; delivery: { method: string; summary: string };
    planner?: { provider?: string; model?: string }; created_at?: number };
  pressure_tests?: Array<{ agent: string; provider?: string; model?: string; journeys: Array<{ name?: string; result?: string; evidence?: string }>;
    gaps: string[]; findings_added: number; context?: Record<string, unknown> }>;
  checks?: unknown[];
  plan?: { files: number; manifests: string[]; test_file_count: number; test_files: string[];
    stages: Array<{ name: string; detail: string }>;
    understanding?: { languages: string[]; entrypoints: string[]; planning_files: string[]; commands_discovered: number;
      continuity: { status: string; detail: string } };
    graph: { nodes: string[]; edges: Array<{ source: string; target: string }>; limited: boolean; indexed_files: number; eligible_files: number } };
  assessment?: { status: string; title: string; findings: number; commands_passed: number; checks_failed: number; gaps: string[];
    attention_items?: Array<{ id: string; area: string; priority: string; title: string; summary: string; action: string; source: string }>;
    implementation?: { status: string; label: string; detail: string; evidence: string[] };
    readiness?: { status: string; label: string; detail: string; blockers: string[]; requirements?: string[] };
    dimensions?: Array<{ id: string; label: string; status: string; detail: string; evidence_count: number;
      evidence?: Array<{ kind: string; label: string; status: string; detail?: string; source?: string }>; limits?: string[] }> };
}
export type RuntimeMode = "host" | "docker";
export interface ScanOptions { ai_review: boolean; run_checks: boolean; trust_confirmed: boolean; allow_network: boolean; runtime_mode: RuntimeMode }
export interface Health {
  settings?: { provider?: string; model?: string; input_price?: number | null; output_price?: number | null };
  status?: string; providers?: Array<{ name: string; configured: boolean; verified?: boolean }>; tools?: unknown;
  docker?: { ready: boolean; engine: boolean; local_context: boolean; detail: string;
    images?: Record<string, { image: string; ready: boolean }> };
  [key: string]: unknown;
}
export interface ConnectedModel {
  provider: string;
  model: string;
  configured: boolean;
}
export function display(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) || "";
}
export function money(value: number | undefined): string { return `$${(value || 0).toFixed(2)}`; }
export function budgetOf(job: Job) {
  return typeof job.budget === "number" ? job.budget : job.budget?.limit ?? 5;
}
