#!/usr/bin/env node
// Test double for `claude -p --output-format json`. Reads the prompt on stdin
// and emits a run-envelope whose `result` is a STRING of JSON — exactly the
// double-parse shape the real CLI produces. Behavior is chosen by
// PRAXIS_JUDGE_FIXTURE_MODE so tests can exercise success and both failure modes
// without spending tokens or depending on a shell (it's a node script → argv
// spawn works identically on every platform).

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (stdin += c));
process.stdin.on('end', () => {
  const mode = process.env.PRAXIS_JUDGE_FIXTURE_MODE || 'ok';
  const sawEvidence = stdin.includes('EVIDENCE RECORD');

  if (mode === 'bad-outer') {
    process.stdout.write('this is not json at all');
    return;
  }
  if (mode === 'empty') {
    process.stdout.write(JSON.stringify({ type: 'result', total_cost_usd: 0.01 })); // no result field
    return;
  }
  if (mode === 'bad-inner') {
    // valid envelope, but result contains no parseable JSON object
    process.stdout.write(JSON.stringify({ type: 'result', result: 'I could not comply.', total_cost_usd: 0.02 }));
    return;
  }
  if (mode === 'bad-inner-then-ok') {
    // first call: garbage inner; second call (repair prompt present): valid
    const isRepair = stdin.includes('STRICT JSON only, exactly');
    const inner = isRepair
      ? JSON.stringify({ verdicts: [{ claim: 'recovered', verdict: 'UNVERIFIABLE', evidence_cited: '', reasoning: 'ok on retry' }] })
      : 'still thinking...';
    process.stdout.write(JSON.stringify({ type: 'result', result: inner, total_cost_usd: 0.02 }));
    return;
  }

  // ok: emit a realistic verdict set, proving the double-parse path
  const verdicts = [
    { claim: 'all tests pass', verdict: sawEvidence ? 'TRUE' : 'UNVERIFIABLE', evidence_cited: 'test_activity: npm test', reasoning: 'test command present in record' },
    { claim: 'updated the docs', verdict: 'FALSE', evidence_cited: 'files_edited has no docs/', reasoning: 'no docs file edited' },
    { claim: 'fully committed to the design', verdict: 'NOT_A_CLAIM', evidence_cited: '', reasoning: 'metaphor, not a work-claim' },
  ];
  process.stdout.write(
    JSON.stringify({ type: 'result', num_turns: 1, total_cost_usd: 0.03, duration_ms: 1234, result: JSON.stringify({ verdicts }) }),
  );
});
