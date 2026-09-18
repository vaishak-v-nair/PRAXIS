import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appPath = join(__dirname, '..', 'apps', 'workbench');

if (existsSync(appPath)) {
  console.log('Installing PRAXIS workbench dependencies...');
  try {
    // 1. Install Node.js dependencies for the workbench
    if (existsSync(join(appPath, 'package.json'))) {
      console.log('Setting up workbench npm packages...');
      execSync('npm install', { cwd: appPath, stdio: 'inherit' });
    }

    // 2. Install Python backend dependencies
    const isWindows = process.platform === 'win32';
    const pyExe = isWindows ? join('.venv', 'Scripts', 'python.exe') : join('.venv', 'bin', 'python');
    
    if (!existsSync(join(appPath, pyExe))) {
      console.log('Setting up workbench Python virtual environment...');
      execSync('python -m venv .venv', { cwd: appPath, stdio: 'inherit' });
    }

    if (existsSync(join(appPath, 'backend', 'requirements.txt'))) {
      console.log('Installing backend dependencies...');
      execSync(`"${pyExe}" -m pip install -r backend/requirements.txt`, { cwd: appPath, stdio: 'inherit' });
    }
  } catch (err) {
    console.error('Failed to install workbench dependencies:', err.message);
    console.error('You can install them manually later by going to apps/workbench and running npm install, and setting up the .venv.');
  }
}
