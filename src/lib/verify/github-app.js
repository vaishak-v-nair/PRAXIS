import crypto from 'node:crypto';

const ACTIONS = new Set(['opened', 'reopened', 'synchronize', 'ready_for_review']);

export function verifyWebhookSignature(rawBody, secret, signature) {
  if (!secret || !signature || !signature.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const left = Buffer.from(expected), right = Buffer.from(signature);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function identifier(value, label) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(text)) throw new Error(`Invalid ${label} in GitHub payload.`);
  return text;
}

function sha(value, label) {
  const text = String(value || '');
  if (!/^[a-f0-9]{40,64}$/i.test(text)) throw new Error(`Invalid ${label} in GitHub payload.`);
  return text;
}

export function parsePullRequestDelivery(event, rawBody) {
  if (event === 'ping') return { kind: 'ping' };
  if (event !== 'pull_request') return { kind: 'ignored', reason: 'unsupported-event' };
  let payload;
  try { payload = JSON.parse(rawBody.toString('utf8')); } catch { throw new Error('Webhook body is not valid JSON.'); }
  if (!ACTIONS.has(payload?.action)) return { kind: 'ignored', reason: 'unsupported-action' };
  const pr = payload.pull_request, repository = payload.repository;
  if (!pr || !repository || !payload.installation?.id) throw new Error('Incomplete pull_request webhook payload.');
  const owner = identifier(repository.owner?.login, 'repository owner');
  const repo = identifier(repository.name, 'repository name');
  const number = Number(pr.number);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Invalid pull request number.');
  const cloneUrl = String(repository.clone_url || '');
  const expected = `https://github.com/${owner}/${repo}.git`;
  if (cloneUrl.toLowerCase() !== expected.toLowerCase()) throw new Error('Unexpected repository clone URL.');
  return {
    kind: 'pull_request', action: payload.action, owner, repo, number,
    repositoryId: Number(repository.id), installationId: Number(payload.installation.id), cloneUrl,
    base: sha(pr.base?.sha, 'base SHA'), head: sha(pr.head?.sha, 'head SHA'),
    baseRef: identifier(pr.base?.ref, 'base ref'),
    title: String(pr.title || '').slice(0, 8000), body: String(pr.body || '').slice(0, 64 * 1024),
  };
}

export function summarizeResult(result) {
  const decisions = result?.decision?.decisions || [];
  const counts = { VERIFIED: 0, CONTRADICTED: 0, UNSUPPORTED: 0, NEEDS_HUMAN_REVIEW: 0 };
  for (const row of decisions) if (Object.hasOwn(counts, row.verdict)) counts[row.verdict] += 1;
  return { decisions, counts, complete: result?.complete === true };
}

export function checkConclusion(result, mode = 'advisory') {
  if (mode !== 'blocking') return 'neutral';
  const { counts, complete } = summarizeResult(result);
  if (!complete || counts.CONTRADICTED || counts.UNSUPPORTED || counts.NEEDS_HUMAN_REVIEW) return 'failure';
  return 'success';
}

function safeText(value, max = 1000) {
  return String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
}

export function renderGitHubResult(result, { mode = 'advisory', receiptUrl = null } = {}) {
  const { decisions, counts, complete } = summarizeResult(result);
  const rows = decisions.map((decision) => {
    const claim = result.claims?.find((item) => item.id === decision.claimId);
    return `| ${decision.verdict} | ${safeText(claim?.sourceText || decision.claimId, 500).replace(/\|/g, '\\|')} | ${safeText(decision.reason, 500).replace(/\|/g, '\\|')} |`;
  });
  const modeText = mode === 'blocking' ? 'Blocking mode is enabled from the protected base revision.' : 'Advisory mode: this result does not block merging.';
  const receipt = receiptUrl ? `\n\n[Open signed receipt](${receiptUrl})` : '';
  return `## PRAXIS Verify\n\n${modeText}\n\n**${counts.VERIFIED} verified · ${counts.CONTRADICTED} contradicted · ${counts.UNSUPPORTED} unsupported · ${counts.NEEDS_HUMAN_REVIEW} human review**\n\n| Verdict | Claim | Reason |\n|---|---|---|\n${rows.join('\n') || '| UNSUPPORTED | No atomic claims were extracted. | Add a concrete completion report to the pull request body. |'}\n\nCommit range: \`${result?.target?.base || 'root'}..${result?.target?.head || 'unknown'}\`  \nEvidence record complete: **${complete ? 'yes' : 'no'}**${receipt}`;
}

export async function processPullRequest(delivery, { api, verifyPullRequest, deliveryId, receiptUrlFor = null }) {
  const config = await api.baseConfig(delivery.owner, delivery.repo, delivery.base);
  const check = await api.createCheck(delivery.owner, delivery.repo, {
    name: 'PRAXIS Verify', head_sha: delivery.head, status: 'in_progress',
    started_at: new Date().toISOString(), external_id: deliveryId,
    output: { title: 'Checking agent completion claims', summary: 'Binding claims to this pull request and collecting independent evidence.' },
  });
  try {
    const result = await verifyPullRequest(delivery);
    const receiptUrl = receiptUrlFor ? receiptUrlFor(result) : null;
    const body = renderGitHubResult(result, { mode: config.mode, receiptUrl });
    await api.updateCheck(delivery.owner, delivery.repo, check.id, {
      status: 'completed', conclusion: checkConclusion(result, config.mode), completed_at: new Date().toISOString(),
      output: { title: config.mode === 'blocking' ? 'PRAXIS Verify gate' : 'PRAXIS Verify advisory', summary: body.slice(0, 65535) },
    });
    await api.upsertComment(delivery.owner, delivery.repo, delivery.number, body);
    return { handled: true, mode: config.mode, result, checkId: check.id };
  } catch (error) {
    const summary = `Verification could not complete: ${safeText(error.message, 1000)}`;
    await api.updateCheck(delivery.owner, delivery.repo, check.id, {
      status: 'completed', conclusion: config.mode === 'blocking' ? 'failure' : 'neutral', completed_at: new Date().toISOString(),
      output: { title: 'PRAXIS Verify could not complete', summary },
    });
    await api.upsertComment(delivery.owner, delivery.repo, delivery.number, `## PRAXIS Verify\n\n${summary}\n\nNo verified result or receipt was issued.`);
    throw error;
  }
}
