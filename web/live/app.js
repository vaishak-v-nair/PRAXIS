import { verifyPublicReceipt } from '/receipt-verify.js';
import { createLiveGraph } from '/graph.js';

const token = document.querySelector('meta[name="praxis-token"]').content;
const buttons = [...document.querySelectorAll('.scenario')];
const runButton = document.querySelector('#run');
const status = document.querySelector('#status');
const orchestrator = document.querySelector('#orchestrator');
const resultPanel = document.querySelector('#result');
const evidencePanel = document.querySelector('#evidence');
const evidenceList = document.querySelector('#evidence-list');
const graphPanel = document.querySelector('#graph');
const liveGraph = createLiveGraph(document.querySelector('#graph-canvas'), document.querySelector('#graph-meta'));
const engineCanvas = document.querySelector('#engine-canvas');
const engineState = document.querySelector('#engine-state');
const engineVisual = await import('/engine-visual.js').then((m) => m.createEngineVisual(engineCanvas, engineState)).catch(() => ({ setState(s = 'idle') { engineCanvas.dataset.state = s; engineState.textContent = s === 'idle' ? 'FLAT' : s.toUpperCase(); } }));
let selected = 'truthful';

const copy = {
  truthful: { explanation: 'The claimed implementation and test files are both present in the commit diff.' },
  'false-claim': { explanation: 'The completion report names implementation and test files, but the commit changes documentation only.' },
};

for (const button of buttons) {
  button.addEventListener('click', () => {
    if (runButton.disabled) return;
    selected = button.dataset.scenario;
    for (const item of buttons) item.classList.toggle('selected', item === button);
    resetPipeline();
  });
}

function resetPipeline() {
  for (const card of document.querySelectorAll('.agent')) {
    card.className = 'agent';
    card.querySelector('.state').textContent = 'WAITING';
    card.querySelector('.agent-output').textContent = {
      extractor: 'Awaiting report', retriever: 'Awaiting claims', verifier: 'Awaiting evidence', judge: 'Awaiting observations',
    }[card.dataset.stage];
  }
  for (const connector of document.querySelectorAll('.connector')) connector.classList.remove('active');
  status.textContent = 'Ready to run';
  orchestrator.textContent = 'LANGGRAPH · READY';
  orchestrator.dataset.mode = '';
  resultPanel.hidden = true;
  evidencePanel.hidden = true;
  evidenceList.replaceChildren();
  graphPanel.hidden = true;
  liveGraph.reset();
  document.body.dataset.verdict = '';
  engineVisual.setState('idle');
}

function summarize(event) {
  if (event.stage === 'extractor') return `${event.claims.length} atomic claim${event.claims.length === 1 ? '' : 's'} extracted`;
  if (event.stage === 'retriever') return `${event.evidence.matchedClaimPaths} matched · ${event.evidence.missingClaimPaths} missing claim paths`;
  if (event.stage === 'verifier') {
    const supported = event.observations.filter((item) => item.status === 'supports').length;
    const contradicted = event.observations.filter((item) => item.status === 'contradicts').length;
    return `${supported} supporting · ${contradicted} contradicting checks`;
  }
  if (event.stage === 'judge') return event.verdicts.map((item) => item.verdict).join(' · ');
  return 'Complete';
}

function renderEvidence(evidence) {
  evidenceList.replaceChildren();
  for (const item of evidence.snippets) {
    const article = document.createElement('article');
    article.className = `evidence-item ${item.status}`;
    const head = document.createElement('div'); head.className = 'evidence-head';
    const path = document.createElement('strong'); path.textContent = item.path;
    const state = document.createElement('span'); state.textContent = item.status === 'matched' ? 'CLAIM MATCH' : item.status === 'missing' ? 'NOT IN DIFF' : 'ACTUAL CHANGE';
    head.append(path, state);
    const relation = document.createElement('p');
    relation.textContent = item.claimText ? `Claim: ${item.claimText}` : 'Changed in the commit, but absent from the agent claim.';
    const code = document.createElement('pre'); code.textContent = item.snippet;
    article.append(head, relation, code); evidenceList.append(article);
  }
  document.querySelector('#evidence-meta').textContent = `${evidence.changedFiles.length} changed · ${evidence.matchedClaimPaths} matched · ${evidence.missingClaimPaths} missing`;
  evidencePanel.hidden = false;
}

