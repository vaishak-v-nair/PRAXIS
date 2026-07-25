// One receipt, recorded once — the single path every surface shares.
//
// The MCP tool (praxis_receipt), the SessionEnd hook (capture), and the CLI
// (`praxis receipt`) all call recordReceipt, so a session is receipted
// identically no matter who triggers it. The intelligence lives here; the
// surfaces are thin. This is the platform rule in code: remove any one surface
// and the capability is untouched.
//
// Evidence is ALWAYS recorded (deterministic, free). The judge runs only when
// asked — it costs a model call and MUST NOT fire silently in a hook. So the
// default (verify:false) is honest, silent, and zero-cost; a receipt with no
// judge reads UNVERIFIED, never a fabricated verdict.

import { collectEvidence, collectClaimProse } from './collectors.js';
import { open, append, finalize, receiptId } from './store.js';

/** Roll a per-claim verdict list up into one honest headline. */
export function summarizeVerdicts(verdicts) {
  const claims = (verdicts || []).filter((v) => v.verdict !== 'NOT_A_CLAIM');
  const t = claims.filter((v) => v.verdict === 'TRUE');
  const f = claims.filter((v) => v.verdict === 'FALSE');
  const u = claims.filter((v) => v.verdict === 'UNVERIFIABLE');
  let headline;
  if (f.length) headline = 'CLAIMS_FAILED';
  else if (claims.length && t.length === claims.length) headline = 'VERIFIED';
  else if (claims.length) headline = 'PARTIAL';
  else headline = 'NO_CLAIMS';
  return { headline, total: claims.length, true: t.length, false: f.length, unverifiable: u.length, failed: f.map((v) => v.claim) };
}

/**
 * Right-size the judge's INPUT for very large sessions. The sealed record keeps
 * every command untruncated (iron rule 3 protects the RECORD); the judge only
 * needs a window it can actually reason over inside its time budget. Honesty is
 * preserved by construction: the trimmed view says exactly what was omitted,
 * and the judge's absence rule (UNVERIFIABLE, never FALSE) already covers
 * anything outside the window. Proven necessity: a 35-block real session blew
 * the judge's timeout; the claim-signal subset verified correctly in budget.
 *
 * Recency wins because end-of-session claims ("done", "all tests pass") are
 * about recent work — the newest evidence is the relevant evidence.
 */
export function rightSizeForJudge(evidence, claimProse, { maxCommands = 60, maxActivity = 15, maxFiles = 200, maxClaimBlocks = 10 } = {}) {
  const omitted = Math.max(0, (evidence.commands_run || []).length - maxCommands);
  const view = {
    ...evidence,
    commands_run: (evidence.commands_run || []).slice(-maxCommands),
    git_activity: (evidence.git_activity || []).slice(-maxActivity),
    test_activity: (evidence.test_activity || []).slice(-maxActivity),
    build_activity: (evidence.build_activity || []).slice(-maxActivity),
    files_edited: (evidence.files_edited || []).slice(0, maxFiles),
    completeness_note:
      (evidence.completeness_note || '') +
      (omitted > 0
        ? ` JUDGE VIEW: only the most recent ${maxCommands} of ${(evidence.commands_run || []).length} commands are shown here (the sealed record holds all of them, untruncated). A command absent from this view may still have run — absence remains UNVERIFIABLE, never FALSE.`
        : ''),
  };
  return { evidence: view, claimProse: (claimProse || []).slice(-maxClaimBlocks), omittedCommands: omitted };
}

/**
 * Record (and seal) one session's receipt.
 *
 * @param {string} receiptsDir  .praxis/receipts
 * @param {{text:string, sessionId:string}} tr  the session transcript
 * @param {{project?:string, now?:string, verify?:boolean, judge?:Function}} opts
 * @returns {Promise<{id:string, evidence:object, verdict:string, verified:boolean,
 *   sealed:boolean, summary?:object, verdicts?:Array, judgeError?:string}>}
 */
export async function recordReceipt(receiptsDir, tr, { project = null, now = null, verify = false, judge } = {}) {
  const evidence = collectEvidence(tr.text);
  const id = receiptId(tr.sessionId);

  // open is idempotent (same session -> same id); if the latest version is
  // already sealed, a NEW version is started — a re-run never mutates history.
  open(receiptsDir, { sessionId: tr.sessionId, project, now });
  append(receiptsDir, id, evidence);

  // evidence-only: seal immediately so the receipt is tamper-evident the moment
  // the session ends, with zero model calls. The judge stays opt-in.
  if (!verify || typeof judge !== 'function') {
    finalize(receiptsDir, id, { verdict: 'UNVERIFIED', claims: [], now });
    return { id, evidence, verdict: 'UNVERIFIED', verified: false, sealed: true, judgeError: verify ? 'no judge configured' : undefined };
  }

  const claimProse = collectClaimProse(tr.text, { claimSignalOnly: true });
  // the RECORD keeps everything; the judge reasons over a right-sized window
  const view = rightSizeForJudge(evidence, claimProse);
  const j = await judge({ evidence: view.evidence, claimProse: view.claimProse });
  if (!j.ok) {
    // the judge was unavailable — seal honest, never invent a verdict
    finalize(receiptsDir, id, { verdict: 'UNVERIFIED', claims: [], now });
    return { id, evidence, verdict: 'UNVERIFIED', verified: false, sealed: true, judgeError: j.reason };
  }

  const summary = summarizeVerdicts(j.verdicts);
  finalize(receiptsDir, id, { verdict: summary.headline, claims: j.verdicts, now });
  return { id, evidence, verdict: summary.headline, verified: true, sealed: true, summary, verdicts: j.verdicts };
}
