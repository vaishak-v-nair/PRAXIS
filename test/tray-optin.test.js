// The tray is opt-in per project as of 0.11.1.
//
// It used to start itself from `init`, one host per project, so anyone who ran
// PRAXIS in five repos got five axolotls by the clock without ever asking for
// one — and the only way to get rid of them was uninstalling PRAXIS from
// projects that were otherwise perfectly happy. These tests pin the two halves
// that make it a real switch: nothing starts unasked, and once you do ask, the
// answer survives the end of the session in both directions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { patchSettings, setTrayHook } from '../src/lib/settings.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-optin-'));
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const TRAY = /npx -y praxis-memory tray --ensure/;

test('a fresh install captures sessions and draws nothing', () => {
  const file = path.join(tmp(), 'settings.json');
  patchSettings(file);
  const s = read(file);
  assert.ok(s.hooks.Stop, 'capture is the point of PRAXIS, so it stays automatic');
  assert.ok(s.hooks.PreCompact);
  assert.equal(s.hooks.SessionStart, undefined, 'nothing puts an icon on screen unasked');
});

test('asking for the tray adds exactly one hook, however many times you ask', () => {
  const file = path.join(tmp(), 'settings.json');
  patchSettings(file, { tray: true });
  setTrayHook(file, true);
  setTrayHook(file, true);
  const s = read(file);
  assert.equal(s.hooks.SessionStart.length, 1);
  assert.match(JSON.stringify(s.hooks.SessionStart), TRAY);
  assert.equal(setTrayHook(file, true).already, true, 'a third ask is a no-op');
});

test('stopping the tray means stopped, not stopped-until-SessionStart', () => {
  const file = path.join(tmp(), 'settings.json');
  patchSettings(file, { tray: true });
  assert.match(JSON.stringify(read(file).hooks.SessionStart), TRAY);

  setTrayHook(file, false);
  const s = read(file);
  assert.equal(s.hooks.SessionStart, undefined, 'the hook that would bring it back is gone');
  assert.ok(s.hooks.Stop, 'and capture is untouched — you stopped an icon, not your memory');
  assert.equal(setTrayHook(file, false).already, true);
});

test('an old install can turn the tray off even if its hook is the legacy form', () => {
  // 0.9.0 and earlier wrote bare `praxis tray --ensure`. Someone upgrading and
  // then running --stop must actually get rid of it, not keep a command the
  // remover does not recognise.
  const file = path.join(tmp(), 'settings.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'praxis tray --ensure' }] }] } }),
  );
  setTrayHook(file, false);
  assert.equal(read(file).hooks, undefined, 'nothing of ours left, and no empty scaffolding either');
});

test('turning the tray off never disturbs hooks that are not ours', () => {
  const file = path.join(tmp(), 'settings.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'npx -y praxis-memory tray --ensure' }] },
          { hooks: [{ type: 'command', command: 'echo someone-elses-hook' }] },
        ],
      },
    }),
  );
  setTrayHook(file, false);
  const s = read(file);
  assert.equal(s.hooks.SessionStart.length, 1, 'the other hook survives on the same event');
  assert.match(JSON.stringify(s.hooks.SessionStart), /someone-elses-hook/);
  assert.doesNotMatch(JSON.stringify(s.hooks.SessionStart), TRAY);
});

test('a settings file we have never seen is created, not corrupted', () => {
  const file = path.join(tmp(), 'nested', 'settings.local.json');
  setTrayHook(file, true);
  assert.match(JSON.stringify(read(file).hooks.SessionStart), TRAY);
});
