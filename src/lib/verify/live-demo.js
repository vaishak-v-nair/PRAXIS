import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { extractClaimsFromText } from './claims.js';
import { verifyStatic } from './index.js';
import { verifyVerifyReceipt } from './verify-receipt.js';

export const LIVE_SCENARIOS = Object.freeze({
  truthful: Object.freeze({
    id: 'truthful',
    label: 'True claim',
    tone: 'verified',
    task: 'Add request throttling and a focused test.',
    report: '- Updated src/login.js.\n- Created test/login-rate-limit.test.js.',
    explanation: 'The claimed implementation and test files are both present in the commit diff.',
    changes: Object.freeze({
      'src/login.js': 'const attempts = new Map();\nexport function login(user) {\n  const count = (attempts.get(user) || 0) + 1;\n  attempts.set(user, count);\n  if (count > 3) return { status: 429 };\n  return { status: 200 };\n}\n',
      'test/login-rate-limit.test.js': 'import assert from "node:assert/strict";\nimport { login } from "../src/login.js";\nfor (let i = 0; i < 3; i++) assert.equal(login("demo").status, 200);\nassert.equal(login("demo").status, 429);\n',
    }),
  }),
  falseClaim: Object.freeze({
    id: 'false-claim',
    label: 'False claim',
    tone: 'contradicted',
    task: 'Add request throttling and a focused test.',
    report: '- Updated src/login.js.\n- Created test/login-rate-limit.test.js.',
    explanation: 'The completion report names implementation and test files, but the commit changes documentation only.',
    changes: Object.freeze({
      'README.md': '# Demo app\n\nRequest throttling is planned for a later release.\n',
    }),
  }),
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function writeFiles(root, files) {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

function createFixture(scenario) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-live-'));
  const root = path.join(parent, 'repo');
  fs.mkdirSync(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'agent@praxis.demo');
  git(root, 'config', 'user.name', 'AI Coding Agent');
  writeFiles(root, {
    'src/login.js': 'export function login() { return { status: 200 }; }\n',
    'README.md': '# Demo app\n',
  });
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Initial application');
  const base = git(root, 'rev-parse', 'HEAD');
  writeFiles(root, scenario.changes);
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'AI agent: completed request throttling');
  return { parent, root, base, head: git(root, 'rev-parse', 'HEAD') };
}

function publicClaim(claim) {
  return { id: claim.id, text: claim.sourceText, kind: claim.scope.kind, paths: claim.scope.paths || [] };
}

function publicObservation(observation) {
  return {
    observer: observation.observer,
    status: observation.status,
    strength: observation.strength,
    claimIds: observation.claimIds,
    details: observation.details,
  };
}

function diffSnippet(root, base, head, file) {
  const raw = git(root, 'diff', '--no-color', '--unified=2', base, head, '--', file);
  const lines = raw.split(/\r?\n/).filter((line) => !/^diff --git |^index |^--- |^\+\+\+ /.test(line));
  return lines.slice(0, 24).join('\n').trim().slice(0, 2400);
}

function retrieveClaimEvidence(root, base, head, claims, changedFiles) {
  const changed = new Set(changedFiles);
  const claimedPaths = new Set();
  const snippets = [];
  for (const claim of claims) {
    for (const file of claim.scope.paths || []) {
      claimedPaths.add(file);
      const matched = changed.has(file);
      snippets.push({
        claimId: claim.id,
        claimText: claim.sourceText,
        path: file,
        status: matched ? 'matched' : 'missing',
        relationship: 'claim-path',
        language: path.extname(file).slice(1) || 'text',
        snippet: matched
          ? diffSnippet(root, base, head, file)
          : `No changed lines for ${file} in the bound commit range.`,
      });
    }
  }
  for (const file of changedFiles) {
    if (claimedPaths.has(file)) continue;
    snippets.push({
      claimId: null,
      claimText: null,
      path: file,
      status: 'context',
      relationship: 'changed-outside-claim',
      language: path.extname(file).slice(1) || 'text',
      snippet: diffSnippet(root, base, head, file),
    });
  }
  return {
    changedFiles,
    base,
    head,
    source: 'exact git diff',
    matchedClaimPaths: snippets.filter((item) => item.status === 'matched').length,
    missingClaimPaths: snippets.filter((item) => item.status === 'missing').length,
    snippets,
  };
}

function emit(onEvent, stage, state, data = {}) {
  onEvent?.({ type: 'stage', stage, state, at: new Date().toISOString(), ...data });
}

export function createLiveExecution(id, { onEvent = null, delayMs = 0 } = {}) {
  const scenario = Object.values(LIVE_SCENARIOS).find((item) => item.id === id);
  if (!scenario) throw new Error('Unknown PRAXIS Live scenario.');
  const fixture = createFixture(scenario);
  const pause = () => delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve();
  const runStage = async (stage, work) => {
    emit(onEvent, stage, 'running');
    await pause();
    const update = await work();
    emit(onEvent, stage, 'complete', update.event);
    return update.state;
  };

  const nodes = Object.freeze({
    extractor: async () => runStage('extractor', () => {
      const manifestObject = extractClaimsFromText(scenario.report, { kind: 'praxis-live-scenario', scenario: scenario.id });
      return {
        state: { manifestObject },
        event: { claims: manifestObject.claims.map(publicClaim) },
      };
    }),
    retriever: async (state) => runStage('retriever', () => {
      const changedFiles = git(fixture.root, 'diff', '--name-only', fixture.base, fixture.head).split(/\r?\n/).filter(Boolean);
      const evidence = retrieveClaimEvidence(fixture.root, fixture.base, fixture.head, state.manifestObject.claims, changedFiles);
      return { state: { evidence }, event: { evidence } };
    }),
    verifier: async (state) => runStage('verifier', () => {
      const result = verifyStatic({
        cwd: fixture.root,
        base: fixture.base,
        head: fixture.head,
        taskText: scenario.task,
        taskSource: { kind: 'praxis-live-scenario', scenario: scenario.id },
        manifestObject: state.manifestObject,
        keyDir: path.join(fixture.parent, 'signing'),
        receiptDir: path.join(fixture.parent, 'receipts'),
      });
      return {
        state: { result },
        event: { observations: result.observations.map(publicObservation) },
      };
    }),
    judge: async (state) => runStage('judge', () => {
      const verdicts = state.result.decision.decisions.map((decision) => ({
        claimId: decision.claimId,
        verdict: decision.verdict,
        reason: decision.reason,
      }));
      const verdict = state.result.decision.summary.headline;
      const receipt = JSON.parse(fs.readFileSync(state.result.artifact.file, 'utf8'));
      if (!verifyVerifyReceipt(receipt)) throw new Error('The live receipt failed its server-side Ed25519 self-check.');
      const final = {
        type: 'result',
        scenario: { id: scenario.id, label: scenario.label, task: scenario.task, report: scenario.report, explanation: scenario.explanation },
        verdict,
        verdicts,
        receipt,
        serverSignatureVerified: true,
      };
      return { state: { final }, event: { verdict, verdicts } };
    }),
  });

  return {
    nodes,
    finish(state) {
      if (!state.final) throw new Error('The live orchestration finished without a signed result.');
      onEvent?.(state.final);
      return state.final;
    },
    cleanup() { fs.rmSync(fixture.parent, { recursive: true, force: true }); },
  };
}

export async function runLiveScenario(id, options = {}) {
  const execution = createLiveExecution(id, options);
  try {
    let state = {};
    for (const stage of ['extractor', 'retriever', 'verifier', 'judge']) {
      state = { ...state, ...await execution.nodes[stage](state) };
    }
    return execution.finish(state);
  } finally {
    execution.cleanup();
  }
}
