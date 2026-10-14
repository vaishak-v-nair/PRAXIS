// Real rendered UI -> authenticated owner -> existing Python engine -> browser
// -> persisted state. Fixture projects are explicitly trusted, never user data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquireReviewService } from '../../src/lib/review-service.js';
import { startReviewRuntime } from '../../src/lib/review-service-runtime.js';
import { readReviewStatus } from '../../src/lib/review-status.js';
import { reviewSources } from '../../src/lib/review-install.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = path.join(root, 'apps/workbench');
const python = process.env.PRAXIS_QA_PYTHON || path.join(app, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const qa = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-assurance-qa-'));
const server = `const http = require('node:http');
const fs = require('node:fs');
const file = require('node:path').join(__dirname, 'state.json');
const broken = __BROKEN__;
if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ count: 0 }));
const app = http.createServer((req, res) => {
  if (req.url === '/api/items' && req.method === 'GET') { res.setHeader('content-type', 'application/json'); return res.end(fs.readFileSync(file)); }
  if (req.url === '/api/create' && req.method === 'POST') {
    if (!broken) { const current = JSON.parse(fs.readFileSync(file)); fs.writeFileSync(file, JSON.stringify({ count: current.count + 1 })); }
    res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ saved: true }));
  }
  res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA form</title><label>Title<input aria-label="Title"></label><button>Save</button><p id="outcome"></p><script>document.querySelector("button").onclick=async()=>{await fetch("/api/create",{method:"POST"});document.querySelector("#outcome").textContent="Saved"}</script></html>');
});
app.listen(Number(process.env.PORT || 4173), '127.0.0.1');
`;
for (const broken of [false, true]) {
  const directory = path.join(qa, broken ? 'false-success' : 'true-change'); fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'server.js'), server.replace('__BROKEN__', String(broken)));
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: broken ? 'false-success' : 'true-change', version: '1.0.0', scripts: { start: 'node server.js', test: 'node --test' } }));
  fs.writeFileSync(path.join(directory, 'basic.test.js'), `const { test } = require('node:test'); const assert = require('node:assert/strict'); test('server source exists', () => assert.ok(require('node:fs').readFileSync('server.js','utf8').includes('/api/create')));`);
}
const uploadProject = path.join(qa, 'upload-project'); fs.mkdirSync(uploadProject);
fs.writeFileSync(path.join(uploadProject, 'app.py'), 'DEBUG = True\nprint("Source inspection must not execute this file")\n');
fs.writeFileSync(path.join(uploadProject, 'README.md'), '# Upload intake QA\n');
fs.writeFileSync(path.join(uploadProject, '.env'), 'QA_UPLOAD_SECRET=excluded-before-upload\n');
fs.writeFileSync(path.join(qa, 'provider.env'), '# QA: no model requests or keys\n');
const agentFixture = path.join(qa, 'agent.cjs');
fs.writeFileSync(agentFixture, `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{if(input.includes('This private note is not shared'))process.exit(8);console.log('Plan: inspect server.js, add a behavioral test for POST /api/create, then independently check the persisted count. No changes or tests were performed.');});`);
const browserScript = path.join(root, 'scripts/ci/assurance-ui-smoke.py');
let service;
try {
  service = await acquireReviewService({ dataRoot: path.join(qa, 'data'), version: 'qa', runtimeId: reviewSources().fingerprint,
    start: args => startReviewRuntime({ ...args, root: app, python,
      env: { ...process.env, PRAXIS_WORKBENCH_DATA_DIR: path.join(qa, 'data'), PRAXIS_WORKBENCH_ENV_FILE: path.join(qa, 'provider.env'), PRAXIS_NODE_EXECUTABLE: process.execPath,
        PRAXIS_AGENT_ADAPTERS: JSON.stringify({ 'qa-coder': { plan: [process.execPath, agentFixture] } }) },
      log: value => { if (/error|traceback/i.test(value)) process.stderr.write(value); },
    }),
  });
  const url = await service.browserUrl();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(python, [browserScript, url, qa], { cwd: app, shell: false, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject); child.once('close', code => resolve(code));
  });
  if (result !== 0) throw new Error('The rendered assurance smoke failed.');
  const status = await readReviewStatus({ dataRoot: path.join(qa, 'data') });
  if (status.status !== 'available' || status.projects.length !== 3) throw new Error('Sanitized CLI/MCP status did not match the live projects.');
  fs.writeFileSync(path.join(qa, 'status.json'), JSON.stringify(status, null, 2));
  console.log('PASS authenticated rendered UI, project coordination, true persisted state, false success detection, batched folder intake, source map, agent brief, responsive layout, sanitized CLI/MCP status.');
  console.log(`QA evidence retained: ${qa}`);
} finally { await service?.stop({ force: true }); }
