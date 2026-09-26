import { receiptFromFragment, receiptToFragment, verifyPublicReceipt } from './verify.js';
export { canonicalJson, receiptFromFragment, receiptToFragment, verifyPublicReceipt } from './verify.js';

const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;

function el(tag, className, text) {
  const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
}

function render(receipt, verification) {
  const output = document.querySelector('#receipt'); output.replaceChildren();
  const hero = el('section', 'receipt-head');
  hero.append(el('p', `signature ${verification.ok ? 'valid' : 'invalid'}`, verification.ok ? 'ED25519 SIGNATURE VALID' : `SIGNATURE ${String(verification.reason || 'INVALID').toUpperCase()}`));
  hero.append(el('h2', '', receipt.task?.description || 'Untitled verification task'));
  hero.append(el('p', 'range', `${receipt.commitRange?.base || 'root'} → ${receipt.commitRange?.head || 'unknown'}`));
  output.append(hero);
  const list = el('section', 'claims'); list.append(el('h3', '', 'Claim verdicts'));
  for (const decision of receipt.verdicts || []) {
    const claim = (receipt.claims || []).find((item) => item.id === decision.claimId);
    const article = el('article', 'claim');
    article.append(el('span', `badge ${String(decision.verdict || '').toLowerCase()}`, decision.verdict || 'UNKNOWN'));
    article.append(el('h4', '', claim?.sourceText || decision.claimId || 'Unknown claim'));
    article.append(el('p', '', decision.reason || 'No reason recorded.'));
    list.append(article);
  }
  output.append(list);
  const meta = el('dl', 'meta');
  for (const [term, value] of [['Receipt', receipt.id], ['Verifier', `${receipt.verifier?.name || 'unknown'} ${receipt.verifier?.version || ''}`], ['Timestamp', receipt.timestamp], ['Evidence records', String(receipt.evidence?.length || 0)], ['Record complete', receipt.complete ? 'Yes' : 'No']]) {
    meta.append(el('dt', '', term), el('dd', '', value || 'Unknown'));
  }
  output.append(meta); output.hidden = false; document.querySelector('#empty').hidden = true;
}

async function openReceipt(receipt) {
  const verification = await verifyPublicReceipt(receipt); render(receipt, verification);
  document.querySelector('#share').onclick = async () => {
    const url = `${location.origin}${location.pathname}#${receiptToFragment(receipt)}`;
    await navigator.clipboard.writeText(url); document.querySelector('#share').textContent = 'Link copied';
  };
  document.querySelector('#share').hidden = false;
}

if (typeof document !== 'undefined') {
  document.querySelector('#file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0]; if (!file || file.size > MAX_RECEIPT_BYTES) return;
    try { await openReceipt(JSON.parse(await file.text())); } catch { document.querySelector('#error').textContent = 'That file is not a valid PRAXIS Verify receipt.'; }
  });
  try { const embedded = receiptFromFragment(location.hash); if (embedded) await openReceipt(embedded); } catch { document.querySelector('#error').textContent = 'The receipt link is malformed.'; }
}
