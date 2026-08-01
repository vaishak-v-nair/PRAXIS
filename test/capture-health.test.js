// Does PRAXIS notice when PRAXIS breaks?
//
// `capture` runs on the Stop hook of every session on every install, and it
// swallows every error so it can never take a session down with it. That is
// correct and it stays. What was missing is the other half: a swallowed error
// left no trace anywhere, so a broken capture and a working one were
// indistinguishable — memory just quietly stopped growing, and `praxis doctor`
// went on reporting green because all it could check was that the hook string
// was present in a settings file.
//
// These tests are about the difference between "installed" and "ran".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordError, readLastError, clearLastError, ifMissing, swallow, ERROR_FILE } from '../src/lib/errors.js';
import { writeState, readState } from '../src/lib/state.js';
import { captureVerdict, CAPTURE_IDLE_MS, CAPTURE_MISSED_SESSIONS } from '../src/lib/doctor.js';

const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-caphealth-'));
  fs.mkdirSync(path.join(d, '.praxis'), { recursive: true });
  return path.join(d, '.praxis');
};

test('a swallowed error leaves evidence, and the evidence names the phase', () => {
  const dir = tmp();
  assert.equal(readLastError(dir), null, 'nothing to report on a healthy install');

  const err = new Error('ERR_STRING_TOO_LONG');
  err.code = 'ERR_STRING_TOO_LONG';
  assert.equal(recordError(dir, 'transcript-read', err), true);

  const got = readLastError(dir);
  assert.equal(got.phase, 'transcript-read', 'WHERE it broke, not just that it did');
  assert.equal(got.message, 'ERR_STRING_TOO_LONG');
  assert.equal(got.code, 'ERR_STRING_TOO_LONG');
  assert.ok(got.stack.includes('Error'), 'and enough stack to act on');
  assert.ok(Date.parse(got.at) > 0, 'and when');
});

test('recording never throws, whatever it is handed', () => {
  // It is called from inside catch blocks on the hook path. If it can throw, it
  // has turned "capture failed quietly" into "capture crashed the session" —
  // strictly worse than the bug it exists to fix.
  const dir = tmp();
  assert.doesNotThrow(() => recordError(dir, 'x', 'a string, not an Error'));
  assert.equal(readLastError(dir).message, 'a string, not an Error');
  assert.doesNotThrow(() => recordError(dir, 'x', null));
  assert.doesNotThrow(() => recordError(dir, 'x', { weird: true }));
  assert.doesNotThrow(() => recordError(path.join(dir, 'does', 'not', 'exist'), 'x', new Error('y')));
  assert.equal(recordError(path.join(dir, 'nope'), 'x', new Error('y')), false, 'and says it could not');
});

test('a later clean run clears the fault — a permanent alarm is not an alarm', () => {
  // The same reasoning that took memory-fill off the tray glow: an alarm that
  // can never clear gets ignored, and then it protects nothing.
  const dir = tmp();
  recordError(dir, 'vault-mirror', new Error('drive not mounted'));
  assert.ok(readLastError(dir));
  clearLastError(dir);
  assert.equal(readLastError(dir), null);
  assert.equal(fs.existsSync(path.join(dir, ERROR_FILE)), false);
  assert.doesNotThrow(() => clearLastError(dir), 'clearing nothing is fine');
});

test('a corrupt breadcrumb reads as no breadcrumb, never as a crash', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, ERROR_FILE), '{not json');
  assert.equal(readLastError(dir), null);
  fs.writeFileSync(path.join(dir, ERROR_FILE), '{"no":"phase"}');
  assert.equal(readLastError(dir), null, 'a shape we did not write is not our record');
});

test('the state breadcrumb is a two-phase liveness signal', () => {
  const dir = tmp();
  assert.equal(readState(dir), null);

  writeState(dir, 'restored');
  const s = readState(dir);
  assert.equal(s.phase, 'restored');
  assert.ok(s.ageMs < 5000, 'and it knows how old it is');

  fs.writeFileSync(path.join(dir, 'state.json'), '{"phase":"switching","ts":"not a date"}');
  assert.equal(readState(dir).ageMs, Infinity, 'an unparseable timestamp is infinitely old, not zero');
});

test('ifMissing and swallow are the two meanings, told apart', () => {
  // 81 silent catches across src/, and until now nothing distinguished "this
  // file legitimately is not here yet" from "something broke and I am hiding
  // it". These are those two sentences, written down.
  const dir = tmp();

  assert.equal(ifMissing(() => JSON.parse('{"a":1}').a), 1, 'the happy path just returns');
  assert.equal(ifMissing(() => JSON.parse('nope'), 'default'), 'default', 'an absence yields the fallback');
  assert.equal(ifMissing(() => { throw new Error('x'); }), null, 'and null when no fallback is named');
  assert.equal(readLastError(dir), null, 'an EXPECTED absence records nothing — that is the whole difference');

  assert.equal(swallow(() => 'fine', { praxisDir: dir, phase: 'p' }), 'fine');
  assert.equal(readLastError(dir), null, 'a success records nothing either');

  const out = swallow(() => { throw new Error('drive not mounted'); }, { praxisDir: dir, phase: 'vault-mirror', fallback: 'kept going' });
  assert.equal(out, 'kept going', 'the caller still gets a usable value');
  const rec = readLastError(dir);
  assert.equal(rec.phase, 'vault-mirror', 'but the failure is on the record');
  assert.match(rec.message, /drive not mounted/);
});

