// The two tray-host decisions that were getting made wrong, pinned.
//
// Both of these were reproduced against the real thing before they were fixed:
// a sacrificial process was killed by `praxis tray` because its pid happened to
// be in a pidfile, and six alternating `tray --ensure` invocations against one
// project produced four different host pids. These tests are that pressure
// test, made cheap enough to run on every commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePidFile, isHostCommandLine, compareVersions, shouldRestage } from '../src/lib/tray-host.js';

const WIN =
  '"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass ' +
  '-WindowStyle Hidden -File E:\\PA\\.praxis\\tray\\tray.ps1 -ProjectRoot E:\\PA ' +
  '-IconDir E:\\PA\\.praxis\\tray\\icons -PidFile E:\\PA\\.praxis\\tray\\tray.pid';

test('a pidfile yields a pid, or nothing it could mistake for one', () => {
  assert.equal(parsePidFile('26996\n'), 26996);
  assert.equal(parsePidFile('  4300  '), 4300);
  assert.equal(parsePidFile('{"pid":881}'), 881);
  for (const junk of ['', '   ', null, undefined, 'nope', '0', '-5', '{bad json']) {
    assert.equal(parsePidFile(junk), 0, `${JSON.stringify(junk)} must not become a kill target`);
  }
});

test('a tray host is recognised by its own project root, not by its pid', () => {
  assert.ok(isHostCommandLine(WIN, 'E:\\PA'));
  assert.ok(isHostCommandLine(WIN, 'E:/PA'), 'separator style is not identity');
  assert.ok(isHostCommandLine(WIN, 'e:\\pa'), 'Windows paths are case-insensitive');
  assert.ok(isHostCommandLine(WIN, 'E:\\PA\\'), 'a trailing separator is not identity either');
});

test('a project root is never confused with one that merely starts the same way', () => {
  // substring matching would make E:\PA the owner of E:\PA2's host, and
  // `praxis tray --stop` in one project would kill the other project's tray
  assert.equal(isHostCommandLine(WIN, 'E:\\PA2'), false);
  assert.equal(isHostCommandLine(WIN, 'E:\\P'), false);
  assert.equal(isHostCommandLine(WIN, 'E:\\PRAXIS'), false);
});

test('anything that is not a tray host is never a kill target', () => {
  // this is the bug: a recycled pid belonging to an editor, a database, or a
  // security agent used to be force-killed along with its whole process tree
  assert.equal(isHostCommandLine('powershell.exe -NoProfile -Command Start-Sleep -Seconds 400', 'E:\\PA'), false);
  assert.equal(isHostCommandLine('C:\\Program Files\\Editor\\editor.exe E:\\PA', 'E:\\PA'), false);
  assert.equal(isHostCommandLine('node server.js', 'E:\\PA'), false);
  for (const empty of ['', null, undefined]) {
    assert.equal(isHostCommandLine(empty, 'E:\\PA'), false, 'an unreadable command line means do not kill');
    assert.equal(isHostCommandLine(WIN, empty), false);
  }
});

test('a project path containing spaces still identifies its own host', () => {
  const spaced =
    'powershell.exe -File "E:\\AI Coding\\proj\\.praxis\\tray\\tray.ps1" -ProjectRoot "E:\\AI Coding\\proj" -IconDir x';
  assert.ok(isHostCommandLine(spaced, 'E:\\AI Coding\\proj'));
  assert.equal(isHostCommandLine(spaced, 'E:\\AI'), false, 'a quoted path is one argument, not two');
});

test('the macOS host answers to the same check', () => {
  const mac = '/usr/bin/osascript -l JavaScript /Users/x/p/.praxis/tray/tray-mac.js /Users/x/p /Users/x/p/.praxis/tray/icons-mac';
  assert.ok(isHostCommandLine(mac, '/Users/x/p'));
  assert.equal(isHostCommandLine(mac, '/Users/x'), false);
});

test('versions compare on the ladder, not as strings', () => {
  assert.equal(compareVersions('0.11.0', '0.10.0'), 1);
  assert.equal(compareVersions('0.9.3', '0.10.0'), -1, '9 is not greater than 10');
  assert.equal(compareVersions('0.11.0', '0.11.0'), 0);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  assert.equal(compareVersions('0.12.0-beta.1', '0.12.0'), 0, 'prerelease tags are not the ladder');
  assert.equal(compareVersions('0.11', '0.11.0'), 0);
  assert.equal(compareVersions(undefined, '0.1.0'), -1, 'an unstamped stage is the oldest thing there is');
});

test('two installs on one machine cannot take turns restaging', () => {
  // The live case: the SessionStart hook runs `npx -y praxis-memory tray
  // --ensure` while a global `praxis` sits at an older version. Byte-comparison
  // made each one undo the other on every invocation, and every undo
  // force-killed a host and leaked its tray icon.
  const published = { version: '0.11.0', sha256: 'aaa' };
  const older = { version: '0.10.0', sha256: 'bbb' };

  const staged = { version: published.version, sha256: published.sha256 };
  assert.equal(shouldRestage({ staged, incoming: older, explicit: false }), false, 'an older install passing through leaves it alone');
  assert.equal(shouldRestage({ staged, incoming: published, explicit: false }), false, 'and the same one has nothing to do');

  // run it as the loop would have run it: alternating, many times
  let current = { ...staged };
  let restages = 0;
  for (let i = 0; i < 20; i++) {
    const incoming = i % 2 ? older : published;
    if (shouldRestage({ staged: current, incoming, explicit: false })) {
      current = { ...incoming };
      restages++;
    }
  }
  assert.equal(restages, 0, 'twenty automatic invocations, zero kills');
});

test('an upgrade still reaches the tray, automatically', () => {
  const staged = { version: '0.10.0', sha256: 'bbb' };
  assert.ok(shouldRestage({ staged, incoming: { version: '0.11.0', sha256: 'ccc' }, explicit: false }));
});

test('typing the command wins over the version ladder', () => {
  // a person running `praxis tray` from a dev tree is asking for THAT script,
  // even though its package version matches what is already staged
  const staged = { version: '0.11.0', sha256: 'published' };
  const dev = { version: '0.11.0', sha256: 'unreleased-fix' };
  assert.equal(shouldRestage({ staged, incoming: dev, explicit: false }), false, "not behind the hook's back");
  assert.equal(shouldRestage({ staged, incoming: dev, explicit: true }), true, 'but yes when asked');
});

test('a stage with no stamp is adopted once, then left alone', () => {
  // upgrading from a praxis that never wrote staged.json
  const incoming = { version: '0.12.0', sha256: 'ddd' };
  assert.ok(shouldRestage({ staged: null, incoming, explicit: false }));
  assert.ok(shouldRestage({ staged: { version: '0.12.0' }, incoming, explicit: false }), 'a stamp without a hash is not a stamp');
  assert.equal(shouldRestage({ staged: { ...incoming }, incoming, explicit: false }), false);
});
