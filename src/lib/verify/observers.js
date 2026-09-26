import crypto from 'node:crypto';
import { diffEvidence, inspectFalseSuccess } from './regen-static.js';
function norm(value) { return String(value || '').replace(/\\/g, '/').replace(/^\.\//, ''); }
function digest(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
export function runStaticObservers(target, claims, ledger) {
  const changed = new Set(target.changedPaths.map(norm));
  for (const claim of claims) {
    const kind = claim.scope.kind || 'generic';
    const paths = (claim.scope.paths || (claim.scope.path ? [claim.scope.path] : [])).map(norm);
    if (paths.length) {
      const matching = paths.filter((p) => changed.has(p));
      const details = paths.map((p) => { const e = diffEvidence(target, p); return { path: p, touched: e.touched, hunks: e.hunks, diffDigest: digest(e.digestInput) }; });
      const symbols = Array.isArray(claim.scope.symbols) ? claim.scope.symbols.map(String) : [];
      const symbolMatches = symbols.filter((symbol) => details.some((item) => item.hunks.some((hunk) => hunk.includes(symbol))));
      const allPaths = matching.length === paths.length, allSymbols = !symbols.length || symbolMatches.length === symbols.length;
      ledger.append({ observer: 'regen-static-diff', version: 1, claimIds: [claim.id], applicability: 'committed diff paths and hunk symbols', strength: kind === 'file-change' ? 'direct' : 'supporting', status: allPaths && allSymbols ? 'supports' : 'contradicts', details: { expectedPaths: paths, changedPaths: matching, missingPaths: paths.filter((p) => !changed.has(p)), expectedSymbols: symbols, matchedSymbols: symbolMatches, files: details } });
      const findings = inspectFalseSuccess(target, paths);
      ledger.append({ observer: 'regen-false-success', version: 1, claimIds: [claim.id], applicability: 'production mock and constant-success patterns ported from ReGen reality.py', strength: 'direct', status: findings.length ? 'contradicts' : 'not-observed', details: { checkedPaths: paths, findings } });
      continue;
    }
    if (kind === 'tests-pass' || kind === 'build-pass' || kind === 'ci-pass') ledger.append({ observer: 'static-command-declaration', version: 1, claimIds: [claim.id], applicability: 'static mode cannot observe command outcomes', strength: 'none', status: 'not-observed', details: { required: kind } });
    else ledger.append({ observer: 'static-generic', version: 1, claimIds: [claim.id], applicability: 'claim names no deterministic path or symbol', strength: 'none', status: 'not-applicable', details: {} });
  }
  return ledger.entries();
}
