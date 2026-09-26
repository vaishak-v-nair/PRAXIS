import { workbenchStatus, launchWorkbench } from '../lib/workbench.js';
import { emitJson } from '../lib/jsonout.js';

export async function workbench(argv = []) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
  praxis workbench — local project review and repair

  Runs the complete web app imported from demo, with its Python API.
  Scans use your selected model provider; repairs happen in copies.
  Project execution and applying changes require confirmation in the app.

  --check [--json]    inspect source and dependency readiness without starting
  --production       run the production app after build:workbench
  --path <directory> use apps/workbench in another PRAXIS checkout

  Requires the workbench's separate npm dependencies and Python .venv.
  Setup: docs/WORKBENCH-INTEGRATION.md. Stop both services with Ctrl+C.
`);
    return 0;
  }
  let appPath;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--path') {
      appPath = argv[++i];
      if (!appPath || appPath.startsWith('--')) {
        console.error('workbench --path requires an application directory.');
        return 1;
      }
    } else if (!['--check', '--json', '--production'].includes(argv[i])) {
      console.error('Unknown workbench option. Use praxis workbench --help.');
      return 1;
    }
  }
  if (argv.includes('--json') && !argv.includes('--check')) {
    console.error('Use --json with --check; running services write their own logs.');
    return 1;
  }
  const status = workbenchStatus({ appPath });
  if (argv.includes('--check')) {
    if (argv.includes('--json')) emitJson(status);
    else {
      console.log(`Workbench: ${status.root}`);
      console.log(status.ok ? 'Source and dependency files are present. Provider access and runtime behavior are not checked.'
        : `Missing: ${status.missing.join(', ')}. See docs/WORKBENCH-INTEGRATION.md for setup.`);
    }
    return status.ok ? 0 : 1;
  }
  if (!status.ok) {
    console.error(`Workbench is not ready: ${status.missing.join(', ')}.`);
    console.error('Use a PRAXIS source checkout, install apps/workbench dependencies, or supply --path.');
    console.error('See docs/WORKBENCH-INTEGRATION.md. No dependencies were installed automatically.');
    return 1;
  }
  console.log(`PRAXIS Workbench · ${status.frontendUrl} · API ${status.backendUrl}`);
  console.log('Starting services only. Scans, model spending, runtime checks, and source application remain explicit actions.');
  return launchWorkbench(status, { production: argv.includes('--production') });
}
