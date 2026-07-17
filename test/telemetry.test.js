import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// isolate telemetry state from the real machine BEFORE the module loads
process.env.PRAXIS_TELEMETRY_FILE = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-tel-')),
  'telemetry.json',
);
const { telemetryState, setTelemetry, record, payload, TELEMETRY_ENDPOINT, TELEMETRY_KEY } =
  await import('../src/lib/telemetry.js');

test('telemetry is opt-in: nothing recorded before consent', () => {
  record('cmd_status');
  assert.deepEqual(telemetryState().counts, {});
});

test('opt-in records enum-shaped keys only; opt-out wipes everything', () => {
  setTelemetry(true);
  record('cmd_status');
  record('cmd_status');
  record('cmd_hud');
  record('rm -rf / attempted injection'); // not enum-shaped → dropped
  record('E:\\secret\\path.js'); // not enum-shaped → dropped
  const s = telemetryState();
  assert.equal(s.counts.cmd_status, 2);
  assert.equal(s.counts.cmd_hud, 1);
  assert.equal(Object.keys(s.counts).length, 2, 'malformed keys never land');
  assert.ok(s.id, 'install id exists while opted in');

  setTelemetry(false);
  const off = telemetryState();
  assert.deepEqual(off.counts, {}, 'opt-out wipes counters');
  assert.equal(off.id, null, 'opt-out wipes identity');
});

test('SCHEMA GUARD: payload is structurally incapable of carrying content', () => {
  setTelemetry(true);
  record('cmd_switch');
  const p = payload('0.6.0');
  // every value must be a number, null, or a short enum-shaped string —
  // adding any content-capable field is a policy violation, not a feature
  const SAFE_STRING = /^[a-zA-Z0-9._-]{0,40}$/;
  function walk(node, trail) {
    if (node === null || typeof node === 'number') return;
    if (typeof node === 'string') {
      assert.match(node, SAFE_STRING, `content-capable string at ${trail}: "${node}"`);
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        assert.match(k, /^[a-z0-9_]{1,40}$/i, `non-enum key at ${trail}.${k}`);
        walk(v, trail + '.' + k);
      }
      return;
    }
    assert.fail(`unexpected type ${typeof node} at ${trail}`);
  }
  walk(p, 'payload');
});

test('the package ships a URL and zero credentials', () => {
  assert.match(TELEMETRY_ENDPOINT, /^$|^https:\/\//, 'endpoint is empty or https');
  assert.ok(!TELEMETRY_ENDPOINT.includes('supabase.co'), 'never talks to storage directly');
  assert.equal(TELEMETRY_KEY, '', 'no key of any kind ships in the public client');
});
