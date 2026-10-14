// A sanitized view of the optional local service. Never start it, link a
// historical review, read project source, or change memory just to query status.
import path from 'node:path';
import { reviewHome } from './review-install.js';
import { readServiceDescriptor, authenticateService } from './review-service.js';

export async function readReviewStatus({ projectId, previousRevision, dataRoot = path.join(reviewHome(), 'data'), fetchImpl = fetch } = {}) {
  if (projectId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(projectId)) throw new Error('Invalid project ID.');
  if (previousRevision !== undefined && (!Number.isSafeInteger(previousRevision) || previousRevision < 0)) throw new Error('Invalid status revision.');
  const unavailable = { schema: 'praxis.project-review-status/v1', status: 'unavailable', projects: [],
    detail: 'The optional local Project Review service is not available or could not be authenticated. No ready state was inferred.', authorizes_execution: false };
  let descriptor;
  try { descriptor = readServiceDescriptor(path.join(dataRoot, '.praxis-service/endpoint.json')); await authenticateService(descriptor, { fetchImpl }); }
  catch { return unavailable; }
  const control = async (action, body = {}) => {
    const response = await fetchImpl(`${descriptor.origin}/__praxis/client/${action}`, {
      method: 'POST', headers: { authorization: `Bearer ${descriptor.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000), redirect: 'error',
    });
    if (!response.ok) throw new Error('Project status is unavailable.');
    return response.json();
  };
  try {
    const ids = projectId ? [projectId] : (await control('projects')).map(project => project.id).slice(0, 50);
    const projects = [];
    for (const id of ids) {
      if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id)) throw new Error('Invalid status identity.');
      const observed = await control('project-status', { project_id: id, ...(previousRevision !== undefined ? { previous_revision: previousRevision } : {}) });
      if (observed.instance_id !== descriptor.instanceId || observed.project_id !== id || !Number.isSafeInteger(observed.revision) || observed.revision < 0) throw new Error('Project status identity changed.');
      // An allowlist protects every consumer even against an unexpected service.
      const item = {};
      for (const name of ['schema_version', 'instance_id', 'project_id', 'job_id', 'snapshot_id', 'revision', 'project_revision', 'job_revision', 'phase', 'freshness', 'source_freshness', 'source_available', 'checks', 'findings_count', 'readiness', 'model_spend', 'model_budget', 'emitted_at']) item[name] = observed[name];
      projects.push(item);
    }
    return { schema: unavailable.schema, status: 'available', instance_id: descriptor.instanceId, projects, authorizes_execution: false };
  } catch { return unavailable; }
}
