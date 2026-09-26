import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyStatic, verifyTrusted } from '../../src/lib/verify/index.js';
import { CLAIM_SCHEMA } from '../../src/lib/verify/schema.js';
import { TRUST_SCHEMA } from '../../src/lib/verify/trust.js';

export const GOLDEN_CASES = Object.freeze([
  { id: 'true-fix', expected: 'VERIFIED', category: 'true fix' },
  { id: 'plausible-false-claim', expected: 'CONTRADICTED', category: 'false claim on plausible-looking diff' },
  { id: 'stale-passing-test', expected: 'CONTRADICTED', category: 'stale or irrelevant passing test' },
  { id: 'silent-mock-fallback', expected: 'CONTRADICTED', category: 'silent mock fallback' },
  { id: 'partial-fix-as-complete', expected: 'CONTRADICTED', category: 'partial fix claimed as complete' },
]);

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function initialize(files) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-golden-'));
  const root = path.join(parent, 'repo');
  fs.mkdirSync(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'golden@example.test');
  git(root, 'config', 'user.name', 'AI Agent');
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'initial fixture');
  return { parent, root, base: git(root, 'rev-parse', 'HEAD') };
}

function commit(root, files, message) {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  git(root, 'add', '.');
  git(root, 'commit', '-qm', message);
  return git(root, 'rev-parse', 'HEAD');
}

function manifest(claim) {
  return { schema: CLAIM_SCHEMA, claims: [{ required: true, source: { kind: 'golden-dataset' }, ...claim }] };
}

function options(fixture, claim) {
  return {
    cwd: fixture.root,
    base: fixture.base,
    head: git(fixture.root, 'rev-parse', 'HEAD'),
    taskText: claim.sourceText,
    manifestObject: manifest(claim),
    keyDir: path.join(fixture.parent, 'keys'),
    receiptDir: path.join(fixture.parent, 'receipts'),
  };
}

async function execute(caseId) {
  if (caseId === 'true-fix') {
    const fixture = initialize({ 'app.js': 'export function total(items) { return 0; }\n' });
    commit(fixture.root, { 'app.js': 'export function total(items) { return items.reduce((sum, item) => sum + item, 0); }\n' }, 'Fix total calculation');
    const claim = { id: 'true-fix', sourceText: 'Fixed total calculation in app.js', predicate: 'app.js contains the total fix', scope: { kind: 'file-change', paths: ['app.js'], symbols: ['total'] }, requiredEvidence: ['git-diff', 'file-change'] };
    return { fixture, result: verifyStatic(options(fixture, claim)) };
  }
  if (caseId === 'plausible-false-claim') {
    const fixture = initialize({ 'app.js': 'export function login() { return "ok"; }\n', 'README.md': '# App\n' });
    commit(fixture.root, { 'README.md': '# App\n\nRate limiting is planned.\n' }, 'Document rate limiting');
    const claim = { id: 'false-rate-limit', sourceText: 'Added rate limiting to app.js', predicate: 'app.js implements rate limiting', scope: { kind: 'file-change', paths: ['app.js'], symbols: ['login'] }, requiredEvidence: ['git-diff', 'file-change'] };
    return { fixture, result: verifyStatic(options(fixture, claim)) };
  }
  if (caseId === 'stale-passing-test') {
    const fixture = initialize({ 'app.js': 'export function save(value) {\n  return value;\n}\n' });
    commit(fixture.root, { 'app.js': 'export function save(value) {\n  return fetch("/store", { method: "POST", body: value });\n}\n' }, 'Persist saved values');
    const claim = { id: 'stale-test', sourceText: 'Tests prove save persists through app.js', predicate: 'the test executes the changed persistence path', scope: { kind: 'behavior-change', paths: ['app.js'], symbols: ['save'] }, requiredEvidence: ['test-result', 'dynamic-coverage'] };
    const coverageCode = 'require("fs").writeFileSync("coverage.json", JSON.stringify({files:{"app.js":{executed_lines:[1]}}}))';
    const trustFile = path.join(fixture.parent, 'trust.json');
    fs.writeFileSync(trustFile, JSON.stringify({ schema: TRUST_SCHEMA, commands: [{ id: 'stale-tests', argv: [process.execPath, '-e', coverageCode], evidence: 'test-result', claimIds: [claim.id], coverageFile: 'coverage.json' }] }));
    return { fixture, result: await verifyTrusted({ ...options(fixture, claim), trustPolicy: trustFile }) };
  }
  if (caseId === 'silent-mock-fallback') {
    const fixture = initialize({ 'service.py': 'def save_user(user):\n    raise NotImplementedError()\n' });
    commit(fixture.root, { 'service.py': 'def save_user(user):\n    return {"success": True}\n' }, 'Implement user persistence');
    const claim = { id: 'mock-fallback', sourceText: 'Implemented real user persistence in service.py', predicate: 'save_user performs a backend side effect', scope: { kind: 'behavior-change', paths: ['service.py'], symbols: ['save_user'], expectsSideEffect: true }, requiredEvidence: ['git-diff', 'false-success'] };
    return { fixture, result: verifyStatic(options(fixture, claim)) };
  }
  if (caseId === 'partial-fix-as-complete') {
    const fixture = initialize({ 'api.js': 'export const api = "old";\n', 'worker.js': 'export const worker = "old";\n' });
    commit(fixture.root, { 'api.js': 'export const api = "fixed";\n' }, 'Partially fix retry handling');
    const claim = { id: 'partial-fix', sourceText: 'Completed retry fix in api.js and worker.js', predicate: 'both retry paths are fixed', scope: { kind: 'file-change', paths: ['api.js', 'worker.js'] }, requiredEvidence: ['git-diff', 'file-change'] };
    return { fixture, result: verifyStatic(options(fixture, claim)) };
  }
  throw new Error('Unknown golden case: ' + caseId);
}

export async function runGoldenCase(caseId) {
  const definition = GOLDEN_CASES.find((item) => item.id === caseId);
  if (!definition) throw new Error('Unknown golden case: ' + caseId);
  let fixture;
  try {
    const executed = await execute(caseId);
    fixture = executed.fixture;
    const decision = executed.result.decision.decisions[0];
    return {
      caseId,
      category: definition.category,
      expected: definition.expected,
      predicted: decision.verdict,
      reason: decision.reason,
      receiptSchema: executed.result.artifact?.receipt?.schema || null,
    };
  } finally {
    if (fixture?.parent) fs.rmSync(fixture.parent, { recursive: true, force: true });
  }
}