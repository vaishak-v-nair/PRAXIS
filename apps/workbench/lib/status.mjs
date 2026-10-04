// UI semantics only. Unknown/model states never become execution proof.
const success = new Set(['passed','complete','checked','configured','works','ready','observed','demonstrated','runtime_observed','release_candidate','available']);
const danger = new Set(['failed','fails','error','critical','high','timeout','missing key','blocked','contradicted','placeholder_risk']);
const warning = new Set(['uncertain','warning','medium','attention','limited','unsupported','not_established','needs_human_review','paused','not_detected']);
export function statusMeta(value) {
  const status = String(value || 'unknown').toLowerCase();
  if (status === 'model says works') return {tone:'positive', icon:'model', label:'Model says works'};
  if (status === 'model flags failure') return {tone:'negative', icon:'model', label:'Model flags failure'};
  if (status === 'model supports finding') return {tone:'neutral', icon:'model', label:'Supports finding'};
  if (status === 'model challenges finding') return {tone:'warning', icon:'model', label:'Challenges finding'};
  return {tone:success.has(status) ? 'positive' : danger.has(status) ? 'negative' : warning.has(status) ? 'warning' : 'neutral',
    icon:success.has(status) ? 'check' : danger.has(status) ? 'error' : warning.has(status) ? 'warning' : 'neutral', label:status.replaceAll('_',' ')};
}

export function evidenceLabel(value) {
  return String(value || '').replace(/^REALITY:\s*/i, '');
}

// Presentation only: a low-confidence source suggestion is not an executed failure.
// Keep the recorded assessment intact for reports, exports and agent handoffs.
/** @param {import("./contracts").Job} job */
export function reviewPresentation(job) {
  const assessment = job.assessment;
  const readiness = assessment?.readiness;
  const blockers = readiness?.blockers;
  const sourceConcern = readiness?.status === 'blocked' &&
    assessment?.implementation?.status === 'placeholder_risk' &&
    Array.isArray(job.checks) && job.checks.length === 0 && assessment.checks_failed === 0 &&
    Array.isArray(blockers) && blockers.length > 0 && blockers.every(blocker => {
      if (typeof blocker !== 'string' || !/^REALITY:\s/.test(blocker)) return false;
      const matches = job.findings?.filter(finding => finding.title === evidenceLabel(blocker));
      return matches?.length === 1 && ['low', 'info'].includes(matches[0].severity.toLowerCase()) &&
        matches[0].confidence === 'suggestion';
    });
  if (!sourceConcern) return { readiness, implementation: assessment?.implementation,
    dimensions: assessment?.dimensions, title: assessment?.title, sourceConcern: false };
  const detail = 'Source inspection suggests a concern, but no runtime check was executed. Confirm the intended behavior before release; readiness is not established.';
  return { sourceConcern: true, title: 'Confirm the source concern',
    readiness: { ...readiness, status: 'not_established', label: 'Source concern needs confirmation', detail },
    implementation: { ...assessment.implementation, status: 'needs_human_review',
      label: 'Source concern needs confirmation', detail },
    dimensions: assessment.dimensions?.map(dimension => dimension.id === 'reality' ?
      { ...dimension, status: 'needs_human_review', detail } : dimension) };
}
