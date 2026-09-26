import crypto from 'node:crypto';
import { stableStringify } from '../receipt/store.js';
import { RESULT_SCHEMA, parseManifestText, readBoundedRegularFile, stableId, VerifyInputError } from './schema.js';
import { extractClaimsFromText, manifestFromManualClaims } from './claims.js';
import { resolveTarget, confirmTargetUnchanged } from './target.js';
import { createLedger } from './ledger.js';
import { runStaticObservers } from './observers.js';
import { evaluatePolicy } from './policy.js';
import { persistVerifyResult } from './artifacts.js';
import { runTrustedObservers } from './runner.js';
import { readTrustPolicy } from './trust.js';
import { captureTask } from './task.js';
import { readMcpEvidencePolicy } from './mcp-policy.js';
import { runMcpEvidenceObservers } from './mcp-evidence.js';
import { assertClaimsBound, bindClaimsToTarget } from './binding.js';
function loadClaims(options) {
  if (options.manifestObject) return options.manifestObject;
  if (options.manifest) return parseManifestText(readBoundedRegularFile(options.manifest, 'claim manifest'));
  if (options.claims?.length) return manifestFromManualClaims(options.claims);
  if (options.report) return extractClaimsFromText(readBoundedRegularFile(options.report, 'agent report'), { kind: 'report', path: options.report });
  throw new VerifyInputError('missing-claims', 'Provide an agent report, manifest, or explicit claim.');
}
function prepare(options) { const target = resolveTarget(options.cwd || process.cwd(), options), manifest = loadClaims(options), claims = assertClaimsBound(bindClaimsToTarget(manifest.claims, target)); const fallback = claims.map((c) => c.sourceText).join('; ') || `Verify commit ${target.head}`; return { target, claims, task: captureTask(options.taskText || fallback, options.taskSource || { kind: options.taskText ? 'input' : 'derived' }) }; }
function finish(startedAt, mode, target, claims, task, observations, ledger, options, extra = {}) {
  const decision = evaluatePolicy(claims, observations, options.policy), endState = confirmTargetUnchanged(target), complete = target.clean && endState.unchanged && !observations.some((o) => o.status === 'failed');
  const unsigned = { schema: RESULT_SCHEMA, startedAt, mode, task, target, claims, observations, ledgerDigest: ledger.digest(), decision, complete, endState, ...extra };
  const id = stableId(crypto.createHash('sha256').update(stableStringify(unsigned)).digest('hex'), 'v'), result = Object.freeze({ ...unsigned, id });
  return Object.freeze({ ...result, artifact: persistVerifyResult(target.root, result, { now: startedAt, keyDir: options.keyDir, receiptDir: options.receiptDir }) });
}
export function verifyStatic(options = {}) { const startedAt = options.now || new Date().toISOString(), { target, claims, task } = prepare(options), ledger = createLedger(target), observations = runStaticObservers(target, claims, ledger); return finish(startedAt, 'static', target, claims, task, observations, ledger, options); }
export async function verifyTrusted(options = {}) { const startedAt = options.now || new Date().toISOString(), { target, claims, task } = prepare(options); if (!options.trustPolicy) throw new VerifyInputError('trust-policy-required', 'Trusted mode requires --trust-policy <file>.', 'praxis verify --mode static --claim CLAIM'); const trust = readTrustPolicy(options.trustPolicy), ledger = createLedger(target); runStaticObservers(target, claims, ledger); const observations = await runTrustedObservers(target, claims, ledger, trust, { signal: options.signal }); return finish(startedAt, 'trusted', target, claims, task, observations, ledger, options, { trust: { schema: trust.schema, commands: trust.commands, allowedEnv: trust.allowedEnv, network: trust.network } }); }
export { VerifyInputError };

export async function verifyWithMcp(options = {}) {
  const startedAt = options.now || new Date().toISOString();
  const { target, claims, task } = prepare(options);
  if (!options.mcpPolicy) throw new VerifyInputError('mcp-policy-required', 'Official MCP evidence requires --mcp-policy <file>.');
  const mcpPolicy = readMcpEvidencePolicy(options.mcpPolicy);
  const ledger = createLedger(target);
  let trustMetadata = {};
  if (options.mode === 'trusted') {
    if (!options.trustPolicy) throw new VerifyInputError('trust-policy-required', 'Trusted mode requires --trust-policy <file>.', 'praxis verify --mode static --claim CLAIM');
    const trust = readTrustPolicy(options.trustPolicy);
    await runTrustedObservers(target, claims, ledger, trust, { signal: options.signal });
    trustMetadata = { trust: { schema: trust.schema, commands: trust.commands, allowedEnv: trust.allowedEnv, network: trust.network } };
  } else {
    runStaticObservers(target, claims, ledger);
  }
  await runMcpEvidenceObservers(target, claims, ledger, mcpPolicy, options.mcpRuntime);
  return finish(startedAt, options.mode === 'trusted' ? 'trusted+mcp' : 'static+mcp', target, claims, task, ledger.entries(), ledger, options, {
    ...trustMetadata,
    mcpEvidence: { schema: mcpPolicy.schema, checks: mcpPolicy.checks.map((check) => ({ id: check.id, source: check.source, claimIds: check.claimIds })) },
  });
}