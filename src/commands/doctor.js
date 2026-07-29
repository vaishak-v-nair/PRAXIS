// `praxis doctor` — the thin presenter. All the knowing lives in lib/doctor.js;
// this file only decides how it reads on a terminal.
//
// It exists because the demo's failure paths NAME it ("run praxis doctor"), and
// a pointer to a command that does not exist is worse than no pointer at all.
// Every failing line carries the fix underneath it, indented, so the reader's
// next action is on screen instead of in a doc.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChecks, summarize } from '../lib/doctor.js';
import { wantsJson, emitJson } from '../lib/jsonout.js';
import { miniHeader, sage, red, amber, bold, grey, dim } from '../lib/ui.js';

function pkgVersionSafe() {
  // the version belongs in the report: it is the first thing anyone asks in a
  // bug thread. Read from the manifest, not npm_package_version, which is only
  // set when npm launched us — and the presenter must render regardless.
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8')).version;
  } catch {
    return '';
  }
}

export function doctor(argv = []) {
  const quiet = argv.includes('--quiet');
  const results = runChecks(process.cwd());
  const s = summarize(results);

  if (wantsJson(argv)) {
    // The checks are already data ({id, label, ok, detail, fix}); the human
    // path below is a rendering of exactly this, so the two cannot disagree.
    emitJson({ ok: s.failed.length === 0, version: pkgVersionSafe(), total: s.total, passed: s.passed, checks: results });
    return s.failed.length === 0 ? 0 : 1;
  }

  if (!quiet) console.log('\n  ' + miniHeader(pkgVersionSafe(), 'doctor') + '\n');

  for (const r of results) {
    const mark = r.ok ? sage('✓') : red('✗');
    const detail = r.detail ? grey(' — ' + r.detail) : '';
    console.log(`  ${mark} ${bold(r.label)}${detail}`);
    if (!r.ok && r.fix) console.log(`      ${amber('fix')} ${r.fix}`);
  }

  console.log('');
  if (s.failed.length === 0) {
    console.log('  ' + sage(`All ${s.total} checks passed.`) + grey(' PRAXIS is set up correctly here.'));
    console.log('  ' + dim('Nothing here reached the network. This is a local read of your own machine.') + '\n');
    return 0;
  }

  const word = s.failed.length === 1 ? 'check needs' : 'checks need';
  console.log('  ' + bold(`${s.failed.length} ${word} attention`) + grey(` · ${s.passed} of ${s.total} passed`));
  console.log('  ' + dim('Each fix above is a command you can run or a link you can open.') + '\n');
  return 1;
}
