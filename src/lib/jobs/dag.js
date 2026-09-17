// The DAG Workflow Engine — orchestrate multi-step, multi-agent pipelines natively.
//
// Zero runtime dependencies: pure Node.js standard libraries.
// Every node in a DAG is a standard PRAXIS job (meta.json, out.log, err.log),
// inheriting detached execution, sandboxing, and cryptographic receipt sealing.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function newWorkflowRunId(now = new Date()) {
  const t = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return 'wf-' + t + '-' + crypto.randomBytes(2).toString('hex');
}

export function workflowsDir(praxisDir) {
  return path.join(praxisDir, 'flows');
}

export function workflowRunsDir(praxisDir) {
  return path.join(workflowsDir(praxisDir), 'runs');
}

/**
 * Validate a DAG specification.
 * Detects missing fields, duplicate step IDs, unknown dependencies, and cycles.
 * Returns { ok: true } or { ok: false, error: string }.
 */
export function validateDag(spec) {
  if (!spec || typeof spec !== 'object') {
    return { ok: false, error: 'Spec must be a valid JSON object' };
  }
  if (!spec.name || typeof spec.name !== 'string' || !spec.name.trim()) {
    return { ok: false, error: 'Workflow spec requires a non-empty "name"' };
  }
  if (!Array.isArray(spec.steps) || spec.steps.length === 0) {
    return { ok: false, error: 'Workflow spec requires a non-empty "steps" array' };
  }

  const stepIds = new Set();
  const stepMap = new Map();

  for (const step of spec.steps) {
    if (!step || typeof step !== 'object') {
      return { ok: false, error: 'Each step must be a valid object' };
    }
    if (!step.id || typeof step.id !== 'string' || !step.id.trim()) {
      return { ok: false, error: 'Each step must have a unique, non-empty "id"' };
    }
    if (stepIds.has(step.id)) {
      return { ok: false, error: `Duplicate step id "${step.id}" in workflow` };
    }
    if (!step.task || typeof step.task !== 'string' || !step.task.trim()) {
      return { ok: false, error: `Step "${step.id}" requires a non-empty "task"` };
    }
    stepIds.add(step.id);
    stepMap.set(step.id, step);
  }

  // Verify all dependencies exist and build adjacency map
  const inDegree = new Map();
  const adj = new Map();
  for (const id of stepIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const step of spec.steps) {
    const deps = Array.isArray(step.dependsOn) ? step.dependsOn : [];
    for (const dep of deps) {
      if (!stepIds.has(dep)) {
        return { ok: false, error: `Step "${step.id}" depends on unknown step "${dep}"` };
      }
      if (dep === step.id) {
        return { ok: false, error: `Step "${step.id}" cannot depend on itself` };
      }
      adj.get(dep).push(step.id);
      inDegree.set(step.id, inDegree.get(step.id) + 1);
    }
  }

  // Kahn's algorithm for cycle detection
  const queue = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  let visitedCount = 0;
  while (queue.length > 0) {
    const u = queue.shift();
    visitedCount++;
    for (const v of adj.get(u)) {
      inDegree.set(v, inDegree.get(v) - 1);
      if (inDegree.get(v) === 0) {
        queue.push(v);
      }
    }
  }

  if (visitedCount !== stepIds.size) {
    return { ok: false, error: 'Circular dependency cycle detected in workflow DAG' };
  }

  return { ok: true };
}

/**
 * Topologically sort steps into parallel execution tiers.
 * Tier 0: steps with no dependencies (can run immediately in parallel).
 * Tier N: steps whose dependencies are all satisfied in tiers < N.
 * Returns { ok: true, tiers: Array<Array<Step>> }
 */
export function topologicalSort(steps) {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const inDegree = new Map();
  const adj = new Map();
  const depth = new Map();

  for (const s of steps) {
    inDegree.set(s.id, (s.dependsOn || []).length);
    adj.set(s.id, []);
    depth.set(s.id, 0);
  }

  for (const s of steps) {
    for (const dep of s.dependsOn || []) {
      adj.get(dep).push(s.id);
    }
  }

  const queue = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(id);
      depth.set(id, 0);
    }
  }

  while (queue.length > 0) {
    const u = queue.shift();
    const curDepth = depth.get(u);
    for (const v of adj.get(u)) {
      depth.set(v, Math.max(depth.get(v), curDepth + 1));
      inDegree.set(v, inDegree.get(v) - 1);
      if (inDegree.get(v) === 0) {
        queue.push(v);
      }
    }
  }

  const maxDepth = Math.max(...depth.values(), 0);
  const tiers = Array.from({ length: maxDepth + 1 }, () => []);

  for (const [id, d] of depth.entries()) {
    tiers[d].push(stepMap.get(id));
  }

  return { ok: true, tiers };
}

/**
 * Substitute parent step outputs into child task prompts.
 * Supports syntax: {{steps.<stepId>.output}}
 */
export function interpolateStepTask(task, stepOutputs = {}) {
  return task.replace(/\{\{\s*steps\.([a-zA-Z0-9_-]+)\.output\s*\}\}/g, (_, stepId) => {
    return stepOutputs[stepId] != null ? String(stepOutputs[stepId]) : '';
  });
}

/**
 * Create and persist the initial workflow run metadata.
 */
export function createWorkflowRun(praxisDir, spec) {
  const v = validateDag(spec);
  if (!v.ok) return { error: v.error };

  const id = newWorkflowRunId();
  const dir = path.join(workflowRunsDir(praxisDir), id);
  fs.mkdirSync(dir, { recursive: true });

  const { tiers } = topologicalSort(spec.steps);

  const stepsState = {};
  for (const step of spec.steps) {
    stepsState[step.id] = {
      id: step.id,
      task: step.task,
      tool: step.tool || 'claude',
      mode: step.mode || 'plan',
      dependsOn: step.dependsOn || [],
      status: 'pending',
      jobId: null,
      startedAt: null,
      endedAt: null,
    };
  }

  const runMeta = {
    id,
    name: spec.name,
    description: spec.description || '',
    startedAt: new Date().toISOString(),
    status: 'running',
    tiers: tiers.map((t) => t.map((s) => s.id)),
    currentTier: 0,
    steps: stepsState,
  };

  const metaFile = path.join(dir, 'meta.json');
  fs.writeFileSync(metaFile, JSON.stringify(runMeta, null, 2));

  return { id, dir, metaFile, meta: runMeta };
}

/**
 * Read workflow run metadata.
 */
export function readWorkflowRun(praxisDir, id) {
  const file = path.join(workflowRunsDir(praxisDir), id, 'meta.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Update workflow run metadata atomically.
 */
export function updateWorkflowRun(praxisDir, id, patch) {
  const meta = readWorkflowRun(praxisDir, id);
  if (!meta) return null;
  const updated = { ...meta, ...patch };
  const file = path.join(workflowRunsDir(praxisDir), id, 'meta.json');
  fs.writeFileSync(file, JSON.stringify(updated, null, 2));
  return updated;
}
