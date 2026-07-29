import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { loadCorpus, validateCorpus, corpusPath } from '../src/lib/demo/corpus.js';
import { sealDemoReceipt, sealAndVerify, renderClaim, summariseTotals, speedFactor } from '../src/lib/demo/replay.js';
import { armedState, armedLine, epilogueLines, degradeMessage, classifyFsError, DEGRADE } from '../src/lib/demo/epilogue.js';
import { readEntries, isDemo, provenanceOf, verifyFile } from '../src/lib/receipt/store.js';
import { demoPaths } from '../src/lib/paths.js';

const CLI = path.resolve('src', 'cli.js');
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-demo-' + n + '-'));

function runDemo(args = [], env = {}) {
  return spawnSync(process.execPath, [CLI, 'demo', ...args], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, PRAXIS_DEMO_SPEED: '0', ...env },
  });
}

test('the packaged corpus loads and is internally consistent', () => {
  const res = loadCorpus();
  assert.equal(res.ok, true, 'the demo ships its own recording — it must be readable from the package');
  assert.deepEqual(validateCorpus(res.corpus), [], 'no dangling beat references');
  assert.ok(fs.existsSync(corpusPath()), 'corpus is on disk where the package expects it');
});

test('the corpus tells the arc it claims to tell', () => {
  const { corpus } = loadCorpus();
  const before = corpus.verdicts.before.claims.find((c) => c.key === 'publish');
  const after = corpus.verdicts.after.claims.find((c) => c.key === 'publish');
  assert.equal(before.verdict, 'FALSE', 'the false accusation is the whole point of the story');
  assert.notEqual(after.verdict, 'FALSE', 'and the rule is what fixed it');
  assert.match(after.reasoning, /presence never proves success/i, 'iron rule 5, in the judge’s own words');
});

test('replay seals a REAL receipt marked as a demo, carrying no verdict', () => {
  const dir = path.join(tmp('seal'), 'receipts');
  process.env.PRAXIS_KEY_DIR = path.join(tmp('seal-keys'), 'keys');
  const { corpus } = loadCorpus();

  const sealed = sealAndVerify(dir, corpus, { sessionId: 'demo-test-1', now: '2026-07-28T00:00:00.000Z' });
  assert.equal(sealed.verification.ok, true, 'sealed and immediately verifiable');

  const entries = readEntries(sealed.file);
  assert.equal(provenanceOf(entries), 'demo-replay');
  assert.equal(isDemo(entries), true, 'a demo receipt must be knowable as one, forever');

  const final = entries[entries.length - 1];
  assert.equal(final.verdict, 'UNVERIFIED', 'no judge ran here — inventing the recorded verdict would be the one unforgivable bug');
  assert.deepEqual(final.claims, [], 'and no claims are attributed to a judging that did not happen');
});

test('the sealed evidence is the recording’s evidence, and says it is an excerpt', () => {
  const dir = path.join(tmp('ev'), 'receipts');
  const { corpus } = loadCorpus();
  const sealed = sealDemoReceipt(dir, corpus, { sessionId: 'demo-test-2', now: 'T' });
  const ev = readEntries(sealed.file).find((e) => e.t === 'evidence');

  assert.equal(ev.commands_run.length, corpus.evidence.commands_run.length);
  assert.match(ev.completeness_note, /never "did not happen"/, 'absence is declared, never asserted as proof');
  assert.ok(ev.replay_of && ev.replay_of.receipts.length === 2, 'the receipt names the run it replays');
});

test('every demo run seals its own distinct receipt', () => {
  const dir = path.join(tmp('distinct'), 'receipts');
  const { corpus } = loadCorpus();
  const a = sealDemoReceipt(dir, corpus, { sessionId: 'demo-a', now: 'T' });
  const b = sealDemoReceipt(dir, corpus, { sessionId: 'demo-b', now: 'T' });
  assert.notEqual(a.id, b.id);
  assert.equal(verifyFile(a.file).ok, true);
  assert.equal(verifyFile(b.file).ok, true);
});