function stageEvent(event) {
  const card = document.querySelector(`[data-stage="${event.stage}"]`);
  if (!card) return;
  const stageIndex = ['extractor', 'retriever', 'verifier', 'judge'].indexOf(event.stage);
  if (event.state === 'running') {
    card.classList.add('running');
    card.querySelector('.state').textContent = 'RUNNING';
    card.querySelector('.agent-output').textContent = 'Working…';
    status.textContent = `${card.querySelector('h2').textContent} is working`;
    engineVisual.setState('running');
    if (stageIndex > 0) document.querySelectorAll('.connector')[stageIndex - 1].classList.add('active');
  } else {
    card.classList.remove('running'); card.classList.add('complete');
    card.querySelector('.state').textContent = 'COMPLETE';
    card.querySelector('.agent-output').textContent = summarize(event);
    liveGraph.consume(event);
    if (event.stage === 'extractor') graphPanel.hidden = false;
    if (event.stage === 'retriever') renderEvidence(event.evidence);
  }
}

async function showResult(event) {
  const verification = await verifyPublicReceipt(event.receipt);
  const verdict = event.verdict;
  document.body.dataset.verdict = verdict;
  engineVisual.setState(verdict);
  document.querySelector('#verdict').textContent = verdict;
  document.querySelector('#explanation').textContent = event.scenario.explanation || copy[selected].explanation;
  const signature = document.querySelector('#signature-status');
  signature.textContent = verification.ok ? 'ED25519 SIGNATURE VALID' : `SIGNATURE ${String(verification.reason || 'INVALID').toUpperCase()}`;
  signature.closest('.signature-head').classList.toggle('invalid', !verification.ok);
  document.querySelector('#schema').textContent = event.receipt.schema;
  document.querySelector('#algorithm').textContent = event.receipt.signature.algorithm;
  document.querySelector('#receipt-id').textContent = event.receipt.id;
  document.querySelector('#receipt').textContent = JSON.stringify(event.receipt, null, 2);
  resultPanel.hidden = false;
  status.textContent = `${verdict} · receipt signature ${verification.ok ? 'valid' : 'invalid'}`;
  resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handleLine(line) {
  if (!line.trim()) return;
  const event = JSON.parse(line);
  if (event.type === 'orchestration') {
    orchestrator.textContent = event.mode === 'framework' ? `${event.engine.toUpperCase()} · ${event.nodes.length} NODES` : 'PRAXIS NATIVE · FALLBACK';
    orchestrator.dataset.mode = event.mode;
  } else if (event.type === 'stage') stageEvent(event);
  else if (event.type === 'result') await showResult(event);
  else if (event.type === 'error') throw new Error(event.message);
}

runButton.addEventListener('click', async () => {
  resetPipeline();
  runButton.disabled = true;
  runButton.querySelector('span').textContent = 'VERIFYING';
  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-praxis-token': token },
      body: JSON.stringify({ scenario: selected }),
    });
    if (!response.ok || !response.body) throw new Error(`The local verifier returned HTTP ${response.status}.`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = pending.split('\n'); pending = lines.pop() || '';
      for (const line of lines) await handleLine(line);
      if (done) break;
    }
    if (pending) await handleLine(pending);
  } catch (error) {
    status.textContent = `Run failed: ${error.message}`;
    document.body.dataset.verdict = 'ERROR';
    engineVisual.setState('ERROR');
  } finally {
    runButton.disabled = false;
    runButton.querySelector('span').textContent = 'RUN AGAIN';
  }
});

resetPipeline();
