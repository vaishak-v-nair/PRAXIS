/** Merge only a status bound to the same project revision and review. */
export function applyProjectStatus(page, status) {
  if (!page || !status || typeof status !== 'object') return page;
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const valid = ['current', 'stale', 'unavailable'].includes(status.freshness) &&
    ['current', 'stale', 'unknown', 'unavailable'].includes(status.source_freshness) &&
    typeof status.phase === 'string' && typeof status.readiness === 'string' &&
    typeof status.implementation === 'string' && typeof status.assessment === 'string' &&
    count(status.findings_count) && status.checks && typeof status.checks === 'object' &&
    count(status.checks.passed) && count(status.checks.failed);
  let changed = false;
  const items = page.items.map(item => {
    if (item.kind !== 'project' || item.id !== status.project_id ||
        item.project_revision !== status.project_revision ||
        item.latest_job_id !== status.job_id || item.open_job_id !== item.latest_job_id) return item;
    changed = true;
    if (!valid) return { ...item, freshness: 'unavailable', source_freshness: 'unknown',
      readiness: 'not_established', implementation: 'not_established',
      assessment: 'incomplete', findings_count: 0, checks_passed: 0, checks_failed: 0 };
    // A stale saved copy may retain historical findings, but never a healthy
    // assessment or passing-check count on the current project home.
    const current = status.freshness === 'current';
    return { ...item, phase: status.phase, freshness: status.freshness,
      source_freshness: status.source_freshness,
      readiness: current ? status.readiness : 'not_established',
      implementation: current ? status.implementation : 'not_established',
      assessment: current ? status.assessment : 'incomplete',
      findings_count: current ? status.findings_count : 0,
      checks_passed: current ? status.checks.passed : 0,
      checks_failed: current ? status.checks.failed : 0 };
  });
  return changed ? { ...page, items } : page;
}

/** A failed freshness check has no authority to reuse old results. */
export function unavailableProjectStatus(page, projectId, projectRevision, jobId) {
  if (!page) return page;
  let changed = false;
  const items = page.items.map(item => {
    if (item.kind !== 'project' || item.id !== projectId ||
        item.project_revision !== projectRevision || item.latest_job_id !== jobId ||
        item.freshness !== 'checking') return item;
    changed = true;
    return { ...item, freshness: 'unavailable', source_freshness: 'unknown',
      readiness: 'not_established', implementation: 'not_established',
      assessment: 'incomplete', findings_count: 0, checks_passed: 0, checks_failed: 0 };
  });
  return changed ? { ...page, items } : page;
}

const activePhases = new Set(['queued', 'scanning', 'analyzing', 'planning_fix', 'fixing', 'verifying']);

/** Human-facing state derived from the recorded phase and checked evidence. */
export function projectState(project) {
  if (activePhases.has(project.phase)) return { label: 'Review started', detail: 'Open the review to see its current progress and recorded checks.', tone: 'working' };
  if (!project.open_job_id) return { label: 'No review yet', detail: 'Start a review to collect project evidence.', tone: 'neutral' };
  if (project.phase === 'paused') return { label: 'Review paused', detail: 'Existing results are saved; the review did not finish.', tone: 'warning' };
  if (['error', 'cancelled', 'unavailable'].includes(project.phase)) return { label: 'Review stopped', detail: 'Open the review to see what ran and what did not.', tone: 'warning' };
  if (project.freshness === 'checking') return { label: 'Updating status', detail: 'Comparing the saved review with this project before showing a result.', tone: 'working' };
  if (project.freshness === 'unavailable') return { label: 'Status unavailable', detail: 'Saved evidence could not be checked right now. Open the review or try again.', tone: 'warning' };
  if (project.freshness !== 'current') return { label: 'Review needs updating', detail: 'The saved review copy changed or is unavailable.', tone: 'warning' };
  if (['stale', 'unavailable'].includes(project.source_freshness)) return { label: 'Project changed', detail: 'The saved review does not establish the current source.', tone: 'warning' };
  if (project.readiness === 'blocked') return { label: 'Needs attention', detail: 'Recorded evidence blocks production readiness.', tone: 'negative' };
  if (project.readiness === 'release_candidate') return { label: 'Release candidate', detail: 'Required review gates passed for the saved snapshot.', tone: 'positive' };
  if (project.assessment === 'attention') return { label: 'Findings to review', detail: 'Inspect the recorded findings and their evidence.', tone: 'warning' };
  if (project.implementation === 'demonstrated') return { label: 'User journey observed', detail: 'A user journey ran; release readiness is still separate.', tone: 'positive' };
  if (project.implementation === 'runtime_observed') return { label: 'Project checks passed', detail: 'Tests ran; end-to-end behavior is not yet established.', tone: 'neutral' };
  return { label: 'Source reviewed', detail: 'Behavior and release readiness need more evidence.', tone: 'neutral' };
}
