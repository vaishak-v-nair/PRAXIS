import { readBoundedRegularFile, VerifyInputError, deepFreeze } from './schema.js';
export const TRUST_SCHEMA = 'praxis.verify.trust/v1';
export function validateTrustPolicy(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schema !== TRUST_SCHEMA) throw new VerifyInputError('invalid-trust-policy', `Expected schema ${TRUST_SCHEMA}.`);
  if (!Array.isArray(raw.commands) || !raw.commands.length || raw.commands.length > 20) throw new VerifyInputError('invalid-trust-policy', 'Trust policy requires 1 to 20 commands.');
  const commands = raw.commands.map((entry, index) => {
    if (!entry || !Array.isArray(entry.argv) || !entry.argv.length || entry.argv.some((v) => typeof v !== 'string' || !v || /[\u0000\r\n]/.test(v))) throw new VerifyInputError('invalid-trust-command', `Trust command ${index + 1} requires a safe argv array.`);
    const evidence = entry.evidence || 'test-result';
    if (!['test-result', 'build-result', 'ci-result', 'static-analysis'].includes(evidence)) throw new VerifyInputError('invalid-trust-command', `Unsupported command evidence type: ${evidence}`);
    return deepFreeze({ id: String(entry.id || `command-${index + 1}`), argv: [...entry.argv], evidence, claimIds: Array.isArray(entry.claimIds) ? entry.claimIds.map(String) : [], coverageFile: entry.coverageFile ? String(entry.coverageFile).replace(/\\/g, '/') : null, timeoutMs: Math.min(Math.max(Number(entry.timeoutMs) || 120000, 1000), 300000) });
  });
  const allowedEnv = Array.isArray(raw.allowedEnv) ? raw.allowedEnv.filter((v) => typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v)).slice(0, 50) : [];
  return deepFreeze({ schema: TRUST_SCHEMA, commands, allowedEnv, network: raw.network === 'allowed' ? 'allowed' : 'not-guaranteed-denied', maxOutputBytes: Math.min(Math.max(Number(raw.maxOutputBytes) || 1024 * 1024, 1024), 8 * 1024 * 1024) });
}
export function readTrustPolicy(file) { try { return validateTrustPolicy(JSON.parse(readBoundedRegularFile(file, 'trust policy'))); } catch (error) { if (error instanceof VerifyInputError) throw error; throw new VerifyInputError('malformed-trust-policy', `Trust policy is not valid JSON: ${error.message}`); } }
