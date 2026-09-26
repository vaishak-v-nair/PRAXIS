import { bold, sage, rose, amber, grey, claimRow } from '../ui.js';
const LABEL = { VERIFIED: 'VERIFIED', CONTRADICTED: 'CONTRADICTED', UNSUPPORTED: 'UNSUPPORTED', NEEDS_HUMAN_REVIEW: 'HUMAN REVIEW' };
export function renderVerify(result) {
  const lines = ['', `  ${bold('PRAXIS Verify')}  ${grey(result.id)}`, `  task     ${result.task.description}`, `  range    ${result.target.base || '(root)'}..${result.target.head}`, ''];
  for (const decision of result.decision.decisions) { const claim = result.claims.find((item) => item.id === decision.claimId), paint = decision.verdict === 'VERIFIED' ? sage : decision.verdict === 'CONTRADICTED' ? rose : amber; lines.push(...claimRow(LABEL[decision.verdict], claim?.sourceText || decision.claimId, decision.reason, paint).map((line) => '  ' + line)); }
  lines.push('', `  receipt  ${result.artifact.file}`, `  signature Ed25519 ${result.artifact.signatureVerified ? 'verified' : 'failed'}`, ''); return lines.join('\n');
}
export function exitCodeFor(result) { if (result.decision.summary.contradicted) return 1; if (!result.complete || result.decision.summary.unsupported || result.decision.summary.humanReview) return 3; return 0; }
