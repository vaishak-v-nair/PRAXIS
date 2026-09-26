import { VerifyInputError, deepFreeze } from './schema.js';

export function bindClaimsToTarget(claims, target) {
  const commitRange = deepFreeze({ base: target.base, head: target.head, baseTree: target.baseTree, headTree: target.headTree });
  return deepFreeze(claims.map((claim) => deepFreeze({ ...claim, commitRange })));
}

export function assertClaimsBound(claims) {
  for (const claim of claims) {
    if (!claim.commitRange?.head || !Object.hasOwn(claim.commitRange, 'base')) {
      throw new VerifyInputError('unbound-claim', `Claim ${claim.id} has no exact commit range.`);
    }
  }
  return claims;
}
