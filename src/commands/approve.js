// `praxis approve` — the inbox. Safe drafts wait here; you decide what runs.
//
//   praxis approve             the inbox: every draft awaiting your call
//   praxis approve <id>        execute a draft — a twin job runs with file
//                              edits pre-approved, carrying the draft's plan
//   praxis approve <id> --deny close a draft without executing (also: a draft
//                              that was just an answer needs no approving)
//
// The safety model in one line: the DRAFT run could not touch anything (plan
// mode); execution happens only after a human said so, and the execution twin
// is a separate, fully-logged job on the same deck.

import { projectPaths } from '../lib/paths.js';
import { listJobs, readMeta, updateMeta, jobStatus, tailOutput } from '../lib/jobs/store.js';
import { startJob } from './run.js';
import { bold, grey, sage, rose, amber } from '../lib/ui.js';
import { praxisCmd } from '../lib/runner.js';

/** The plan context handed to the execution twin — enough to act, capped so a
 *  chatty draft can't blow up the prompt. */
export function executionTask(meta, planTail) {
  return (
    meta.task +
    '\n\n---\nYou already studied this task in a read-only draft run and produced the plan below. ' +
    'The human APPROVED it. Execute it now — do the work, verify it, and state plainly what changed.\n\nYOUR PLAN WAS:\n' +
    planTail
  );
}

export async function approve(argv = []) {
  const p = projectPaths();
  const c = praxisCmd();
  const deny = argv.includes('--deny') || argv.includes('--close');
  const id = argv.find((a) => !a.startsWith('--'));

  // no id — show the inbox
  if (!id) {
    const drafts = listJobs(p.praxisDir).filter((j) => j.status === 'draft');
    if (!drafts.length) {
      console.log('\n  ' + grey('Inbox empty — no drafts waiting. `' + c + ' run "<task>"` creates one.') + '\n');
      return;
    }
    console.log('\n  ' + bold('THE INBOX') + grey('  · ' + drafts.length + ' draft' + (drafts.length === 1 ? '' : 's') + ' awaiting you') + '\n');
    for (const d of drafts) {
      console.log('  ' + amber('▲') + ' ' + bold(d.id) + '  ' + grey((d.task || '').slice(0, 64)));
    }
    console.log('\n  ' + grey(`execute: ${c} approve <id>   · close: ${c} approve <id> --deny   · read it first: ${c} jobs <id>`) + '\n');
    return;
  }

  const meta = readMeta(p.praxisDir, id);
  if (!meta) {
    console.log('\n  ' + rose('No job ' + id) + '\n');
    process.exitCode = 1;
    return;
  }
  const status = jobStatus(meta);

  if (deny) {
    if (meta.approval !== 'pending') {
      console.log('\n  ' + grey('Nothing pending on ' + id + ' (status: ' + status + ').') + '\n');
      return;
    }
    updateMeta(p.praxisDir, id, { approval: 'denied' });
    console.log('\n  ' + sage('✓') + ' draft ' + bold(id) + ' closed — nothing was executed.\n');
    return;
  }

  if (status === 'running') {
    console.log('\n  ' + amber('Still running') + grey(' — approve it when the draft lands. Watch: ' + c + ' jobs ' + id) + '\n');
    return;
  }

  // retry: an approved draft whose execution twin DIED (failed / gone) may be
  // approved again — a 529 at 2am must not consume the human's decision.
  if (status !== 'draft') {
    const twin = meta.approvedTo ? readMeta(p.praxisDir, meta.approvedTo) : null;
    const twinStatus = twin ? jobStatus(twin) : null;
    if (meta.approval === 'approved' && (twinStatus === 'failed' || twinStatus === 'gone')) {
      console.log('\n  ' + amber('execution job ' + meta.approvedTo + ' ' + twinStatus) + grey(' — re-running your approved plan.'));
    } else {
      console.log('\n  ' + grey('Job ' + id + ' is ' + status + ' — only a waiting draft (or one whose execution failed) can be approved.') + '\n');
      return;
    }
  }

  const planTail = tailOutput(p.praxisDir, id, 40).join('\n').slice(-2400);
  const r = await startJob({ task: executionTask(meta, planTail), tool: meta.tool, mode: 'acceptEdits', approvedFrom: id });
  if (r.error) {
    console.log('\n  ' + rose('Could not start the execution job: ') + r.error + '\n');
    process.exitCode = 1;
    return;
  }
  updateMeta(p.praxisDir, id, { approval: 'approved', approvedTo: r.id });

  console.log('\n  ' + sage('✓') + ' approved — execution job ' + bold(r.id) + ' is running ' + grey('(file edits pre-approved)'));
  console.log('  ' + grey('draft    ') + id + grey('  →  ') + r.id);
  console.log('  ' + grey('watch    ') + c + ' jobs ' + r.id + '\n');
}
