import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appPath = join(__dirname, '..', 'apps', 'workbench');

if (existsSync(appPath)) {
  // Installing the dependency-free CLI must not prepare an optional app, probe
  // Python/Docker, modify local evidence, or download another dependency tree.
  console.log('PRAXIS CLI installed. Workbench is optional and needs separate setup.');
  console.log('Run npx praxis-memory workbench --check for readiness and setup instructions.');
}
