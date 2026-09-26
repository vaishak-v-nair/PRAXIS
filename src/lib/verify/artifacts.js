import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { redact } from '../redact.js';
import { stableStringify } from '../receipt/store.js';
import { stableId } from './schema.js';
import { signVerifyReceipt, verifyVerifyReceipt } from './verify-receipt.js';
function safeDirectory(parent, name) {
  const next = path.join(parent, name);
  if (fs.existsSync(next)) { const stat = fs.lstatSync(next); if (stat.isSymbolicLink() || !stat.isDirectory()) throw Object.assign(new Error(`Unsafe PRAXIS state path: ${next}`), { code: 'unsafe-state-path' }); const real = fs.realpathSync(next), root = fs.realpathSync(parent); if (real !== root && !real.startsWith(root + path.sep)) throw Object.assign(new Error(`PRAXIS state escapes its parent: ${next}`), { code: 'unsafe-state-path' }); }
  else fs.mkdirSync(next, { mode: 0o700 }); return next;
}
function externalDirectory(value, label) {
  const absolute = path.resolve(value); fs.mkdirSync(absolute, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(absolute); if (stat.isSymbolicLink() || !stat.isDirectory()) throw Object.assign(new Error(`Unsafe ${label} path: ${absolute}`), { code: 'unsafe-state-path' });
  return fs.realpathSync(absolute);
}
function stateDirs(root, options = {}) { const realRoot = fs.realpathSync(root), praxis = safeDirectory(realRoot, '.praxis'), verify = safeDirectory(praxis, 'verify'); return { receipts: options.receiptDir ? externalDirectory(options.receiptDir, 'receipt') : safeDirectory(verify, 'receipts'), keys: options.keyDir ? externalDirectory(options.keyDir, 'signing key') : safeDirectory(verify, 'signing') }; }
export function persistVerifyResult(root, result, { now = new Date().toISOString(), keyDir = null, receiptDir = null } = {}) {
  const { receipts, keys } = stateDirs(root, { keyDir, receiptDir }), safe = JSON.parse(redact(stableStringify(result)));
  const resultDigest = crypto.createHash('sha256').update(stableStringify(safe)).digest('hex'), id = result.id || stableId(resultDigest, 'v');
  const receipt = signVerifyReceipt({ id, task: safe.task, commitRange: { base: safe.target.base, head: safe.target.head, baseTree: safe.target.baseTree, headTree: safe.target.headTree }, claims: safe.claims, verdicts: safe.decision.decisions, evidence: safe.observations, complete: safe.complete, endState: safe.endState, verifier: { name: 'praxis-memory', engine: 'verify-v1', version: process.env.npm_package_version || '0.14.0' }, timestamp: now, resultDigest }, keys);
  if (!verifyVerifyReceipt(receipt)) throw Object.assign(new Error('Verify receipt self-check failed.'), { code: 'verify-signature-failed' });
  const file = path.join(receipts, `${id}.json`); fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return Object.freeze({ id, file, digest: resultDigest, receiptId: id, receiptType: 'ed25519-public', signatureVerified: true });
}
