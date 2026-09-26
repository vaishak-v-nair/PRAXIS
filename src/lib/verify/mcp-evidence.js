import crypto from 'node:crypto';
import { stableStringify } from '../receipt/store.js';
import { VerifyInputError } from './schema.js';
import { authForSource, endpointForSource, officialMcpSource } from './mcp-sources.js';
import { McpHttpClient } from './mcp-client.js';

function digest(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function resultValue(result) {
  if (result?.structuredContent !== undefined) return result.structuredContent;
  if (Array.isArray(result?.content)) {
    const texts = result.content.filter((item) => item?.type === 'text').map((item) => item.text);
    if (texts.length === 1) {
      try { return JSON.parse(texts[0]); } catch { return texts[0]; }
    }
    return texts.join('\n');
  }
  return result;
}

function atPath(value, path) {
  return String(path || '').split('.').filter(Boolean).reduce((current, key) => {
    if (current === undefined || current === null) return undefined;
    const index = /^\d+$/.test(key) ? Number(key) : key;
    return current[index];
  }, value);
}

export function expectationMatches(expectation, value) {
  const text = typeof value === 'string' ? value : stableStringify(value);
  if (expectation.type === 'text-includes') return text.includes(expectation.value);
  if (expectation.type === 'text-not-includes') return !text.includes(expectation.value);
  const selected = expectation.path ? atPath(value, expectation.path) : value;
  if (expectation.type === 'json-path-equals') return stableStringify(selected) === stableStringify(expectation.value);
  const count = Array.isArray(selected) || typeof selected === 'string' ? selected.length : selected && typeof selected === 'object' ? Object.keys(selected).length : Number(selected);
  if (expectation.type === 'count-zero') return count === 0;
  if (expectation.type === 'count-positive') return Number.isFinite(count) && count > 0;
  return false;
}

export async function runMcpEvidenceObservers(target, claims, ledger, policy, { env = process.env, fetchImpl = globalThis.fetch, clientFactory } = {}) {
  const claimIds = new Set(claims.map((claim) => claim.id));
  for (const check of policy.checks) {
    for (const claimId of check.claimIds) if (!claimIds.has(claimId)) throw new VerifyInputError('unknown-mcp-claim', 'MCP check ' + check.id + ' references unknown claim ' + claimId + '.');
    const source = officialMcpSource(check.source);
    const endpoint = endpointForSource(source, check, env);
    const create = clientFactory || ((options) => new McpHttpClient(options));
    const client = create({ endpoint, headers: authForSource(source, env), fetchImpl, timeoutMs: check.timeoutMs, source });
    const callEvidence = [];
    try {
      await client.initialize();
      let last;
      for (const call of check.calls) {
        last = await client.callTool(call.tool, call.arguments);
        callEvidence.push({ tool: call.tool, argumentsDigest: digest(call.arguments), resultDigest: digest(last) });
      }
      const value = resultValue(last);
      const matched = expectationMatches(check.expectation, value);
      ledger.append({
        observer: 'official-mcp:' + source.id,
        version: 1,
        claimIds: check.claimIds,
        applicability: source.evidenceClass,
        strength: source.strength,
        status: matched ? 'supports' : 'contradicts',
        details: {
          checkId: check.id,
          vendor: source.vendor,
          officialEndpoint: source.endpoint,
          endpointDigest: digest(endpoint),
          calls: callEvidence,
          expectation: check.expectation,
          observedDigest: digest(value),
        },
      });
    } catch (error) {
      ledger.append({
        observer: 'official-mcp:' + source.id,
        version: 1,
        claimIds: check.claimIds,
        applicability: source.evidenceClass,
        strength: 'none',
        status: 'failed',
        details: { checkId: check.id, vendor: source.vendor, officialEndpoint: source.endpoint, calls: callEvidence, errorCode: error.code || 'mcp-failed' },
      });
    }
  }
  return ledger.entries();
}