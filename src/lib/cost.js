// The money layer: transcripts already carry exact token usage per model —
// nobody turns that into a number a human budgets with. We do, honestly:
// API-EQUIVALENT cost (what this work would cost at published API rates).
// Subscription users see the value they extracted; API users see the bill.
// Rates are DEFAULTS, overridable via .praxis/config.json { pricing: {...} }.

// USD per million tokens: [input, output, cacheWrite, cacheRead]
export const DEFAULT_PRICING = {
  opus: [15, 75, 18.75, 1.5],
  sonnet: [3, 15, 3.75, 0.3],
  haiku: [0.8, 4, 1, 0.08],
  fable: [15, 75, 18.75, 1.5], // priced as opus-tier until published
  default: [3, 15, 3.75, 0.3],
};

export function rateFor(model, pricing = DEFAULT_PRICING) {
  const m = String(model || '').toLowerCase();
  for (const key of Object.keys(pricing)) {
    if (key !== 'default' && m.includes(key)) return pricing[key];
  }
  return pricing.default || DEFAULT_PRICING.default;
}

/** One pass: usage per model. Counts every assistant message's real tokens. */
export function scanUsage(text) {
  const byModel = {};
  let firstTs = null;
  let lastTs = null;
  for (const line of String(text || '').split('\n')) {
    if (!line.includes('"usage":{')) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e || e.isSidechain || e.type !== 'assistant' || !e.message || !e.message.usage) continue;
    const u = e.message.usage;
    const model = e.message.model || 'unknown';
    const b = (byModel[model] ||= { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0 });
    b.input += u.input_tokens || 0;
    b.output += u.output_tokens || 0;
    b.cacheWrite += u.cache_creation_input_tokens || 0;
    b.cacheRead += u.cache_read_input_tokens || 0;
    b.messages++;
    if (typeof e.timestamp === 'string') {
      if (!firstTs) firstTs = e.timestamp;
      lastTs = e.timestamp;
    }
  }
  return { byModel, firstTs, lastTs };
}

/** Dollars from usage. Returns { total, perModel: [{model, cost, tokens}] }. */
export function priceUsage(byModel, pricing = DEFAULT_PRICING) {
  const perModel = [];
  let total = 0;
  for (const [model, b] of Object.entries(byModel || {})) {
    const [pin, pout, pw, pr] = rateFor(model, pricing);
    const cost =
      (b.input / 1e6) * pin + (b.output / 1e6) * pout + (b.cacheWrite / 1e6) * pw + (b.cacheRead / 1e6) * pr;
    const tokens = b.input + b.output + b.cacheWrite + b.cacheRead;
    perModel.push({ model, cost, tokens, messages: b.messages });
    total += cost;
  }
  perModel.sort((a, b) => b.cost - a.cost);
  return { total, perModel };
}

export const usd = (n) => (n >= 100 ? '$' + n.toFixed(0) : n >= 1 ? '$' + n.toFixed(2) : '$' + n.toFixed(3));

/**
 * Slop-risk score for a commit: 0-100 + plain-English reasons. Pure heuristic
 * over locally-observable signals — never a verdict, always a triage aid.
 */
export function slopScore(sig = {}) {
  const reasons = [];
  let score = 0;
  const add = (pts, why) => {
    score += pts;
    reasons.push(`+${pts} ${why}`);
  };
  const churn = (sig.insertions || 0) + (sig.deletions || 0);
  if (churn > 800) add(25, `very large change (${churn} lines)`);
  else if (churn > 300) add(15, `large change (${churn} lines)`);
  if ((sig.filesChanged || 0) > 10) add(15, `touches ${sig.filesChanged} files`);
  if (sig.srcTouched && !sig.testsTouched) add(20, 'source changed, no tests touched');
  if (sig.contextPct >= 88) add(20, `session was ${sig.contextPct}% full at commit (degradation zone)`);
  else if (sig.contextPct >= 75) add(10, `session was ${sig.contextPct}% full at commit`);
  if (sig.hasTrace === false) add(10, 'no AI context note on the commit (praxis trace off?)');
  if (sig.autonomousWindow) add(10, 'no direct human ask in the work window');
  score = Math.min(100, score);
  const level = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  return { score, level, reasons };
}
