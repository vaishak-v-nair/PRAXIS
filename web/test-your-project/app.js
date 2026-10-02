import { agentPrompt, summaryOf, validReport } from './report.js';
const byId = id => document.getElementById(id);
let files = [], report = null, worker = null, deadline = null, shown = 20;
const selected = new Set();
function element(tag, text = '', className = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function finish() { worker?.terminate(); worker = null; clearTimeout(deadline); byId('run').disabled = !files.length; byId('cancel').hidden = true; for (const id of ['choose-folder', 'choose-files', 'clear']) byId(id).disabled = false; }
function clearReview() {
  finish(); report = null; selected.clear(); files = []; byId('results').hidden = true;
  for (const id of ['prompt', 'goal', 'folder', 'files']) byId(id).value = '';
  byId('selection-name').textContent = 'Choose your project folder'; byId('selection-detail').textContent = 'Dependencies, credentials, private memory, generated files, and files above 2 MiB are excluded before reading.';
  byId('progress').textContent = 'Select a folder or files to start.'; byId('run').disabled = true; byId('error').hidden = true; byId('copy-status').textContent = '';
  for (const id of ['findings', 'coverage', 'commands', 'metrics']) byId(id).replaceChildren();
  for (const id of ['results-title', 'result-summary', 'finding-count']) byId(id).textContent = '';
}
function updatePrompt() { byId('prompt').value = agentPrompt(report, [...selected]); byId('copy-status').textContent = ''; }
function renderFindings() {
  byId('findings').replaceChildren();
  const order = {critical:0,high:1,medium:2,low:3,info:4};
  const findings = [...report.findings].sort((a, b) => (order[a.severity] ?? 5) - (order[b.severity] ?? 5));
  if (!findings.length) byId('findings').append(element('p', 'No finding matched the completed source checks. Review the coverage limits before deciding what to run next.', 'empty'));
  for (const finding of findings.slice(0, shown)) {
    const row = element('article', '', 'finding'), label = element('label', '', 'finding-select'), input = document.createElement('input');
    input.type = 'checkbox'; input.checked = selected.has(finding.id); input.setAttribute('aria-label', 'Include ' + finding.title + ' in agent prompt');
    input.onchange = () => { input.checked ? selected.add(finding.id) : selected.delete(finding.id); updatePrompt(); };
    label.append(input, element('span', finding.title)); row.append(label);
    const meta = element('div', '', 'finding-meta'); meta.append(element('span', finding.severity, 'badge ' + (['high','critical'].includes(finding.severity) ? 'negative' : finding.severity === 'medium' ? 'warning' : 'neutral')), element('code', (finding.location?.file || 'Project-wide') + (finding.location?.line ? ':' + finding.location.line : '')), element('span', finding.confidence, 'muted'));
    row.append(meta, element('p', finding.description, 'muted'));
    const details = element('details', '', 'evidence'); details.append(element('summary', 'Inspect evidence and next step'), element('pre', finding.evidence || 'No source excerpt captured.'));
    details.append(element('h4', 'Potential impact'), element('p', finding.why), element('h4', 'Recommended investigation'), element('p', finding.fix || 'Establish the contract and reproduce before editing.'));
    row.append(details); byId('findings').append(row);
  }
  byId('more').hidden = shown >= findings.length;
  byId('more').textContent = `Show next ${Math.min(20, findings.length - shown)} of ${findings.length} findings`;
}
function render(result) {
  if (!validReport(result)) throw new Error('Unsupported scanner result. No readiness verdict has been inferred.');
  report = result; shown = 20; selected.clear(); result.findings.forEach(item => selected.add(item.id));
  const summary = summaryOf(result); byId('results-title').textContent = summary.title; byId('result-summary').textContent = summary.detail;
  byId('finding-count').textContent = String(result.findings.length); byId('metrics').replaceChildren();
  for (const [label, value, detail] of [['Source files', result.files_scanned, result.languages.join(' / ') || 'Text files'], ['Source findings', result.findings.length, 'Matches requiring context'], ['Excluded files', result.selection.skipped_files, 'Not read or reviewed'], ['Runtime checks', 'Not run', 'Use local PRAXIS']]) {
    const metric = element('article', '', 'panel metric'); metric.append(element('span', label, 'muted'), element('strong', String(value)), element('span', detail, 'fine-print')); byId('metrics').append(metric);
  }
  byId('coverage').replaceChildren();
  for (const check of result.coverage) {
    const row = element('article', '', 'coverage-row'), header = element('div');
    header.append(element('h4', check.name), element('span', check.status === 'passed' ? 'Completed' : check.status, 'badge ' + (check.status === 'limited' ? 'warning' : 'neutral')));
    row.append(header, element('p', check.detail, 'muted')); byId('coverage').append(row);
  }
  const commands = byId('commands'); commands.replaceChildren(element('h4', 'Discovered commands · not executed'));
  for (const argv of result.commands) commands.append(element('code', JSON.stringify(argv)));
  if (!result.commands.length) commands.append(element('p', 'No supported command was discovered in the selected files.', 'muted'));
  commands.append(element('p', `Source snapshot: ${result.snapshot}`, 'snapshot'));
  renderFindings(); updatePrompt(); byId('results').hidden = false; byId('results').focus();
}
for (const kind of ['folder', 'files']) {
  byId('choose-' + kind).onclick = () => byId(kind).click();
  byId(kind).onchange = event => {
    finish(); report = null; byId('results').hidden = true; byId('prompt').value = ''; selected.clear(); byId('copy-status').textContent = '';
    files = Array.from(event.target.files || []); byId('error').hidden = true; byId('run').disabled = !files.length;
    byId('selection-name').textContent = files[0]?.webkitRelativePath.split('/')[0] || (files.length ? 'Selected source files' : 'Choose your project folder');
    byId('selection-detail').textContent = `${files.length.toLocaleString()} files selected. Privacy and size exclusions are applied before source inspection.`;
    byId('progress').textContent = files.length ? 'Ready for private source inspection.' : 'Select a folder or files to start.';
  };
}
byId('run').onclick = () => {
  if (!files.length || worker) return;
  byId('error').hidden = true; byId('results').hidden = true; byId('prompt').value = ''; byId('run').disabled = true; byId('cancel').hidden = false;
  for (const id of ['choose-folder', 'choose-files', 'clear']) byId(id).disabled = true;
  try {
    worker = new Worker(new URL('worker.js', import.meta.url), { type: 'module' });
    deadline = setTimeout(() => { finish(); byId('error').hidden = false; byId('error').textContent = 'Inspection exceeded two minutes and was stopped. No result was produced. Try fewer files or use local PRAXIS.'; byId('progress').textContent = 'Inspection stopped.'; }, 120000);
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') byId('progress').textContent = data.message;
      else {
        finish();
        if (data.type === 'complete') { try { render(data.result); byId('progress').textContent = 'Source inspection complete. Runtime remains untested.'; } catch (error) { byId('error').textContent = error.message; byId('error').hidden = false; } }
        else { byId('error').textContent = data.message || 'Inspection did not complete. No result was produced.'; byId('error').hidden = false; byId('progress').textContent = 'Inspection unavailable.'; }
      }
    };
    worker.onerror = event => { event.preventDefault(); finish(); byId('error').hidden = false; byId('error').textContent = 'The analysis worker could not load. Refresh or use local PRAXIS. No result was produced.'; byId('progress').textContent = 'Inspection unavailable.'; };
    worker.postMessage({ files, goal: byId('goal').value });
  } catch { finish(); byId('error').hidden = false; byId('error').textContent = 'This browser cannot start private WebAssembly inspection. Use a recent browser or local PRAXIS.'; }
};
byId('cancel').onclick = () => { finish(); byId('progress').textContent = 'Inspection stopped. No result was produced.'; };
byId('clear').onclick = clearReview;
byId('more').onclick = () => { shown += 20; renderFindings(); };
byId('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(byId('prompt').value); byId('copy-status').textContent = 'Agent prompt copied. Review and confirm the plan in your agent.'; }
  catch { byId('prompt').focus(); byId('prompt').select(); byId('copy-status').textContent = 'Clipboard access was blocked. The prompt is selected; copy it manually.'; }
};
byId('download').onclick = () => {
  const url = URL.createObjectURL(new Blob([byId('prompt').value], { type: 'text/plain;charset=utf-8' }));
  const link = element('a'); link.href = url; link.download = 'praxis-agent-brief.txt'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener('pagehide', clearReview);
