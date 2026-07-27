// `praxis jobs` — the deck. Every background job, its honest status, and the
// last thing it said. `praxis jobs <id>` is the close-up.
//
// Status is DERIVED (pid checked live), never trusted from stale metadata —
// a dead job must never glow green. This is Mission Control's first screen;
// the full live deck (watch mode, approvals inbox) grows from here.

import { projectPaths } from '../lib/paths.js';
import { listJobs, readMeta, jobStatus, tailOutput } from '../lib/jobs/store.js';
import { bold, grey, sage, rose, amber, dim, timeAgo } from '../lib/ui.js';
import { praxisCmd } from '../lib/runner.js';

function badge(status) {
  if (status === 'running') return amber('● running');
  if (status === 'draft') return amber('▲ draft  ');
  if (status === 'done') return sage('✓ done   ');
  if (status === 'failed') return rose('✗ failed ');
  if (status === 'gone') return rose('○ gone   ');
  return grey('? unknown');
}

export async function jobs(argv = []) {
  const p = projectPaths();
  const id = argv.find((a) => !a.startsWith('--'));

  if (id) {
    const meta = readMeta(p.praxisDir, id);
    if (!meta) {
      console.log('\n  ' + rose('No job ' + id) + '\n');
      process.exitCode = 1;
      return;
    }
    const status = jobStatus(meta);
    console.log('\n  ' + bold('job ' + meta.id) + '   ' + badge(status));
    console.log('  ' + grey('task     ') + meta.task);
    console.log('  ' + grey('tool     ') + meta.tool + grey('  · started ' + timeAgo(new Date(meta.startedAt))));
    if (meta.endedAt) console.log('  ' + grey('ended    ') + timeAgo(new Date(meta.endedAt)) + (meta.exitSource ? grey(' · exit via ' + meta.exitSource) : ''));
    // the agent's parsed final words beat raw envelope JSON every time
    const tail = meta.resultTail
      ? meta.resultTail.split('\n').filter(Boolean).slice(-12)
      : tailOutput(p.praxisDir, meta.id);
    if (tail.length) {
      console.log('\n  ' + bold('last words'));
      for (const line of tail) console.log('    ' + dim(line.slice(0, 110)));
    } else {
      console.log('\n  ' + grey('no output yet' + (status === 'running' ? ' — still thinking' : '')));
    }
    if (meta.receiptId) {
      console.log('\n  ' + bold('receipt  ') + meta.receiptId + '  ' + grey((meta.receiptVerdict || 'UNVERIFIED') + ' · view: ' + praxisCmd() + ' receipt ' + meta.receiptId));
    }
    if (status === 'draft') {
      console.log('\n  ' + amber('▲ DRAFT') + ' — nothing on disk was touched. If this is a plan you want done:');
      console.log('    ' + bold(`${praxisCmd()} approve ${meta.id}`) + grey('   · just an answer? close it: ') + `${praxisCmd()} approve ${meta.id} --deny`);
    }
    if (meta.approvedTo) console.log('\n  ' + grey('approved → execution job ' + meta.approvedTo));
    if (meta.approvedFrom) console.log('\n  ' + grey('execution twin of draft ' + meta.approvedFrom));
    console.log('\n  ' + grey('full output: .praxis/jobs/' + meta.id + '/out.log') + '\n');
    return;
  }

  const rows = listJobs(p.praxisDir);
  if (!rows.length) {
    console.log('\n  ' + grey('No jobs yet. Hand one over: ') + bold(`${praxisCmd()} run "write release notes for the last 5 commits"`) + '\n');
    return;
  }
  console.log('\n  ' + bold('THE DECK') + grey('  · ' + rows.length + ' job' + (rows.length === 1 ? '' : 's') + ' · newest first') + '\n');
  for (const r of rows.slice(0, 15)) {
    const seal = r.receiptId ? grey(' · ' + r.receiptId) : '';
    console.log('  ' + badge(r.status) + '  ' + bold(r.id) + '  ' + grey((r.task || '').slice(0, 60) + ((r.task || '').length > 60 ? '…' : '')) + seal);
  }
  if (rows.length > 15) console.log('  ' + grey(`… ${rows.length - 15} older`));
  console.log('\n  ' + grey(`close-up: ${praxisCmd()} jobs <id>`) + '\n');
}