test('swallow without a praxisDir still refuses to throw', () => {
  // Called from paths that may run outside a project at all.
  assert.equal(swallow(() => { throw new Error('x'); }, { fallback: 7 }), 7);
  assert.doesNotThrow(() => swallow(() => { throw new Error('x'); }));
});

// ── the verdict ──────────────────────────────────────────────────────────────

test('a recorded failure is reported, with the phase and a fix', () => {
  const v = captureVerdict({
    lastError: { phase: 'transcript-read', message: 'EACCES: permission denied', at: '2026-08-01T05:00:00.000Z' },
  });
  assert.equal(v.ok, false);
  assert.match(v.detail, /transcript-read/);
  assert.match(v.detail, /permission denied/, 'the actual error, not "something went wrong"');
  assert.ok(v.fix, 'and something to do about it');
});

test('a capture that started and never finished is caught', () => {
  // 'switching' is written first and 'restored' last, both unconditionally. An
  // old 'switching' means the loop died in the middle — the single thing a
  // swallowed error could never tell anyone.
  const stuck = captureVerdict({ state: { phase: 'switching', ts: 'x', ageMs: CAPTURE_IDLE_MS + 1000 } });
  assert.equal(stuck.ok, false);
  assert.match(stuck.detail, /started and never finished/);

  const inFlight = captureVerdict({ state: { phase: 'switching', ts: 'x', ageMs: 1000 } });
  assert.equal(inFlight.ok, true, 'a capture running RIGHT NOW is not a fault');
});

test('finished sessions with no capture are a pattern; one is not', () => {
  const one = captureVerdict({ state: { phase: 'restored', ts: 'x', ageMs: 60000 }, missedSessions: 1 });
  assert.equal(one.ok, true, 'a single session that wrote nothing is ordinary — capture skips empty ones by design');

  const several = captureVerdict({
    state: { phase: 'restored', ts: 'x', ageMs: 60000 },
    missedSessions: CAPTURE_MISSED_SESSIONS,
  });
  assert.equal(several.ok, false);
  assert.match(several.detail, /installed but not running/, 'names the difference between wired and working');
  assert.match(several.fix, /Restart Claude Code/);
});

test('a healthy install says when it last ran, and a fresh one is not a fault', () => {
  const healthy = captureVerdict({ state: { phase: 'restored', ts: 'x', ageMs: 3 * 60000 } });
  assert.equal(healthy.ok, true);
  assert.match(healthy.detail, /3 m ago/);

  const hours = captureVerdict({ state: { phase: 'restored', ts: 'x', ageMs: 5 * 3600 * 1000 } });
  assert.match(hours.detail, /5 h ago/);

  const brandNew = captureVerdict({ state: null, hasSessions: false });
  assert.equal(brandNew.ok, true, 'a project that has never had a session is not broken');
  assert.match(brandNew.detail, /no sessions/);

  const waiting = captureVerdict({ state: null, hasSessions: true });
  assert.equal(waiting.ok, true);
  assert.match(waiting.detail, /next session that ends/);
});

test('an error outranks everything else — the loudest true thing wins', () => {
  const v = captureVerdict({
    lastError: { phase: 'receipt-seal', message: 'EROFS', at: '2026-08-01T05:00:00.000Z' },
    state: { phase: 'restored', ts: 'x', ageMs: 1000 },
    missedSessions: 0,
  });
  assert.equal(v.ok, false, 'a recent clean-looking state does not bury a real failure');
  assert.match(v.detail, /receipt-seal/);
});

test('every unhealthy verdict carries a fix, every healthy one carries none', () => {
  const unhealthy = [
    captureVerdict({ lastError: { phase: 'p', message: 'm', at: 'now' } }),
    captureVerdict({ state: { phase: 'switching', ts: 'x', ageMs: CAPTURE_IDLE_MS * 2 } }),
    captureVerdict({ state: { phase: 'restored', ts: 'x', ageMs: 1 }, missedSessions: 5 }),
  ];
  for (const v of unhealthy) {
    assert.equal(v.ok, false);
    assert.equal(v.id, 'capture');
    assert.ok(v.fix && v.fix.length > 20, `"${v.detail}" tells the reader what to type`);
  }
  assert.equal(captureVerdict({ state: { phase: 'restored', ts: 'x', ageMs: 1 } }).fix, null);
});
