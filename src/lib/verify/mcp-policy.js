import { readBoundedRegularFile, VerifyInputError, deepFreeze } from './schema.js';
import { assertAllowedMcpTool, officialMcpSource } from './mcp-sources.js';

export const MCP_EVIDENCE_POLICY_SCHEMA = 'praxis.verify.mcp-evidence-policy/v1';
const ASSERTIONS = new Set(['text-includes', 'text-not-includes', 'json-path-equals', 'count-zero', 'count-positive']);

function cleanValue(value, label) {
  const text = String(value || '').trim();
  if (!text || text.length > 256 || Array.from(text).some((ch) => ch.charCodeAt(0) < 32)) throw new VerifyInputError('invalid-mcp-policy', `${label} is invalid.`);
  return text;
}

function validateCall(raw, source, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new VerifyInputError('invalid-mcp-policy', `MCP call ${index + 1} must be an object.`);
  return {
    tool: assertAllowedMcpTool(source, cleanValue(raw.tool, 'MCP tool')),
    arguments: raw.arguments && typeof raw.arguments === 'object' && !Array.isArray(raw.arguments) ? raw.arguments : {},
  };
}

function validateExpectation(raw) {
  if (!raw || typeof raw !== 'object' || !ASSERTIONS.has(raw.type)) throw new VerifyInputError('invalid-mcp-policy', 'Every MCP evidence check needs a reviewed expectation.');
  const result = { type: raw.type };
  if (raw.path !== undefined) result.path = cleanValue(raw.path, 'expectation path');
  if (raw.value !== undefined) result.value = raw.value;
  if (raw.type === 'json-path-equals' && (!result.path || !Object.hasOwn(raw, 'value'))) throw new VerifyInputError('invalid-mcp-policy', 'json-path-equals needs path and value.');
  if ((raw.type === 'text-includes' || raw.type === 'text-not-includes') && typeof raw.value !== 'string') throw new VerifyInputError('invalid-mcp-policy', `${raw.type} needs a string value.`);
  return result;
}

export function validateMcpEvidencePolicy(raw) {
  if (!raw || typeof raw !== 'object' || raw.schema !== MCP_EVIDENCE_POLICY_SCHEMA || !Array.isArray(raw.checks)) {
    throw new VerifyInputError('invalid-mcp-policy', `Expected ${MCP_EVIDENCE_POLICY_SCHEMA} with a checks array.`);
  }
  if (raw.checks.length > 50) throw new VerifyInputError('invalid-mcp-policy', 'MCP evidence policy exceeds 50 checks.');
  const ids = new Set();
  const checks = raw.checks.map((check, index) => {
    if (!check || typeof check !== 'object') throw new VerifyInputError('invalid-mcp-policy', `MCP check ${index + 1} must be an object.`);
    const id = cleanValue(check.id, 'check id');
    if (ids.has(id)) throw new VerifyInputError('invalid-mcp-policy', `Duplicate MCP check id: ${id}`);
    ids.add(id);
    const source = officialMcpSource(check.source);
    if (!Array.isArray(check.claimIds) || !check.claimIds.length || check.claimIds.some((value) => typeof value !== 'string' || !value)) throw new VerifyInputError('invalid-mcp-policy', `MCP check ${id} must name claimIds.`);
    if (!Array.isArray(check.calls) || !check.calls.length || check.calls.length > 25) throw new VerifyInputError('invalid-mcp-policy', `MCP check ${id} must contain 1-25 calls.`);
    const timeoutMs = Number(check.timeoutMs || 15_000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) throw new VerifyInputError('invalid-mcp-policy', `MCP check ${id} has an invalid timeoutMs.`);
    return {
      id,
      source: source.id,
      claimIds: [...new Set(check.claimIds)],
      calls: check.calls.map((call, callIndex) => validateCall(call, source, callIndex)),
      expectation: validateExpectation(check.expectation),
      timeoutMs,
      projectRef: check.projectRef === undefined ? undefined : cleanValue(check.projectRef, 'projectRef'),
    };
  });
  return deepFreeze({ schema: MCP_EVIDENCE_POLICY_SCHEMA, checks });
}

export function readMcpEvidencePolicy(file) {
  let raw;
  try { raw = JSON.parse(readBoundedRegularFile(file, 'MCP evidence policy')); }
  catch (error) {
    if (error instanceof VerifyInputError) throw error;
    throw new VerifyInputError('invalid-mcp-policy', `MCP evidence policy is not valid JSON: ${error.message}`);
  }
  return validateMcpEvidencePolicy(raw);
}