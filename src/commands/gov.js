// `praxis gov "<goal>"` — hand the Governor a goal; it staffs the deck.
// `praxis gov`          — the Governor's report: the fleet, at a glance.
//
// v0 contract, stated where the user can see it: the Governor PLANS and
// DELEGATES (every job it queues is a safe draft); it never approves its own
// fleet's execution — that stays with the human inbox. Its own decomposition
// is one model call; if that call fails, nothing is queued.

import fs from 'node:fs';
import { projectPaths } from '../lib/paths.js';
import { readMemory } from '../lib/memory.js';
import { extractBrief } from '../lib/handoff.js';
import { govern } from '../lib/gov.js';
import { startJob } from './run.js';
import { listJobs } from '../lib/jobs/store.js';
import { bold, grey, sage, rose, amber, dim } from '../lib/ui.js';
import { praxisCmd } from '../lib/runner.js';

function deckStateLine(rows) {
  return rows
    .slice(0, 10)
    .map((r) => `${r.status}  ${r.id}  ${(r.task || '').slice(0, 70)}`)
    .join('\n');
}

/** The Governor's report — what the fleet did, what awaits the human. */
function report(p, c) {
  const rows = listJobs(p.praxisDir);
  if (!rows.length) {
    console.log('\n  ' + grey(`The deck is empty. Give the Governor a goal: ${c} gov "ship the release notes"`) + '\n');
    return;
  }
  const drafts = rows.filter((r) => r.status === 'draft');
  const running = rows.filter((r) => r.status === 'running');
  const failed = rows.filter((r) => r.status === 'failed' || r.status === 'gone');
  const done = rows.filter((r) => r.status === 'done');

  console.log('\n  ' + bold('GOVERNOR REPORT') + grey(`  · ${rows.length} job${rows.length === 1 ? '' : 's'} on the deck`) + '\n');
  if (running.length) console.log('  ' + amber('● working  ') + running.map((r) => r.id).join(' · '));
  if (drafts.length) {
    console.log('  ' + amber('▲ awaiting YOU') + '  ' + drafts.length + ' draft' + (drafts.length === 1 ? '' : 's') + grey(` — ${c} approve`));
    for (const d of drafts.slice(0, 5)) console.log('      ' + grey('▲ ' + d.id + '  ' + (d.task || '').slice(0, 58)));
  }
  if (failed.length) {
    console.log('  ' + rose('✗ needs retry') + '  ' + failed.map((r) => r.id).join(' · ') + grey(' — a failed twin? re-approve its draft'));
  }
  if (done.length) {
    const sealed = done.filter((r) => r.receiptId);
    console.log('  ' + sage('✓ finished  ') + done.length + ' job' + (done.length === 1 ? '' : 's') + grey(sealed.length ? ` · ${sealed.length} with sealed receipts` : ''));
    for (const r of done.slice(0, 5)) {
      console.log('      ' + grey('✓ ' + r.id + (r.receiptId ? '  ' + r.receiptId + ' ' + (r.receiptVerdict || '') : '') + '  ' + (r.task || '').slice(0, 44)));
    }
  }
  console.log('\n  ' + dim(`close-up: ${c} jobs <id> · the inbox: ${c} approve`) + '\n');
}

export async function gov(argv = []) {
  const p = projectPaths();
  const c = praxisCmd();
  const goal = argv.filter((a) => !a.startsWith('--')).join(' ').trim();

  if (!goal) {
    report(p, c);
    return;
  }

  // the briefing drawer, in action: the Governor reads what PRAXIS remembers
  let briefing = '';
  try {
    briefing = extractBrief(readMemory(p.memoryFile)) || '';
  } catch {
    /* a project with no memory still gets governed */
  }
  const deckState = deckStateLine(listJobs(p.praxisDir));

  console.log('\n  ' + grey('The Governor is studying the goal… (one model call, ~a minute)'));
  const g = await govern(goal, { briefing, deckState });

  if (!g.ok) {
    console.log('\n  ' + rose('The Governor could not plan this: ') + g.reason + grey('  — nothing was queued.') + '\n');
    process.exitCode = 1;
    return;
  }
  if (!g.jobs.length) {
    console.log('\n  ' + amber('No jobs queued.') + (g.note ? ' ' + grey(g.note) : grey(' The goal needs no background work.')) + '\n');
    return;
  }

  console.log('\n  ' + bold('THE GOVERNOR STAFFED THE DECK') + grey(`  · ${g.jobs.length} job${g.jobs.length === 1 ? '' : 's'}, all safe drafts`) + '\n');
  const queued = [];
  for (const job of g.jobs) {
    const r = await startJob({ task: job.task, mode: 'plan', goal });
    if (r.error) {
      console.log('  ' + rose('✗ could not start: ') + job.task.slice(0, 60) + grey(' (' + r.error + ')'));
      continue;
    }
    queued.push(r.id);
    console.log('  ' + sage('▸') + ' ' + bold(r.id) + '  ' + job.task.slice(0, 66) + (job.task.length > 66 ? '…' : ''));
    if (job.why) console.log('     ' + grey(job.why.slice(0, 76)));
  }
  if (g.note) console.log('\n  ' + grey('Governor: ' + g.note));
  console.log('\n  ' + grey('All drafts touch nothing until YOU approve. Watch: ') + bold(`${c} gov`) + grey(' · approve: ') + bold(`${c} approve`) + '\n');
}
