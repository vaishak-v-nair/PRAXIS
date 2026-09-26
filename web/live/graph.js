const SVG_NS = 'http://www.w3.org/2000/svg';

function shorten(value, limit = 34) {
  const text = String(value || '');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function createGraphModel() {
  const nodes = new Map();
  const edges = new Map();
  const claimOrder = [];

  function addNode(node) { nodes.set(node.id, Object.freeze({ ...node })); }
  function addEdge(from, to, kind) { edges.set(`${from}->${to}`, Object.freeze({ from, to, kind })); }
  function reset() { nodes.clear(); edges.clear(); claimOrder.length = 0; }

  function consume(event) {
    if (event?.type !== 'stage' || event.state !== 'complete') return snapshot();
    if (event.stage === 'extractor') {
      reset();
      for (const [row, claim] of (event.claims || []).entries()) {
        claimOrder.push(claim.id);
        addNode({ id: `claim:${claim.id}`, claimId: claim.id, lane: 'claim', row, kind: 'claim', label: claim.text, detail: 'ATOMIC CLAIM' });
      }
    }
    if (event.stage === 'retriever') {
      let contextRow = claimOrder.length;
      for (const [index, item] of (event.evidence?.snippets || []).entries()) {
        const row = item.claimId ? Math.max(0, claimOrder.indexOf(item.claimId)) : contextRow++;
        const id = `evidence:${item.claimId || 'context'}:${index}`;
        addNode({ id, claimId: item.claimId, lane: 'evidence', row, kind: `evidence-${item.status}`, label: item.path, detail: item.status === 'matched' ? 'MATCHED DIFF' : item.status === 'missing' ? 'MISSING FROM DIFF' : 'ACTUAL CHANGE' });
        if (item.claimId) addEdge(`claim:${item.claimId}`, id, item.status);
        else {
          const commitId = 'commit:bound';
          if (!nodes.has(commitId)) addNode({ id: commitId, claimId: null, lane: 'claim', row, kind: 'commit', label: shorten(event.evidence.head, 12), detail: 'BOUND COMMIT' });
          addEdge(commitId, id, 'context');
        }
      }
    }
    if (event.stage === 'judge') {
      for (const decision of event.verdicts || []) {
        const row = Math.max(0, claimOrder.indexOf(decision.claimId));
        const id = `verdict:${decision.claimId}`;
        addNode({ id, claimId: decision.claimId, lane: 'verdict', row, kind: `verdict-${decision.verdict.toLowerCase()}`, label: decision.verdict, detail: 'FINAL VERDICT' });
        const evidence = [...nodes.values()].filter((node) => node.lane === 'evidence' && node.claimId === decision.claimId);
        if (evidence.length) for (const node of evidence) addEdge(node.id, id, decision.verdict.toLowerCase());
        else addEdge(`claim:${decision.claimId}`, id, decision.verdict.toLowerCase());
      }
    }
    return snapshot();
  }

  function snapshot() {
    return Object.freeze({ nodes: Object.freeze([...nodes.values()]), edges: Object.freeze([...edges.values()]), claimCount: claimOrder.length });
  }

  return Object.freeze({ consume, reset, snapshot });
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function position(node) {
  return { x: { claim: 36, evidence: 376, verdict: 716 }[node.lane], y: 34 + node.row * 116, width: 250, height: 76 };
}

function render(svg, model) {
  svg.replaceChildren();
  const maxRow = Math.max(0, ...model.nodes.map((node) => node.row));
  svg.setAttribute('viewBox', `0 0 1002 ${Math.max(150, 132 + maxRow * 116)}`);
  const defs = svgElement('defs');
  const marker = svgElement('marker', { id: 'graph-arrow', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse' });
  marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z' })); defs.append(marker); svg.append(defs);

  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const edgeLayer = svgElement('g', { class: 'graph-edges' });
  for (const edge of model.edges) {
    const fromNode = byId.get(edge.from), toNode = byId.get(edge.to);
    if (!fromNode || !toNode) continue;
    const from = position(fromNode), to = position(toNode);
    const x1 = from.x + from.width, y1 = from.y + from.height / 2, x2 = to.x, y2 = to.y + to.height / 2;
    edgeLayer.append(svgElement('path', { class: `graph-edge ${edge.kind}`, d: `M ${x1} ${y1} C ${x1 + 48} ${y1}, ${x2 - 48} ${y2}, ${x2} ${y2}`, 'marker-end': 'url(#graph-arrow)' }));
  }
  svg.append(edgeLayer);

  const nodeLayer = svgElement('g', { class: 'graph-nodes' });
  for (const node of model.nodes) {
    const box = position(node);
    const group = svgElement('g', { class: `graph-node ${node.kind}`, transform: `translate(${box.x} ${box.y})`, role: 'img', 'aria-label': `${node.detail}: ${node.label}` });
    group.append(svgElement('rect', { width: box.width, height: box.height, rx: '4' }));
    const detail = svgElement('text', { x: '16', y: '23', class: 'graph-detail' }); detail.textContent = node.detail;
    const label = svgElement('text', { x: '16', y: '51', class: 'graph-label' }); label.textContent = shorten(node.label);
    group.append(detail, label); nodeLayer.append(group);
  }
  svg.append(nodeLayer);
}

export function createLiveGraph(svg, meta) {
  const model = createGraphModel();
  return Object.freeze({
    reset() { model.reset(); render(svg, model.snapshot()); if (meta) meta.textContent = 'Awaiting claims'; },
    consume(event) {
      const state = model.consume(event); render(svg, state);
      if (meta) meta.textContent = `${state.nodes.length} nodes · ${state.edges.length} links`;
      return state;
    },
    snapshot: model.snapshot,
  });
}
