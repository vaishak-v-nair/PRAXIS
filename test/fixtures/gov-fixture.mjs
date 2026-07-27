#!/usr/bin/env node
// Test double for the Governor's model call. Same envelope shape as claude -p
// --output-format json (result is a STRING of JSON). Modes via
// PRAXIS_GOV_FIXTURE_MODE: ok (default) | empty-jobs | bad-inner | bad-outer.

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (stdin += c));
process.stdin.on('end', () => {
  const mode = process.env.PRAXIS_GOV_FIXTURE_MODE || 'ok';

  if (mode === 'bad-outer') {
    process.stdout.write('governor mumbles, not json');
    return;
  }
  if (mode === 'bad-inner') {
    process.stdout.write(JSON.stringify({ type: 'result', result: 'I refuse to answer in JSON.', total_cost_usd: 0.01 }));
    return;
  }
  if (mode === 'empty-jobs') {
    process.stdout.write(
      JSON.stringify({ type: 'result', result: JSON.stringify({ jobs: [], note: 'the goal is a question, not work' }), total_cost_usd: 0.01 }),
    );
    return;
  }

  // ok: a realistic decomposition; echoes whether it saw the briefing marker,
  // and pads with junk entries + an over-cap list to prove server-side vetting
  const sawBriefing = stdin.includes('PROJECT BRIEFING');
  const jobs = [
    { task: 'Write release notes for the last 5 commits into NOTES.md' + (sawBriefing ? '' : ' (blind)'), why: 'goal asks for notes' },
    { task: 'List every TODO comment in src/ into TODO-REPORT.md', why: 'goal asks for a cleanup pass' },
    { task: '', why: 'junk entry that must be filtered' },
    { task: 'padding 3', why: '' },
    { task: 'padding 4', why: '' },
    { task: 'padding 5', why: '' },
    { task: 'padding 6 — beyond the cap, must be dropped', why: '' },
  ];
  process.stdout.write(JSON.stringify({ type: 'result', result: JSON.stringify({ jobs, note: 'two real, rest padding' }), total_cost_usd: 0.02 }));
});
