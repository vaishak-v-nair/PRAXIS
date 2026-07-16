// praxis telemetry — status | on | off | show. Radical transparency on the
// client: `show` prints the exact payload. This hides nothing the open-source
// code doesn't already reveal — and it's the proof behind the promise.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TELEMETRY_ENDPOINT, telemetryState, setTelemetry, payload } from '../lib/telemetry.js';
import { miniHeader, sage, grey, bold, dim, rose } from '../lib/ui.js';

function pkgVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

export function telemetry(args = []) {
  const sub = args[0];
  console.log('\n  ' + miniHeader(pkgVersion(), 'telemetry') + '\n');

  if (sub === 'on') {
    setTelemetry(true);
    console.log('  ' + sage('✓') + ' anonymous usage counts: ' + bold('on'));
  } else if (sub === 'off') {
    setTelemetry(false);
    console.log('  ' + sage('✓') + ' telemetry ' + bold('off') + ' — counters and install id wiped.');
  } else if (sub === 'show') {
    console.log('  The exact payload — everything PRAXIS would ever send:\n');
    console.log(
      JSON.stringify(payload(pkgVersion()), null, 2)
        .split('\n')
        .map((l) => '  ' + l)
        .join('\n'),
    );
    console.log('\n  ' + dim('Counts and codes only. Your code, your words, your files have no'));
    console.log('  ' + dim('field to fit in — that is by construction, not by filtering.'));
  } else {
    const s = telemetryState();
    console.log('  status   ' + (s.enabled ? sage('● on') : grey('○ off')) + (s.decided ? '' : grey('  (never asked)')));
    console.log('  sends    ' + (TELEMETRY_ENDPOINT ? 'at most once a day' : grey('nothing — no endpoint configured yet, nothing ever leaves')));
    console.log('  content  ' + 'your code and conversations are never collected — no exceptions');
    console.log('\n  ' + dim('praxis telemetry ') + rose('show') + dim('  the exact payload · ') + rose('on') + dim(' / ') + rose('off') + dim('  any time'));
  }
  console.log('');
}
