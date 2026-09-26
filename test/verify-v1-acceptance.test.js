import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { CLAIM_SCHEMA } from '../src/lib/verify/schema.js';
import { TRUST_SCHEMA } from '../src/lib/verify/trust.js';
import { evaluatePolicy } from '../src/lib/verify/policy.js';
const CLI = path.resolve('src', 'cli.js');
function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim(); }
function init() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-v1-accept-')); git(root, 'init', '-q'); git(root, 'config', 'user.email', 'agent@example.test'); git(root, 'config', 'user.name', 'AI Agent'); fs.writeFileSync(path.join(root, 'app.js'), 'export function save(){ return false }\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'initial'); return root; }
function run(root, args, env = {}) { return spawnSync(process.execPath, [CLI, 'verify', ...args, '--json'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000, env: { ...process.env, ...env } }); }

test('zero-argument command derives task/report and completes through structured extraction', () => {
  const root = init(); fs.writeFileSync(path.join(root, 'app.js'), 'export function save(){ return fetch("/store") }\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'Updated app.js');
  const extractor = path.join(os.tmpdir(), 'praxis-extractor-' + process.pid + '-' + Date.now() + '.cjs');
  fs.writeFileSync(extractor, `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({schema:'${CLAIM_SCHEMA}',claims:[{id:'app',sourceText:'Updated app.js',predicate:'app changed',scope:{kind:'file-change',paths:['app.js']},source:{kind:'report'},requiredEvidence:['file-change'],required:true}]})))`);
  const proc = run(root, [], { PRAXIS_VERIFY_EXTRACTOR_CMD: JSON.stringify([process.execPath, extractor]) });
  assert.equal(proc.status, 0, proc.stderr);
  const result = JSON.parse(proc.stdout);
  assert.equal(result.task.description, 'Updated app.js');
  assert.equal(result.decision.decisions[0].verdict, 'VERIFIED');
  assert.ok(fs.readdirSync(path.join(root, '.praxis', 'verify', 'extractions')).length);
});

test('ReGen-derived false-success check contradicts a behavior claim', () => {
  const root = init(); fs.writeFileSync(path.join(root, 'service.py'), 'def save_user():\n    return {"success": True}\n'); const base = git(root, 'rev-parse', 'HEAD'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'Add user persistence');
  const manifest = { schema: CLAIM_SCHEMA, claims: [{ id: 'persist', sourceText: 'Added user persistence in service.py', predicate: 'save_user persists a user', scope: { kind: 'behavior-change', paths: ['service.py'], symbols: ['save_user'], expectsSideEffect: true }, source: { kind: 'report' }, requiredEvidence: ['git-diff', 'false-success'], required: true }] };
  fs.writeFileSync(path.join(root, 'claims.json'), JSON.stringify(manifest));
  const proc = run(root, ['--task', 'Persist users', '--manifest', 'claims.json', '--base', base]);
  assert.equal(proc.status, 1, proc.stderr + proc.stdout);
  const result = JSON.parse(proc.stdout);
  assert.equal(result.decision.decisions[0].verdict, 'CONTRADICTED');
  assert.equal(result.observations.some((o) => o.observer === 'regen-false-success' && o.status === 'contradicts'), true);
});

test('dynamic test success verifies behavior only when coverage reaches its changed path', () => {
  const root = init(), base = git(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'app.js'), 'export function save(){ return fetch("/store") }\n');
  const manifest = { schema: CLAIM_SCHEMA, claims: [{ id: 'save', sourceText: 'Added persistence in app.js', predicate: 'save performs persistence', scope: { kind: 'behavior-change', paths: ['app.js'], symbols: ['save'] }, source: { kind: 'report' }, requiredEvidence: ['dynamic-coverage'], required: true }] };
  const coverageCode = `require('fs').writeFileSync('coverage.json',JSON.stringify({files:{'app.js':{executed_lines:[1]}}}))`;
  const trust = { schema: TRUST_SCHEMA, commands: [{ id: 'tests', argv: [process.execPath, '-e', coverageCode], evidence: 'test-result', claimIds: ['save'], coverageFile: 'coverage.json' }] };
  fs.writeFileSync(path.join(root, 'claims.json'), JSON.stringify(manifest)); fs.writeFileSync(path.join(root, 'trust.json'), JSON.stringify(trust)); git(root, 'add', '.'); git(root, 'commit', '-qm', 'Implement and test persistence');
  const proc = run(root, ['--task', 'Persist records', '--manifest', 'claims.json', '--base', base, '--mode', 'trusted', '--trust-policy', 'trust.json']);
  assert.equal(proc.status, 0, proc.stderr);
  const result = JSON.parse(proc.stdout);
  assert.equal(result.decision.decisions[0].verdict, 'VERIFIED');
  assert.equal(result.observations.some((o) => o.observer === 'dynamic-coverage' && o.status === 'supports'), true);
});

test('CI is supporting evidence and cannot verify a claim by itself', () => {
  const claim = { id: 'c', sourceText: 'Feature works' };
  const result = evaluatePolicy([claim], [{ hash: 'h', observer: 'ci-result', claimIds: ['c'], status: 'supports', strength: 'direct' }]);
  assert.equal(result.decisions[0].verdict, 'UNSUPPORTED');
});
