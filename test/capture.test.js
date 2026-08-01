// The Stop hook, actually run.
//
// This file exists because `capture` had 0% function coverage while being the
// single most-executed codepath in the product — it fires at the end of every
// session on every install. Not for lack of care: `capture()` ends in
// process.exit(0), so calling it from a test killed the runner, and V8 coverage
// does not follow spawned processes. The shape forbade the test. Splitting
// `captureRun()` out from the exit is what made these possible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureRun, summarizeTranscriptText, recentAsks } from '../src/commands/capture.js';
import { readLastError, recordError } from '../src/lib/errors.js';
import { readState, writeState } from '../src/lib/state.js';
import { checkCapture } from '../src/lib/doctor.js';
import { asLines, readTranscriptLines } from '../src/lib/transcript.js';
import { extractEssence } from '../src/lib/checkpoint.js';
import { analyzeTranscript } from '../src/lib/health.js';
import { collectEvidence } from '../src/lib/receipt/collectors.js';

function project({ config = { capture: true }, memory = '# PRAXIS Memory\n## Project\n' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-capture-'));
  fs.mkdirSync(path.join(root, '.praxis'), { recursive: true });
  if (memory !== null) fs.writeFileSync(path.join(root, '.praxis', 'memory.md'), memory);
  if (config) fs.writeFileSync(path.join(root, '.praxis', 'config.json'), JSON.stringify(config));
  return root;
}

/** A transcript shaped like the real thing: a user turn and an assistant turn. */
function transcript(root, { ask = 'ship the release notes', file = 'src/index.js' } = {}) {
  const ts = new Date().toISOString();
  const f = path.join(root, 'session.jsonl');
  fs.writeFileSync(
    f,
    [
      JSON.stringify({ type: 'user', timestamp: ts, message: { content: ask } }),
      JSON.stringify({
        type: 'assistant',
        timestamp: ts,
        message: {
          model: 'claude-opus-5',
          content: [{ type: 'text', text: 'done' }, { type: 'tool_use', input: { file_path: file } }],
          usage: { input_tokens: 1200, cache_read_input_tokens: 4000 },
        },
      }),
    ].join('\n'),
  );
  return f;
}

const hook = (root, extra = {}) => JSON.stringify({ cwd: root, hook_event_name: 'Stop', ...extra });

test('a real session lands in memory, and the run reports what it did', async () => {
  const root = project();
  const r = await captureRun({ raw: hook(root, { transcript_path: transcript(root) }) });

  assert.equal(r.outcome, 'captured');
  assert.equal(r.wrote, true);
  assert.equal(r.recorded, false, 'nothing went wrong');

  const mem = fs.readFileSync(path.join(root, '.praxis', 'memory.md'), 'utf8');
  assert.match(mem, /ship the release notes/, 'what the human actually asked for');
  assert.match(mem, /src\/index\.js/, 'and what got touched');
  assert.match(mem, /## Session Log/);
});

test('an unreadable transcript is survived AND recorded — the whole point', async () => {
  // Before this, the read threw, the catch ate it, capture exited 0, and every
  // surface still said healthy. This is the exact failure the review found.
  const root = project();
  const r = await captureRun({ raw: hook(root, { transcript_path: path.join(root, 'gone.jsonl') }) });

  assert.equal(r.recorded, true);
  const err = readLastError(path.join(root, '.praxis'));
  assert.equal(err.phase, 'transcript-read');
  assert.match(err.message, /ENOENT/);

  const verdict = checkCapture(root);
  assert.equal(verdict.ok, false, 'and the doctor can now see it');
  assert.match(verdict.detail, /transcript-read/);
});

test('a later good run clears the fault it left behind', async () => {
  const root = project();
  await captureRun({ raw: hook(root, { transcript_path: path.join(root, 'gone.jsonl') }) });
  assert.ok(readLastError(path.join(root, '.praxis')), 'faulted first');

  await captureRun({ raw: hook(root, { transcript_path: transcript(root) }) });
  assert.equal(readLastError(path.join(root, '.praxis')), null, 'recovery clears it');
  assert.equal(checkCapture(root).ok, true);
});

test('the state breadcrumb ends on restored, so liveness is provable', async () => {
  const root = project();
  await captureRun({ raw: hook(root, { transcript_path: transcript(root) }) });
  const s = readState(path.join(root, '.praxis'));
  assert.equal(s.phase, 'restored', 'written last, and only if the loop got there');
  assert.ok(s.ageMs < 10000);
});

test('a session where nothing happened writes no memory entry', async () => {
  const root = project();
  const empty = path.join(root, 'empty.jsonl');
  fs.writeFileSync(empty, '');
  const r = await captureRun({ raw: hook(root, { transcript_path: empty }) });

  assert.equal(r.outcome, 'nothing-to-record');
  assert.equal(r.wrote, false);
  const mem = fs.readFileSync(path.join(root, '.praxis', 'memory.md'), 'utf8');
  assert.doesNotMatch(mem, /no file changes detected/, 'noise entries were removed on purpose');
});

test('a PreCompact snapshot is written even when a Stop would not be', async () => {
  // PreCompact fires BEFORE the session is squeezed and detail is lost forever,
  // so "nothing happened yet" is not a reason to skip it.
  const root = project();
  const empty = path.join(root, 'empty.jsonl');
  fs.writeFileSync(empty, '');
  const r = await captureRun({
    raw: hook(root, { hook_event_name: 'PreCompact', transcript_path: empty }),
  });
  assert.equal(r.wrote, true);
  assert.match(fs.readFileSync(path.join(root, '.praxis', 'memory.md'), 'utf8'), /pre-compact snapshot/);
});

test('capture: false is honoured before ANY breadcrumb is written', async () => {
  // Regression. Config used to be read late, after state.json already said
  // 'switching' — so a deliberately disabled capture left a half-finished
  // breadcrumb, and half an hour later the doctor reported "a capture started
  // and never finished" about something nobody had asked to run.
  const root = project({ config: { capture: false } });
  const r = await captureRun({ raw: hook(root, { transcript_path: transcript(root) }) });
  assert.equal(r.outcome, 'capture-disabled');
  assert.doesNotMatch(fs.readFileSync(path.join(root, '.praxis', 'memory.md'), 'utf8'), /Session Log/);

  assert.equal(fs.existsSync(path.join(root, '.praxis', 'capture.json')), false, 'no liveness record');
  assert.equal(fs.existsSync(path.join(root, '.praxis', 'state.json')), false, 'no tray breadcrumb either');
  assert.equal(checkCapture(root).ok, true, 'and the doctor does not invent a fault from an opt-out');
});

test('another command moving context is NOT a capture', async () => {
  // Regression, and the worst bug this feature could have had. The liveness
  // check first read state.json — which capture, checkpoint (five times),
  // switch and trace all write. So `praxis checkpoint` made the doctor report
  // a successful capture that never happened: a FALSE GREEN, which is strictly
  // worse than no check, because it answers the question wrongly and with
  // confidence. capture.json has exactly one writer.
  const root = project();
  writeState(path.join(root, '.praxis'), 'restored'); // what checkpoint/switch leave behind

  const v = checkCapture(root);
  assert.doesNotMatch(v.detail, /last completed/, 'someone else’s breadcrumb is not evidence capture ran');

  // and a vault failure recorded by checkpoint or trace is not a capture fault
  recordError(path.join(root, '.praxis'), 'vault-commit-note', new Error('drive not mounted'));
  assert.equal(checkCapture(root).ok, true, 'another command’s error does not accuse capture');

  // only capture itself moves this needle
  await captureRun({ raw: hook(root, { transcript_path: transcript(root) }) });
  assert.match(checkCapture(root).detail, /last completed/, 'a real capture does');
});

test('a directory that is not a PRAXIS project is left completely alone', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-notaproj-'));
  const r = await captureRun({ raw: hook(root, { transcript_path: path.join(root, 'x.jsonl') }) });
  assert.equal(r.outcome, 'not-a-praxis-project');
  assert.deepEqual(fs.readdirSync(root), [], 'not one file created');
});

test('garbage on stdin does not throw, and does not invent a project', async () => {
  // The hook payload comes from another program. Every shape it could send has
  // to end in a return, never an exception — this runs inside somebody's editor.
  for (const raw of ['', 'not json at all', '{', '{"cwd":123}', '﻿{}']) {
    const r = await captureRun({ raw });
    assert.equal(typeof r.outcome, 'string', `survived ${JSON.stringify(raw)}`);
  }
});

test('a receipt is sealed on Stop, and never on a PreCompact squeeze', async () => {
  const root = project();
  await captureRun({ raw: hook(root, { transcript_path: transcript(root) }) });
  const receipts = path.join(root, '.praxis', 'receipts');
  assert.ok(fs.existsSync(receipts) && fs.readdirSync(receipts).length, 'Stop seals proof-of-work');

  const root2 = project();
  await captureRun({
    raw: hook(root2, { hook_event_name: 'PreCompact', transcript_path: transcript(root2) }),
  });
  const r2 = path.join(root2, '.praxis', 'receipts');
  assert.ok(
    !fs.existsSync(r2) || !fs.readdirSync(r2).length,
    'a mid-session squeeze is not the end of the work, so it seals nothing',
  );
});

// ── one pass, not six ────────────────────────────────────────────────────────
// Six things reduce a transcript line by line and each used to re-split the
// whole string. Measured on a real 39 MB session: 2801 ms before, 2235 ms after,
// and 8 MB less resident. The bigger win is the ceiling — readFileSync(…,'utf8')
// throws above V8's 512 MiB string limit, and on the hook path that throw was
// swallowed, so the longest sessions silently produced no memory at all.

test('every consumer gives the same answer from text or from lines', async () => {
  // The refactor is only safe if the two shapes are interchangeable. If this
  // ever drifts, a receipt built from lines would disagree with one built from
  // text about what the agent did — and the receipt is the product.
  const root = project();
  const file = transcript(root, { ask: 'run the tests', file: 'src/a.js' });
  const text = fs.readFileSync(file, 'utf8');
  const lines = await readTranscriptLines(file);

  assert.deepEqual(summarizeTranscriptText(lines), summarizeTranscriptText(text));
  assert.deepEqual(recentAsks(lines), recentAsks(text));
  assert.equal(extractEssence(lines, 1).lastClaude, extractEssence(text, 1).lastClaude);
  assert.equal(analyzeTranscript(lines).contextTokens, analyzeTranscript(text).contextTokens);
  assert.deepEqual(collectEvidence(lines).files_edited, collectEvidence(text).files_edited);
});

test('asLines takes either shape and never throws on nothing', () => {
  const arr = ['a', 'b'];
  assert.equal(asLines(arr), arr, 'an array passes straight through — no copy, no re-split');
  assert.deepEqual(asLines('a\nb'), ['a', 'b']);
  assert.deepEqual(asLines(''), ['']);
  assert.deepEqual(asLines(null), ['']);
  assert.deepEqual(asLines(undefined), ['']);
});

test('the streaming reader handles the shapes real files come in', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-lines-'));
  const write = (name, body) => {
    const f = path.join(root, name);
    fs.writeFileSync(f, body);
    return f;
  };

  assert.deepEqual(await readTranscriptLines(write('lf.jsonl', '{"a":1}\n{"a":2}\n')), ['{"a":1}', '{"a":2}']);
  assert.deepEqual(await readTranscriptLines(write('crlf.jsonl', '{"a":1}\r\n{"a":2}\r\n')), ['{"a":1}', '{"a":2}'],
    'CRLF must not leave a stray \\r that breaks JSON.parse');
  assert.deepEqual(await readTranscriptLines(write('noeol.jsonl', '{"a":1}')), ['{"a":1}'],
    'a file still being written has no trailing newline');
  assert.deepEqual(await readTranscriptLines(write('bom.jsonl', '﻿{"a":1}\n')), ['{"a":1}'],
    'the BOM survives a stream where it would not survive stripBom on the whole file');
  assert.deepEqual(await readTranscriptLines(write('empty.jsonl', '')), []);

  await assert.rejects(() => readTranscriptLines(path.join(root, 'nope.jsonl')), /ENOENT/,
    'a missing file still throws — capture catches it and records it');
});

test('session health is written for the tray when the transcript carries usage', async () => {
  const root = project();
  await captureRun({ raw: hook(root, { transcript_path: transcript(root) }) });
  const h = JSON.parse(fs.readFileSync(path.join(root, '.praxis', 'health.json'), 'utf8'));
  assert.equal(h.source, 'capture');
  assert.equal(h.contextTokens, 5200, 'input + cache reads, the real context size');
  assert.ok(h.pct > 0);
});
