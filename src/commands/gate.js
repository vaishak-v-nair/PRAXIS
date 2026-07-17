// praxis gate [ref] — the slop gate. Scores a commit for AI-slop risk from
// locally observable signals (churn, tests, session fill at commit, trace
// presence) so a reviewer triages in 5 seconds instead of drowning in 90
// minutes. A triage aid, never a verdict.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { transcriptDir, newestTranscript } from '../lib/transcript.js';
import { scanWindow } from '../lib/trace.js';
import { classifyContext } from '../lib/health.js';
import { slopScore } from '../lib/cost.js';
import { miniHeader, sage, rose, bold, grey, dim, amber, red } from '../lib/ui.js';

const git = (a) => spawnSync('git', a, { encoding: 'utf8', windowsHide: true });

export function gate(args = []) {
  const ref = args.filter((a) => !a.startsWith('--'))[0] || 'HEAD';
  console.log('\n  ' + miniHeader('', 'gate') + '\n');
  if (git(['rev-parse', '--git-dir']).status !== 0) {
    console.log('  Not a git repository.\n');
    process.exitCode = 1;
    return;
  }
  const subject = git(['log', '-1', '--format=%h  %s', ref]);
  if (subject.status !== 0) {
    console.log('  Unknown commit: ' + ref + '\n');
    process.exitCode = 1;
    return;
  }

  // diff signals
  const stat = git(['show', '--stat', '--format=', ref]).stdout || '';
  const files = (git(['show', '--name-only', '--format=', ref]).stdout || '').trim().split('\n').filter(Boolean);
  // parse the two counts independently — a delete-only commit has no
  // "insertions" token, so a combined regex would score it as zero churn
  const insM = stat.match(/(\d+) insertions?/);
  const delM = stat.match(/(\d+) deletions?/);
  const insertions = insM ? parseInt(insM[1], 10) : 0;
  const deletions = delM ? parseInt(delM[1], 10) : 0;
  const testsTouched = files.some((f) => /test|spec|__tests__/i.test(f));
  const srcTouched = files.some((f) => /\.(js|ts|py|go|rs|java|rb|c|cpp|cs|jsx|tsx|mjs)$/i.test(f) && !/test|spec/i.test(f));

  // session signals from the transcript window around the commit
  let contextPct = 0;
  let autonomousWindow = false;
  try {
    const commitTs = parseInt((git(['log', '-1', '--format=%ct', ref]).stdout || '0').trim(), 10) * 1000;
    const file = newestTranscript(transcriptDir());
    if (file && commitTs) {
      const text = fs.readFileSync(file, 'utf8');
      const scan = scanWindow(text, commitTs - 4 * 3600 * 1000);
      if (scan.lastTokens > 0) contextPct = classifyContext(scan.lastTokens).pct;
      autonomousWindow = scan.asks.length === 0 && (scan.said.length > 0 || scan.files.size > 0);
    }
  } catch {
    /* degrade */
  }
  const hasTrace = git(['notes', '--ref=refs/notes/praxis', 'show', ref]).status === 0;

  const { score, level, reasons } = slopScore({
    filesChanged: files.length,
    insertions,
    deletions,
    testsTouched,
    srcTouched,
    contextPct,
    hasTrace,
    autonomousWindow,
  });

  const paint = level === 'high' ? red : level === 'medium' ? amber : sage;
  console.log('  ' + bold(subject.stdout.trim()) + '\n');
  console.log('  slop risk  ' + paint(bold(`${score}/100 · ${level}`)));
  for (const r of reasons) console.log('    ' + grey(r));
  if (!reasons.length) console.log('    ' + grey('no risk signals — small, tested, well-documented change'));
  console.log('\n  ' + dim('A triage aid, not a verdict. The why behind it: ') + rose('praxis trace ' + (ref === 'HEAD' ? '' : ref)).trimEnd() + '\n');
}
