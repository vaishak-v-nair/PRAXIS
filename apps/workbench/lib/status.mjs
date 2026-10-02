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
