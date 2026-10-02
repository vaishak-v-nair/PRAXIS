import path from 'node:path';
import { reviewLayout, managedStatus, setupReview } from '../lib/review-install.js';
import { availablePorts, openReview, waitForReview } from '../lib/review-launch.js';
import { launchWorkbench } from '../lib/workbench.js';
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
    else if (argv[i] === '--json') options.json = true;
    else if (argv[i] === '--setup-only') options.setupOnly = true;
    else throw new Error('Unknown review option. Use praxis review --help.');
  }
  if (options.json && !options.check) throw new Error('Use --json with --check. Setup and services write their own logs.');
  if (options.check && options.setupOnly) throw new Error('--check inspects only; use --setup-only separately to prepare the app.');
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
    const layout = reviewLayout({ home: options.home });
    if (options.check) {
      const status = managedStatus(layout);
      if (options.json) emitJson(status);
      else console.log(status.ok ? `Review is prepared: ${status.root}. Provider access and runtime behavior are not certified.`
        : 'Project Review needs setup. Run npx praxis-memory review. No files were changed.');
      return status.ok ? 0 : 1;
    }
    if (!options.setupOnly) await availablePorts();
    console.log('PRAXIS Project Review · local setup');
    console.log(`Saved reviews: ${layout.data}`);
    console.log('Only application dependencies are installed. No submitted project is executed and no model request is made.');
    const status = await setupReview(layout, { signal: controller.signal });
    if (options.setupOnly) { console.log('Production setup prepared. Start it with npx praxis-memory review.'); return 0; }
    const env = { ...process.env, PRAXIS_WORKBENCH_DATA_DIR: layout.data,
      PRAXIS_WORKBENCH_ENV_FILE: layout.envFile, REGEN_BACKEND_PORT: '9123', REGEN_BACKEND_URL: 'http://127.0.0.1:9123' };
    return await launchWorkbench(status, { production: true, env,
      ready: async signal => {
        await waitForReview({ signal });
        console.log(`Project Review is ready: ${status.frontendUrl}. Keep this terminal open; Ctrl+C stops both services.`);
        if (options.open) openReview();
      },
    });
  } catch (error) {
    console.error(controller.signal.aborted ? 'Review was stopped. Saved data remains in place.' : `Review could not start: ${error.message}`);
    return controller.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  }
}
