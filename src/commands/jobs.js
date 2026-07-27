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
    const tail = tailOutput(p.praxisDir, meta.id);
    if (tail.length) {
      console.log('\n  ' + bold('last words'));
      for (const line of tail) console.log('    ' + dim(line.slice(0, 110)));
    } else {
      console.log('\n  ' + grey('no output yet' + (status === 'running' ? ' — still thinking' : '')));
    }
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
    console.log('  ' + badge(r.status) + '  ' + bold(r.id) + '  ' + grey((r.task || '').slice(0, 60) + ((r.task || '').length > 60 ? '…' : '')));
  }
  if (rows.length > 15) console.log('  ' + grey(`… ${rows.length - 15} older`));
  console.log('\n  ' + grey(`close-up: ${praxisCmd()} jobs <id>`) + '\n');
}
