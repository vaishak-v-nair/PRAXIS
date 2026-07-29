// "Did you mean" — a wrong suggestion is worse than none, so both directions
// are held: real typos get the right command, and gibberish gets silence
// rather than a guess wearing confidence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { distance, didYouMean } from '../src/lib/suggest.js';

const CLI = path.resolve('src', 'cli.js');
const COMMANDS = ['init', 'status', 'receipt', 'recap', 'remember', 'health', 'jobs', 'approve', 'demo', 'doctor', 'help', 'forget'];

test('distance counts a transposition as the single edit it is', () => {
  assert.equal(distance('status', 'status'), 0);
  assert.equal(distance('stauts', 'status'), 1, 'swapped letters ARE the typo');
  assert.equal(distance('jobz', 'jobs'), 1);
  assert.equal(distance('demo', 'demoo'), 1);
  assert.equal(distance('', 'demo'), 4);
});

test('the typos people actually make land on the command they meant', () => {
  assert.equal(didYouMean('stauts', COMMANDS), 'status');
  assert.equal(didYouMean('recieve', COMMANDS), 'receipt', 'three edits, but the shared opening is the tell');
  assert.equal(didYouMean('aprove', COMMANDS), 'approve');
  assert.equal(didYouMean('helth', COMMANDS), 'health');
  assert.equal(didYouMean('demoo', COMMANDS), 'demo');
  assert.equal(didYouMean('RECAP', COMMANDS), 'recap', 'case is not a typo');
});

test('gibberish gets no suggestion — silence beats a confident wrong guess', () => {
  assert.equal(didYouMean('qwxzv', COMMANDS), null);
  assert.equal(didYouMean('', COMMANDS), null);
  assert.equal(didYouMean(undefined, COMMANDS), null);
});

test('an unknown command answers in two lines, not thirty-eight', () => {
  const r = spawnSync(process.execPath, [CLI, 'recieve'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1, 'a miss still exits non-zero for scripts');
  assert.match(r.stdout, /did you mean/);
  assert.match(r.stdout, /receipt/);
  assert.match(r.stdout, /help/, 'the full help stays one named command away');
  assert.ok(!/The daily four/.test(r.stdout), 'and is not dumped uninvited');
  assert.ok(r.stdout.trim().split('\n').length <= 3, 'the answer is sized to the mistake');
});

test('an unknown command with no near match still points somewhere real', () => {
  const r = spawnSync(process.execPath, [CLI, 'qwxzv'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1);
  assert.ok(!/did you mean/.test(r.stdout), 'no guess wearing confidence');
  assert.match(r.stdout, /Unknown command: qwxzv/);
  assert.match(r.stdout, /help/);
});