test('armedState reads the real project, so the ending never over-claims', () => {
  const fresh = tmp('armed-none');
  assert.equal(armedState(fresh), 'not-initialized');
  assert.match(armedLine('not-initialized'), /Run `/, 'a stranger is told how to arm it');

  fs.mkdirSync(path.join(fresh, '.praxis'), { recursive: true });
  assert.equal(armedState(fresh), 'just-initialized');
  assert.match(armedLine('just-initialized'), /next session/);

  fs.mkdirSync(path.join(fresh, '.praxis', 'receipts'), { recursive: true });
  fs.writeFileSync(path.join(fresh, '.praxis', 'receipts', 'r-x.jsonl'), '{}\n');
  assert.equal(armedState(fresh), 'armed');
  assert.match(armedLine('armed'), /already seal/);
});

test('the epilogue offers a command that actually runs (absolute, not ~)', () => {
  const abs = path.join(os.homedir(), '.praxis', 'demo', 'receipts', 'r-abc.jsonl');
  const lines = epilogueLines({ receiptPath: abs, displayPath: '~/.praxis/demo/receipts/r-abc.jsonl', state: 'armed', agentDetected: false });
  const cmdLine = lines.find((l) => l.includes('receipt verify'));
  assert.ok(cmdLine.includes(abs), 'the pasteable command carries the absolute path');
  assert.ok(!cmdLine.includes('~'), 'no tilde in a command — nothing expands it on Windows');
  assert.equal(lines.some((l) => /demo --live/.test(l)), false, 'no live pointer when no agent was detected');

  const withAgent = epilogueLines({ receiptPath: abs, state: 'armed', agentDetected: true });
  assert.ok(withAgent.some((l) => /demo --live/.test(l)), 'and it appears when one was');
});

test('every degrade class has an honest line; floors point at doctor, degrades say they fell back', () => {
  for (const [cls, entry] of Object.entries(DEGRADE)) {
    const msg = degradeMessage(cls);
    assert.ok(msg.length > 20, `${cls} has a real sentence`);
    if (entry.floor) assert.match(msg, /doctor/, `${cls} points at a command that exists`);
    if (entry.degrades) assert.match(msg, /recorded replay/, `${cls} says what it fell back to`);
  }
  assert.equal(classifyFsError({ code: 'ENOSPC' }), 'disk-full');
  assert.equal(classifyFsError({ code: 'EACCES' }), 'unwritable');
  assert.equal(classifyFsError({ code: 'WEIRD' }), 'unwritable', 'unknown filesystem errors still get a named class');
});

test('FLOOR: a missing corpus is a named error and a non-zero exit, never a stack trace', () => {
  const r = runDemo([], { PRAXIS_DEMO_CORPUS: path.join(tmp('nocorpus'), 'gone.json') });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /could not run/i);
  assert.match(r.stdout, /doctor/, 'points at the command that diagnoses it');
  assert.ok(!/at .*\.js:\d+/.test(r.stdout + r.stderr), 'no stack trace reaches the stranger');
});

test('FLOOR: a corrupt corpus is a named error, not a JSON parse crash', () => {
  const bad = path.join(tmp('badcorpus'), 'corpus.json');
  fs.writeFileSync(bad, '{ not json at all');
  const r = runDemo([], { PRAXIS_DEMO_CORPUS: bad });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /recording could not be read|could not run/i);
  assert.ok(!/SyntaxError|Unexpected token/.test(r.stdout + r.stderr), 'the parse error is translated, not leaked');
});

test('FLOOR: a structurally incomplete corpus is refused rather than half-played', () => {
  const bad = path.join(tmp('thin'), 'corpus.json');
  fs.writeFileSync(bad, JSON.stringify({ beats: [{ kind: 'verdict', which: 'before' }] }));
  const r = runDemo([], { PRAXIS_DEMO_CORPUS: bad });
  assert.equal(r.status, 1);
  assert.ok(!/at .*\.js:\d+/.test(r.stdout + r.stderr));
});

test('end to end: the demo runs offline, seals, verifies, and says all three true things', () => {
  const r = runDemo();
  assert.equal(r.status, 0, r.stdout + r.stderr);

  // the recording is labelled as a recording, every time it is shown
  assert.match(r.stdout, /REPLAY/);
  assert.equal((r.stdout.match(/recorded verdict/g) || []).length, 2, 'both judgings carry the label adjacent to them — never a footnote');

  // the receipt is NOT labelled as a recording, because it is not one
  assert.match(r.stdout, /NONE OF THIS PART IS A RECORDING/);
  assert.match(r.stdout, /SEALED\s+on this machine/);
  assert.match(r.stdout, /chain intact/);
  assert.match(r.stdout, /provenance\s+demo-replay/);
  assert.match(r.stdout, /no verdict\s+no judge ran here/);

  // the three bridge lines, and the free-ness said out loud
  assert.match(r.stdout, /receipt verify /);
  assert.match(r.stdout, /zero network calls/i);
  assert.match(r.stdout, /elapsed\s+\d/, 'the timing claim polices itself, and is on screen');

  assert.ok(!/at .*\.js:\d+/.test(r.stdout + r.stderr), 'no stack traces anywhere in the happy path');
});

test('the receipt the demo promises is really there afterwards, and verifies from outside', () => {
  const r = runDemo();
  assert.equal(r.status, 0);
  const m = r.stdout.match(/receipt verify (\S+\.jsonl)/);
  assert.ok(m, 'the ending names a real path');
  const file = m[1];
  assert.ok(fs.existsSync(file), 'the file exists at the path the stranger was given');

  const check = spawnSync(process.execPath, [CLI, 'receipt', 'verify', file], { encoding: 'utf8', timeout: 60000 });
  assert.equal(check.status, 0, 'the command we told them to run actually succeeds');
  assert.match(check.stdout, /VERIFIED/);
  assert.match(check.stdout, /demo-replay/, 'and it is honest about being a demo receipt');
});

test('demo receipts land outside any project, so cleanup can never delete them', () => {
  const { receiptsDir } = demoPaths('/home/someone');
  assert.match(receiptsDir.replace(/\\/g, '/'), /\/home\/someone\/\.praxis\/demo\/receipts$/);
  assert.ok(!receiptsDir.includes(process.cwd()), 'never inside the working directory');
});

test('speed is tunable so CI measures the real thing and tests do not sleep', () => {
  assert.equal(speedFactor({ PRAXIS_DEMO_SPEED: '0' }), 0);
  assert.equal(speedFactor({ PRAXIS_DEMO_SPEED: '1' }), 1);
  assert.equal(speedFactor({}), 0.55, 'default pacing is brisk enough to stay well inside the promise');
  assert.equal(speedFactor({ PRAXIS_DEMO_SPEED: 'nonsense' }), 0.55, 'garbage falls back rather than freezing the demo');
});

test('rendering: verdict words carry the meaning, not just the colour', () => {
  const line = renderClaim({ verdict: 'FALSE', claim: 'x', reasoning: 'y' });
  assert.match(line.replace(/\[[0-9;]*m/g, ''), /FALSE\s+x/, 'readable with colour stripped (NO_COLOR, light terminals)');
  // lowercase in the summary so the STATE COLUMN below stays the loudest thing
  // on screen; the words are still the words.
  assert.equal(summariseTotals({ TRUE: 2, FALSE: 1 }), '2 true · 1 false');
  assert.equal(summariseTotals({ NOT_A_CLAIM: 3 }), '3 not a claim');
});
