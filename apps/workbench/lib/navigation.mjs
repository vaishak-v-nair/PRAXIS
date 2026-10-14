// URL state is presentation only; it never authorizes a backend action.
export const reviewViews = ['overview', 'findings', 'execution', 'changes', 'workspace', 'evidence', 'source map', 'activity'];
export const findingSeverities = ['all', 'critical', 'high', 'medium', 'low', 'info'];

/** @param {string | URL} href */
export function readWorkspaceLocation(href) {
  const params = new URL(href).searchParams;
  const id = params.get('job') || null;
  return {
    id,
    view: id && reviewViews.includes(params.get('view') || '') ? params.get('view') || 'overview' : 'overview',
    creating: !id && (params.get('new') === '1' || !!params.get('project')),
  };
}

/**
 * @param {string | URL} href
 * @param {{id?: string | null, view?: string, creating?: boolean}} options
 */
export function workspaceLocation(href, { id = null, view = 'overview', creating = false } = {}) {
  const url = new URL(href);
  for (const key of ['job', 'view', 'new', 'project', 'finding', 'severity', 'q']) url.searchParams.delete(key);
  if (id) {
    url.searchParams.set('job', id);
    if (reviewViews.includes(view) && view !== 'overview') url.searchParams.set('view', view);
  } else if (creating) url.searchParams.set('new', '1');
  return url.pathname + url.search + url.hash;
}

/** @param {string | URL} href */
export function readFindingLocation(href) {
  const params = new URL(href).searchParams;
  const severity = params.get('severity') || 'all';
  return {
    finding: params.get('finding') || null,
    severity: findingSeverities.includes(severity) ? severity : 'all',
    query: (params.get('q') || '').slice(0, 200),
  };
}

/**
 * Finding state is navigation only; it never changes the evidence or authorizes a fix.
 * @param {string | URL} href
 * @param {{finding?: string | null, severity?: string, query?: string}} state
 */
export function findingLocation(href, { finding = null, severity = 'all', query = '' } = {}) {
  const url = new URL(href);
  for (const key of ['finding', 'severity', 'q']) url.searchParams.delete(key);
  if (finding) url.searchParams.set('finding', finding);
  if (findingSeverities.includes(severity) && severity !== 'all') url.searchParams.set('severity', severity);
  if (query.trim()) url.searchParams.set('q', query.trim().slice(0, 200));
  return url.pathname + url.search + url.hash;
}
