// praxis roi [--days N] — the receipt. What the AI actually did here lately,
// with the cost next to it. Honest framing: an activity receipt with real
// numbers, not a productivity miracle claim — the reader judges the worth.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { transcriptDir } from '../lib/transcript.js';
import { projectPaths } from '../lib/paths.js';
import { scanUsage, priceUsage, usd, DEFAULT_PRICING } from '../lib/cost.js';
import { miniHeader, sage, rose, bold, grey, dim } from '../lib/ui.js';

const git = (a) => spawnSync('git', a, { encoding: 'utf8', windowsHide: true });

export function roi(args = []) {
  const di = args.indexOf('--days');
  const days = di >= 0 ? Math.max(1, parseInt(args[di + 1], 10) || 7) : 7;
  const since = Date.now() - days * 86400000;
  console.log('\n  ' + miniHeader('', 'receipt') + '\n');

  const dir = transcriptDir();
  let files = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-'))
      .map((f) => path.join(dir, f))
      .filter((f) => {
        try {
          return fs.statSync(f).mtimeMs >= since;
        } catch {
          return false;
        }
      });
  } catch {
    /* none */
  }
  if (!files.length) {
    console.log(`  No AI sessions in the last ${days} days in this folder.\n`);
    return;
  }

  let pricing = DEFAULT_PRICING;
  try {
    const cfg = JSON.parse(fs.readFileSync(projectPaths().configFile, 'utf8'));
    if (cfg.pricing) pricing = { ...DEFAULT_PRICING, ...cfg.pricing };
  } catch {
    /* defaults */
  }

  const merged = {};
  let sessions = 0;
  let activeMs = 0;
  for (const f of files) {
    let text = '';
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const { byModel, firstTs, lastTs } = scanUsage(text);
    if (!Object.keys(byModel).length) continue;
    sessions++;
    if (firstTs && lastTs) activeMs += Math.max(0, Date.parse(lastTs) - Date.parse(firstTs));
    for (const [m, b] of Object.entries(byModel)) {
      const t = (merged[m] ||= { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0 });
      for (const k of Object.keys(b)) t[k] += b[k];
    }
  }
  const { total } = priceUsage(merged, pricing);
  const responses = Object.values(merged).reduce((a, b) => a + b.messages, 0);

  // what it produced (git side)
  const inRepo = git(['rev-parse', '--git-dir']).status === 0;
  let commits = 0;
  let traced = 0;
  if (inRepo) {
    const recent = (git(['log', `--since=${days} days ago`, '--format=%H']).stdout || '').trim().split('\n').filter(Boolean);
    commits = recent.length;
    // intersect recent commits with noted objects — "notes list" spans ALL
    // history, so a min() would credit old traces to recent commits
    const notedSet = new Set(
      (git(['notes', '--ref=refs/notes/praxis', 'list']).stdout || '')
        .trim().split('\n').map((l) => l.split(' ')[1]).filter(Boolean),
    );
    traced = recent.filter((h) => notedSet.has(h)).length;
  }

  const hours = activeMs / 3600000;
  console.log('  ' + bold(`Last ${days} days, this project`) + '\n');
  console.log('  sessions   ' + bold(String(sessions)) + grey(`  ·  ~${hours.toFixed(1)}h of active AI time · ${responses} AI responses`));
  if (inRepo) console.log('  commits    ' + bold(String(commits)) + grey(traced ? `  ·  ${traced} carry an AI decision trail` : ''));
  console.log('  AI cost    ' + bold(usd(total)) + grey('  API-equivalent'));
  if (commits > 0 && total > 0) console.log('  per commit ' + bold(usd(total / commits)) + grey('  of AI work each'));
  console.log('\n  ' + dim('Real numbers from transcripts + git. Worth it? You just saw the receipt.'));
  console.log('  ' + dim('Details: ') + rose('praxis cost --all') + dim(' · ') + rose('praxis trace log') + '\n');
}
