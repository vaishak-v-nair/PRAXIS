import path from 'node:path';
import { reviewLayout, managedStatus, setupReview } from '../lib/review-install.js';
import { openReview } from '../lib/review-launch.js';
import { acquireReviewService } from '../lib/review-service.js';
import { startReviewRuntime } from '../lib/review-service-runtime.js';
import { readReviewStatus } from '../lib/review-status.js';
import { emitJson } from '../lib/jsonout.js';

export function reviewOptions(argv) {
  const options = { open: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--home') {
      const home = argv[++i];
      if (!home || home.startsWith('--')) throw new Error('--home requires a dedicated application-data directory.');
      options.home = path.resolve(home);
    } else if (argv[i] === '--no-open') options.open = false;
    else if (argv[i] === '--check') options.check = true;
    else if (argv[i] === '--status') options.status = true;
    else if (argv[i] === '--project') {
      options.projectId = argv[++i];
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(options.projectId || '')) throw new Error('--project requires an opaque project ID.');
    }
    else if (argv[i] === '--json') options.json = true;
    else if (argv[i] === '--setup-only') options.setupOnly = true;
    else throw new Error('Unknown review option. Use praxis review --help.');
  }
  if (options.json && !options.check && !options.status) throw new Error('Use --json with --check or --status. Setup and services write their own logs.');
  if (options.check && options.setupOnly) throw new Error('--check inspects only; use --setup-only separately to prepare the app.');
  if (options.status && (options.check || options.setupOnly)) throw new Error('--status reads a running owner only; use setup or readiness separately.');
  if (options.projectId && !options.status) throw new Error('Use --project with --status.');
  return options;
}

export async function review(argv = []) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
  praxis review — install and open local Project Review

  First run downloads the app's locked dependencies and a checksum-pinned
  Astral uv runtime, prepares private Python, and builds the interface.
  Later runs reuse this setup. Requires Node.js 22+ with npm and internet
  for initial setup; Git and a system Python installation are unnecessary.

  --check [--json]  inspect readiness without downloads or file writes
  --status [--json] read sanitized status from the authenticated local owner
  --project <id>   filter --status to an opaque project identity
  --setup-only     prepare the app without starting services
  --no-open        start services without opening a browser
  --home <folder>  use a dedicated persistent app-data folder

  Provider keys are configured in the local interface. Setup makes no
  model calls. Docker is needed only for isolated project execution.
  Project execution and applying changes require confirmation in the app.
  Existing checkout evidence, memory and hooks are never migrated.
  Stop the local services with Ctrl+C.
`);
    return 0;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try {
    const options = reviewOptions(argv);
    if (options.status) {
      const status = await readReviewStatus({ projectId: options.projectId,
        ...(options.home ? { dataRoot: path.join(options.home, 'data') } : {}) });
      if (options.json) emitJson(status);
      else if (status.status === 'unavailable') console.log(status.detail);
      else console.log(status.projects.length ? status.projects.map(item => `${item.project_id} · ${item.phase} · review copy ${item.freshness} · original ${item.source_freshness || 'unknown'} · readiness ${item.readiness}`).join('\n') : 'The local service has no linked project reviews.');
      return status.status === 'available' ? 0 : 1;
    }
    const layout = reviewLayout({ home: options.home });
    if (options.check) {
      const status = managedStatus(layout);
      if (options.json) emitJson(status);
      else console.log(status.ok ? `Review is prepared: ${status.root}. Provider access and runtime behavior are not certified.`
        : 'Project Review needs setup. Run npx praxis-memory review. No files were changed.');
      return status.ok ? 0 : 1;
    }
    console.log('PRAXIS Project Review · local setup');
    console.log(`Saved reviews: ${layout.data}`);
    console.log('Only application dependencies are installed. No submitted project is executed and no model request is made.');
    const status = await setupReview(layout, { signal: controller.signal });
    if (options.setupOnly) { console.log('Production setup prepared. Start it with npx praxis-memory review.'); return 0; }
    const env = { ...process.env, PRAXIS_WORKBENCH_DATA_DIR: layout.data,
      PRAXIS_WORKBENCH_ENV_FILE: layout.envFile, PRAXIS_NODE_EXECUTABLE: process.execPath };
    let runtime;
    const service = await acquireReviewService({ dataRoot: layout.data,
      version: layout.version, runtimeId: layout.sources.fingerprint, signal: controller.signal,
      start: args => { runtime = startReviewRuntime({ ...args, root: layout.root, python: status.python, env }); return runtime; },
    });
    console.log(`Project Review is ready: ${service.origin}. ${service.owned ? 'Keep this terminal open; Ctrl+C interrupts its services.' : 'Connected to the existing owner. Closing this terminal leaves its work running.'}`);
    const browserUrl = await service.browserUrl();
    if (options.open) openReview({ url: browserUrl });
    else console.log(`Private one-use opening link (valid for one minute): ${browserUrl}`);
    if (!service.owned) return 0;
    try {
      const stopped = new Promise(resolve => controller.signal.addEventListener('abort', () => resolve(null), { once: true }));
      const result = await Promise.race([runtime.closed, stopped]);
      return controller.signal.aborted ? 130 : result?.some(item => item.code) ? 1 : 0;
    } finally { await service.stop({ force: true }); }
  } catch (error) {
    console.error(controller.signal.aborted ? 'Review was stopped. Saved data remains in place.' : `Review could not start: ${error.message}`);
    return controller.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  }
}
