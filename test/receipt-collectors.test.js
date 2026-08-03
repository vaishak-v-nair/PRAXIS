import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectEvidence, collectRepoState, collectClaimProse } from '../src/lib/receipt/collectors.js';

// Build a minimal Claude Code transcript line for an assistant turn with the
// given content items.
function asst(content) {
  return JSON.stringify({ type: 'assistant', message: { content } });
}
function tool(name, input) {
  return { type: 'tool_use', name, input };
}
function toolWithId(id, name, input) {
  return { type: 'tool_use', id, name, input };
}
function toolResult(toolUseId, { isError = false, content = 'ok', isSidechain = false } = {}) {
  const line = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content }] } };
  if (isSidechain) line.isSidechain = true;
  return JSON.stringify(line);
}

test('harvests commands from EVERY channel, not just Bash (the spike bug)', () => {
  const text = [
    asst([tool('Bash', { command: 'npm test' })]),
    asst([tool('PowerShell', { command: "git commit -m 'x' && git push" })]),
  ].join('\n');
  const ev = collectEvidence(text);
  assert.deepEqual(ev.channels_harvested, ['Bash', 'PowerShell']);
  assert.equal(ev.commands_run.length, 2);
  // the PowerShell git push must be visible — the exact miss that caused a false accusation
  assert.equal(ev.git_activity.length, 1);
  assert.equal(ev.git_activity[0].channel, 'PowerShell');
});

test('never truncates a command (the 110-char cap that cut "&& git push")', () => {
  const long = 'npm run build ' + 'x'.repeat(300) + ' && git push origin main';
  const ev = collectEvidence(asst([tool('Bash', { command: long })]));
  assert.equal(ev.commands_run[0].command, long); // full, untruncated
  assert.equal(ev.git_activity.length, 1); // the tail survived
});

test('redacts secrets in commands but keeps length/structure', () => {
  const ev = collectEvidence(asst([tool('Bash', { command: 'deploy --key sk-ant-abcdef0123456789ABCDEF0123' })]));
  const cmd = ev.commands_run[0].command;
  assert.equal(cmd.includes('sk-ant-abcdef0123456789'), false);
  assert.equal(cmd.includes('[REDACTED_ANTHROPIC_KEY]'), true);
});

test('declares completeness_note and never asserts completeness', () => {
  const ev = collectEvidence(asst([tool('Bash', { command: 'ls' })]));
  assert.match(ev.completeness_note, /UNVERIFIABLE, never FALSE/);
  assert.match(ev.completeness_note, /harvested channels only/);
});

test('collects files edited across Edit/Write/NotebookEdit', () => {
  const text = [
    asst([tool('Edit', { file_path: 'src/a.js' })]),
    asst([tool('Write', { file_path: 'docs/b.md' })]),
    asst([tool('NotebookEdit', { file_path: 'n.ipynb' })]),
    asst([tool('Read', { file_path: 'src/a.js' })]), // read is not an edit
  ].join('\n');
  const ev = collectEvidence(text);
  assert.deepEqual(ev.files_edited, ['docs/b.md', 'n.ipynb', 'src/a.js']);
});

test('categorizes test and build commands as hints', () => {
  const text = [
    asst([tool('Bash', { command: 'npm test' })]),
    asst([tool('Bash', { command: 'npm run build' })]),
    asst([tool('Bash', { command: 'echo hello' })]),
  ].join('\n');
  const ev = collectEvidence(text);
  assert.equal(ev.test_activity.length, 1);
  assert.equal(ev.build_activity.length, 1);
  assert.equal(ev.counts.commands, 3);
});

test('ignores sidechains and unparseable lines', () => {
  const text = [
    asst([tool('Bash', { command: 'real' })]),
    JSON.stringify({ type: 'assistant', isSidechain: true, message: { content: [tool('Bash', { command: 'subagent-noise' })] } }),
    '{ not json',
    '',
  ].join('\n');
  const ev = collectEvidence(text);
  assert.equal(ev.commands_run.length, 1);
  assert.equal(ev.commands_run[0].command, 'real');
});

test('empty transcript degrades to an empty, honest record', () => {
  const ev = collectEvidence('');
  assert.deepEqual(ev.channels_harvested, []);
  assert.deepEqual(ev.commands_run, []);
  assert.equal(ev.counts.turns, 0);
  assert.match(ev.completeness_note, /never FALSE/);
});

test('collectRepoState labels repo-global state as shared/unattributed', () => {
  const fakeGit = (args) => {
    assert.equal(args[0], 'log');
    return 'abc123 fix: thing\ndef456 feat: other';
  };
  const state = collectRepoState(fakeGit);
  assert.equal(state.shared, true);
  assert.equal(state.recent_commits.length, 2);
  assert.match(state.note, /concurrent session may own/);
});

