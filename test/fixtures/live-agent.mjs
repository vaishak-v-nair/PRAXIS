#!/usr/bin/env node
// Test double for `claude -p --output-format json` as the demo's LIVE mode
// drives it. It does the same three things the real CLI does, which is what
// makes the live path testable for zero tokens on every platform:
//
//   1. actually writes the files in its cwd (so file evidence is REAL, not
//      described — the sandbox genuinely gets worked on),
//   2. writes a session transcript where Claude Code would write one, so
//      receipt-link finds it by session_id exactly as it does in production,
//   3. prints the run envelope, whose `session_id` is the whole hinge.
//
// Behavior is chosen by PRAXIS_LIVE_FIXTURE_MODE so one fixture covers success
// and the failure classes live mode has to name honestly.
//
//   ok           — the happy path
//   auth         — exits non-zero talking like an unauthenticated CLI
//   no-session   — a valid envelope with no session_id (a non-claude adapter)
//   hang         — never exits, so the timeout path can be exercised

import fs from 'node:fs';
import path from 'node:path';
import { transcriptDir } from '../../src/lib/transcript.js';

const mode = process.env.PRAXIS_LIVE_FIXTURE_MODE || 'ok';
const sessionId = process.env.PRAXIS_LIVE_FIXTURE_SESSION || 'live-fixture-session';
const cwd = process.cwd();

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (stdin += c));
process.stdin.on('end', () => {
  if (mode === 'hang') {
    // An empty interval is what keeps the event loop alive — without a handle,
    // node would exit the moment stdin closed and the "hang" would not hang.
    setInterval(() => {}, 1000);
    return;
  }

  if (mode === 'auth') {
    process.stderr.write('Invalid API key · Please run `claude login` to authenticate.\n');
    process.exit(1);
  }

  // The work is real: these files exist on disk when this process ends.
  fs.writeFileSync(path.join(cwd, 'sum.js'), 'export function sum(a, b) {\n  return a + b;\n}\n');
  fs.writeFileSync(
    path.join(cwd, 'sum.test.js'),
    [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { sum } from './sum.js';",
      '',
      "test('adds', () => assert.equal(sum(2, 2), 4));",
      "test('handles negatives', () => assert.equal(sum(-1, 1), 0));",
      '',
    ].join('\n'),
  );

  if (mode !== 'no-session') writeTranscript();

  const result =
    'I created sum.js with a sum(a, b) function and sum.test.js covering two cases, ' +
    'then ran the suite with `node --test`. The tests passed.';
  const envelope = { type: 'result', num_turns: 3, total_cost_usd: 0.01, duration_ms: 900, result };
  if (mode !== 'no-session') envelope.session_id = sessionId;
  process.stdout.write(JSON.stringify(envelope));
  process.exit(0);
});

/**
 * A transcript in Claude Code's own shape — assistant turns carrying tool_use
 * blocks. The collectors read exactly this, so the evidence the judge sees in a
 * test is built by the same code path that builds it in production.
 */
function writeTranscript() {
  const dir = transcriptDir(cwd, process.env.PRAXIS_TRANSCRIPT_HOME || undefined);
  fs.mkdirSync(dir, { recursive: true });
  const assistant = (content) => JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'm' + Math.random().toString(16).slice(2), content } });

  const lines = [
    JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { content: stdin.slice(0, 400) } }),
    assistant([{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: path.join(cwd, 'sum.js') } }]),
    assistant([{ type: 'tool_use', id: 't2', name: 'Write', input: { file_path: path.join(cwd, 'sum.test.js') } }]),
    assistant([{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'node --test' } }]),
    assistant([
      {
        type: 'text',
        text:
          'I created sum.js with a sum(a, b) function and sum.test.js covering two cases, ' +
          'then ran the suite with `node --test`. The tests passed.',
      },
    ]),
  ];
  fs.writeFileSync(path.join(dir, sessionId + '.jsonl'), lines.join('\n') + '\n');
}
