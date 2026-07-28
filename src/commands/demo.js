// `praxis demo` — ninety seconds from "never heard of it" to holding proof.
//
// Two modes. Replay is the guarantee: it needs no agent, no account, no
// network, and it ends with a signed receipt on the stranger's own disk. Live
// is the upgrade, offered only when the machine can actually do it.
//
// The command is thin on purpose — the recording, the sealing and the copy all
// live in lib/demo/, so the same logic can be driven by a test, a CI smoke job
// or a future UI without any of them re-implementing the honest bits.

import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { demoPaths } from '../lib/paths.js';
import { preflight } from '../lib/doctor.js';
import { loadCorpus } from '../lib/demo/corpus.js';
import { playBeats, sealAndVerify, speedFactor } from '../lib/demo/replay.js';
import { armedState, epilogueLines, degradeMessage, classifyFsError, prettyPath } from '../lib/demo/epilogue.js';
import { praxisCmd } from '../lib/runner.js';
import { miniHeader, bold, grey, sage, rose, amber, dim } from '../lib/ui.js';

function line(s = '') {
  process.stdout.write(s + '\n');
}

function version() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8')).version;
  } catch {
    return '';
  }
}

/** The floor: replay itself cannot run. Named reason, pointer, non-zero exit. */
function floorExit(cls, detail, cmd) {
  line('');
  line('  ' + rose('The demo could not run.'));
  line('  ' + degradeMessage(cls, detail, cmd));
  line('');
  return 1;
}

export async function demo(argv = []) {
  const cmd = praxisCmd();
  const wantsLive = argv.includes('--live');
  const forceReplay = argv.includes('--replay');
  const started = Date.now();

  line('');
  line('  ' + miniHeader(version(), 'demo'));
  line('');

  // One probe, reused: preflight shells out to find agent CLIs, and doing it
  // twice makes the demo measurably slower for no new information.
  const pre = preflight(process.cwd());

  // ── mode selection ───────────────────────────────────────────────────────
  // Live is offered only when the machine can really do it. When it cannot,
  // the reason is stated — a silent fallback would teach the stranger that
  // PRAXIS quietly does something other than what it said.
  let mode = 'replay';
  if (wantsLive && !forceReplay) {
    if (pre.canLive) {
      mode = 'live';
    } else {
      const blocker = pre.blockers[0];
      line('  ' + amber('· ') + degradeMessage(blocker?.id === 'agent-cli' ? 'no-agent-cli' : 'unwritable', null, cmd));
      line('');
    }
  }

  if (mode === 'live') {
    // Live mode routes through the existing job engine rather than growing a
    // second way to spawn an agent. It is not wired yet, and saying so is
    // better than pretending: replay is the guaranteed path and always was.
    line('  ' + amber('· ') + 'Live mode is not available in this build yet. Running the recorded replay instead.');
    line('');
  }

  // ── the recording ────────────────────────────────────────────────────────
  const loaded = loadCorpus();
  if (!loaded.ok) return floorExit(loaded.reason, loaded.detail, cmd);
  const corpus = loaded.corpus;

  line('  ' + dim(`Replay of a real run — ${corpus.source.project}, ${String(corpus.recordedAt).slice(0, 10)}.`));
  line('  ' + dim('Nothing here reaches the network.'));
  line('');

  await playBeats(corpus, { speed: speedFactor() });

  // ── the part that is not a recording ─────────────────────────────────────
  const { receiptsDir } = demoPaths();
  let sealed;
  try {
    sealed = sealAndVerify(receiptsDir, corpus, {
      sessionId: `demo-${Date.now()}`,
      now: new Date().toISOString(),
    });
  } catch (e) {
    return floorExit(classifyFsError(e), e && e.code ? e.code : null, cmd);
  }

  const v = sealed.verification;
  const shown = prettyPath(sealed.file, os.homedir());

  line('');
  line('  ' + bold('And now the part that is not a recording.'));
  line('');
  line('  ' + sage('◆') + ' ' + bold('Receipt sealed on this machine') + '  ' + grey(shown));
  if (v.ok) {
    line('  ' + sage('✓') + ' chain intact · signature valid   ' + grey(`${v.entries} entries, verified offline just now`));
  } else {
    // Sealing succeeded but verification did not: say so rather than claim it.
    line('  ' + rose('✗') + ' verification failed   ' + grey(v.reason || 'unknown reason'));
  }
  line('  ' + amber('·') + ' provenance: demo-replay   ' + grey('sealed into the record, so this can never count as real work'));
  line('  ' + grey('  no verdict — no judge ran here, and a verdict is never invented.'));
  line('       ' + dim('The rulings above came from the original run. This receipt is evidence only.'));

  // ── the bridge ───────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const lines = epilogueLines({
    receiptPath: sealed.file, // absolute — this one gets pasted
    displayPath: shown,
    state: armedState(process.cwd()),
    agentDetected: pre.canLive,
    cmd,
  });

  line('');
  line('  ' + sage(`Sealed and verified in ${elapsed}s.`) + grey('  Nothing left your machine — zero network calls.'));
  line('');
  for (const l of lines) line('  ' + l);
  line('');
  line('  ' + dim('Your AI says "done." PRAXIS proves it.'));
  line('');

  return v.ok ? 0 : 1;
}