test('collectClaimProse harvests assistant prose, redacted and capped', () => {
  const text = [
    asst([{ type: 'text', text: 'All tests pass. Token sk-ant-abcdef0123456789ABCDEF0123 leaked.' }]),
    asst([{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }]), // not prose
    asst([{ type: 'text', text: 'Some prose here.' }]),
  ].join('\n');
  const blocks = collectClaimProse(text);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].text.includes('sk-ant-abcdef'), false); // redacted
  assert.match(blocks[0].text, /\[REDACTED_ANTHROPIC_KEY\]/);
});

test('collectClaimProse claimSignalOnly keeps only claim-bearing blocks (the live right-sizing lever)', () => {
  const text = [
    asst([{ type: 'text', text: 'All tests pass and I committed the fix.' }]), // signal
    asst([{ type: 'text', text: 'Let me think about the approach for a moment.' }]), // no signal
    asst([{ type: 'text', text: 'Here is a thematic, atmospheric mood board.' }]), // no signal
    asst([{ type: 'text', text: 'Deployed to production.' }]), // signal
  ].join('\n');
  const all = collectClaimProse(text);
  const signal = collectClaimProse(text, { claimSignalOnly: true });
  assert.equal(all.length, 4);
  assert.equal(signal.length, 2);
  assert.ok(signal.every((b) => /pass|commit|deploy/i.test(b.text)));
});

test('collectRepoState never throws when git is absent', () => {
  const throwing = () => {
    throw new Error('not a git repo');
  };
  const state = collectRepoState(throwing);
  assert.equal(state.unavailable, true);
  assert.deepEqual(state.recent_commits, []);
  assert.equal(state.shared, true);
});

test('rule 5: the record says presence = attempt, never proof of success', () => {
  const ev = collectEvidence('');
  assert.match(ev.completeness_note, /INVOCATIONS \(attempts\)/);
  assert.match(ev.completeness_note, /cannot be ruled FALSE by its presence alone/);
});

test('pairs a command with an ok outcome from its matching tool_result', () => {
  const text = [asst([toolWithId('t1', 'Bash', { command: 'npm test' })]), toolResult('t1', { isError: false })].join('\n');
  const ev = collectEvidence(text);
  assert.equal(ev.commands_run[0].outcome, 'ok');
});

test('pairs a command with an error outcome from its matching tool_result', () => {
  const text = [
    asst([toolWithId('t1', 'Bash', { command: 'npm publish' })]),
    toolResult('t1', { isError: true, content: 'EACCES: permission denied' }),
  ].join('\n');
  const ev = collectEvidence(text);
  assert.equal(ev.commands_run[0].outcome, 'error');
});

test('a command with no matching tool_result is unknown, never assumed ok or error', () => {
  const ev = collectEvidence(asst([toolWithId('t1', 'Bash', { command: 'git push' })]));
  assert.equal(ev.commands_run[0].outcome, 'unknown');
});

test('a tool_use with no id (older/synthetic transcript) is unknown, never crashes', () => {
  const ev = collectEvidence(asst([tool('Bash', { command: 'ls' })]));
  assert.equal(ev.commands_run[0].outcome, 'unknown');
});

test('outcome propagates into git/test/build activity, not just commands_run', () => {
  const text = [asst([toolWithId('t1', 'Bash', { command: 'npm test' })]), toolResult('t1', { isError: true })].join('\n');
  const ev = collectEvidence(text);
  assert.equal(ev.test_activity[0].outcome, 'error');
});

test('a sidechain tool_result is not attributed to the main session (rule 4)', () => {
  const text = [asst([toolWithId('t1', 'Bash', { command: 'npm test' })]), toolResult('t1', { isError: false, isSidechain: true })].join('\n');
  const ev = collectEvidence(text);
  assert.equal(ev.commands_run[0].outcome, 'unknown');
});

test('completeness_note reports outcome coverage: ok, error, and unknown counts', () => {
  const text = [
    asst([
      toolWithId('t1', 'Bash', { command: 'npm test' }),
      toolWithId('t2', 'Bash', { command: 'npm publish' }),
      toolWithId('t3', 'Bash', { command: 'git push' }),
    ]),
    toolResult('t1', { isError: false }),
    toolResult('t2', { isError: true }),
  ].join('\n');
  const ev = collectEvidence(text);
  assert.match(ev.completeness_note, /1 ok, 1 error, 1 unknown/);
  assert.match(ev.completeness_note, /unknown.*presence-only|Treat 'unknown' exactly like presence-only/);
});
