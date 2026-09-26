import crypto from 'node:crypto';
import { POLICY_SCHEMA, stableId } from './schema.js';
import { stableStringify } from '../receipt/store.js';
const DECISIVE_STRENGTHS = new Set(['direct', 'runtime-direct', 'production-direct', 'database-direct']);
export const DEFAULT_POLICY = Object.freeze({ schema: POLICY_SCHEMA, id: 'verify-v1', missingEvidence: 'UNSUPPORTED', conflict: 'NEEDS_HUMAN_REVIEW', requiredUnresolvedBlocks: true });
export function evaluatePolicy(claims, observations, policy = DEFAULT_POLICY) {
  const policyDigest = crypto.createHash('sha256').update(stableStringify(policy)).digest('hex');
  const decisions = claims.map((claim) => {
    const related = observations.filter((o) => o.claimIds.includes(claim.id));
    const directSupports = related.filter((o) => o.status === 'supports' && DECISIVE_STRENGTHS.has(o.strength) && o.observer !== 'ci-result');
    const contradictions = related.filter((o) => o.status === 'contradicts' && DECISIVE_STRENGTHS.has(o.strength));
    let verdict = 'UNSUPPORTED', reason = 'No independent check established this claim.';
    if (directSupports.length && contradictions.length) { verdict = 'NEEDS_HUMAN_REVIEW'; reason = 'Independent checks conflict.'; }
    else if (contradictions.length) { verdict = 'CONTRADICTED'; reason = 'Direct scoped evidence contradicts the claim.'; }
    else if (directSupports.length) { verdict = 'VERIFIED'; reason = 'Independent direct evidence supports the claim.'; }
    return Object.freeze({ id: stableId(`${claim.id}\0${policyDigest}`, 'd'), claimId: claim.id, verdict, reason, observationHashes: related.map((o) => o.hash), policyDigest });
  });
  const counts = { verified: 0, contradicted: 0, unsupported: 0, humanReview: 0 };
  for (const d of decisions) { if (d.verdict === 'VERIFIED') counts.verified++; else if (d.verdict === 'CONTRADICTED') counts.contradicted++; else if (d.verdict === 'NEEDS_HUMAN_REVIEW') counts.humanReview++; else counts.unsupported++; }
  const headline = counts.contradicted ? 'CONTRADICTED' : counts.unsupported || counts.humanReview ? 'INCOMPLETE' : decisions.length ? 'VERIFIED' : 'NO_CLAIMS';
  return Object.freeze({ schema: 'praxis.verify.decision/v1', policy: Object.freeze({ ...policy }), policyDigest, decisions: Object.freeze(decisions), summary: Object.freeze({ headline, total: decisions.length, ...counts }) });
}
