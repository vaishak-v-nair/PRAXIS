// praxis cost — the AI bill meter. Reads the same transcripts health reads
// and answers "what did that just cost?" in API-equivalent dollars.
// `praxis cost` = newest session · `praxis cost --all` = every session here.

import fs from 'node:fs';
import path from 'node:path';
import { transcriptDir, newestTranscript } from '../lib/transcript.js';
import { projectPaths } from '../lib/paths.js';
import { scanUsage, priceUsage, usd, DEFAULT_PRICING } from '../lib/cost.js';
import { miniHeader, sage, rose, bold, grey, dim, amber } from '../lib/ui.js';

function pricingFromConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(projectPaths().configFile, 'utf8'));
    return cfg.pricing ? { ...DEFAULT_PRICING, ...cfg.pricing } : DEFAULT_PRICING;
  } catch {
    return DEFAULT_PRICING;
  }
}

export function cost(args = []) {
  const all = args.includes('--all');
  const dir = transcriptDir();
  console.log('\n  ' + miniHeader('', 'cost') + '\n');

  let files = [];
  try {
    files = all
      ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-')).map((f) => path.join(dir, f))
      : [newestTranscript(dir)].filter(Boolean);
  } catch {
    /* none */
  }
  if (!files.length) {
    console.log('  No Claude sessions found in this folder yet.\n');
    process.exitCode = 1;
    return;
  }

  const pricing = pricingFromConfig();
  const merged = {};
  let sessions = 0;
  for (const f of files) {
    let text = '';
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const { byModel } = scanUsage(text);
    if (Object.keys(byModel).length) sessions++;
    for (const [m, b] of Object.entries(byModel)) {
      const t = (merged[m] ||= { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0 });
      for (const k of Object.keys(b)) t[k] += b[k];
    }
  }

  const { total, perModel } = priceUsage(merged, pricing);
  const scope = all ? `${sessions} session${sessions === 1 ? '' : 's'} in this project` : 'this session';
  console.log('  ' + bold(usd(total)) + grey('  API-equivalent · ' + scope));
  console.log('');
  for (const m of perModel) {
    const short = m.model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
    const tok = m.tokens >= 1e6 ? (m.tokens / 1e6).toFixed(1) + 'M' : Math.round(m.tokens / 1000) + 'k';
    console.log(
      '  ' + short.padEnd(22) + bold(usd(m.cost).padStart(9)) + grey(`  ${tok} tokens · ${m.messages} responses`),
    );
  }
  console.log('\n  ' + dim('Estimates at published API rates (override in .praxis/config.json'));
  console.log('  ' + dim('"pricing"). On a subscription? This is the value you extracted.'));
  console.log('  ' + dim('Whole project: ') + rose('praxis cost --all') + '\n');
}
