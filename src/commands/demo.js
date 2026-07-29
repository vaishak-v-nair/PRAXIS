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
import { playBeats, sealAndVerify, speedFactor, renderClaim, summariseTotals, headlineTone, HEADLINE_W } from '../lib/demo/replay.js';
import { armedState, epilogueBlock, degradeMessage, classifyFsError, prettyPath } from '../lib/demo/epilogue.js';
import { runLive, boundaryLines, hasUnverifiable, LIVE_TASK_SUMMARY, liveTimeoutMs } from '../lib/demo/live.js';
import { startJob } from './run.js';
import { praxisCmd } from '../lib/runner.js';
import { miniHeader, bold, grey, sage, rose, amber, blue, dim, chip, rule, row, wrap, g, CONTENT, COL, CHIP_W } from '../lib/ui.js';

const pad = (n) => ' '.repeat(Math.max(0, n));

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

function mmss(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The last three lines, shared by both modes — one ending, written once.
 *
 * `offline` is not decoration. The replay genuinely makes zero network calls
 * and that is its strongest claim; live calls a model twice. The same sentence
 * would be a lie in one of the two modes, so it is a parameter.
 */
function closing({ receiptPath, displayPath, elapsedMs, agentDetected, suggestLive, cmd, offline = false }) {
  const b = epilogueBlock({
    receiptPath,
    displayPath,
    state: armedState(process.cwd()),
    agentDetected,
    suggestLive,
    cmd,
  });

  line('');
  line(g(row('elapsed', bold(`${(elapsedMs / 1000).toFixed(1)}s`) + (offline ? grey('   ·  nothing left your machine, zero network calls') : ''))));

  // The last thing on screen is the thing we want typed. It gets a section of
  // its own, and the command sits alone on its line at its own indent — never
  // wrapped, never sharing a line with prose it could be confused for.
  line('');
  line(g(rule('verify it yourself')));
  line(g(grey('offline · free · no account · no model call')));
  line('');
  line(g(pad(2) + bold(b.command)));
  line('');
  for (const l of wrap(b.state, CONTENT)) line(g(grey(l)));
  if (b.live) for (const l of wrap(b.live, CONTENT)) line(g(dim(l)));
  line('');
  line(g(dim('Your AI says "done." PRAXIS proves it.')));
  line('');
}

/**
 * Live mode's screen.
 *
 * Everything here is stated BEFORE it happens — where the work will go, that it
 * costs real tokens, and that the agent cannot reach the reader's project. A
 * demo that spends someone's money to prove it is trustworthy should at minimum
 * say so first.
 *
 * Returns `{exit}` when live carried the whole show, or `{reason, detail}` when
 * the caller should announce the degrade and fall back to the replay.
 */
async function playLive(cmd, pre, startedAt) {
  // Once a SIGINT listener exists Node stops exiting on Ctrl-C by itself, so
  // this handler owns the behavior: stop watching AND kill the agent.
  let aborted = false;
  const onSigint = () => {
    aborted = true;
  };
  process.on('SIGINT', onSigint);

  const tty = Boolean(process.stdout.isTTY);
  let ticking = false;
  let lastHeartbeat = 0;
  const clearTick = () => {
    if (tty && ticking) process.stdout.write('\r' + ' '.repeat(52) + '\r');
    ticking = false;
  };

  let res;
  try {
    res = await runLive({
      startJob,
      onEvent: (e) => {
        if (e.kind === 'start') {
          line(g(rule('live')));
          line(g(grey('a real agent · real work · a verdict nobody has seen yet')));
          line('');
          line(g(row('sandbox', e.sandbox)));
          line(g(row('task', LIVE_TASK_SUMMARY)));
          line(g(row('safety', 'writes files in that folder ONLY — your project is not touched')));
          line(g(row('cost', 'real tokens: one agent run, one judge call')));
          line(g(row('', dim(`gives up after ${mmss(liveTimeoutMs())} · Ctrl-C stops it`))));
          line('');
        } else if (e.kind === 'tick') {
          if (tty) {
            process.stdout.write('\r' + g(grey('working'.padEnd(COL)) + amber(mmss(e.elapsedMs))));
            ticking = true;
          } else if (e.elapsedMs - lastHeartbeat >= 20000) {
            // Piped or logged: the rewriting ticker is invisible, and four
            // silent minutes reads as a hang. Say something occasionally.
            lastHeartbeat = e.elapsedMs;
            line(g(row('working', amber(mmss(e.elapsedMs)))));
          }
        } else if (e.kind === 'sealed') {
          clearTick();
          line(g(chip('sealed', 'sage', CHIP_W) + '  ' + grey('from the agent’s own transcript — free, zero model calls')));
        } else if (e.kind === 'judging') {
          line(g(row('judging', grey('ruling its claims against that record…'))));
        }
      },
      waitOpts: { shouldAbort: () => aborted },
    });
  } catch (e) {
    // Live is the optional half. Whatever it hits, the reader gets a sentence
    // and the replay — never a stack trace, which is the one thing a stranger
    // reads as "this product is broken".
    return { reason: 'live-error', detail: (e && (e.code || e.message)) || null };
  } finally {
    clearTick();
    process.off('SIGINT', onSigint);
  }

  if (!res.ok) {
    // Ctrl-C means stop, not "play me a recording instead".
    if (res.reason === 'user-abort') {
      line('');
      line('  ' + grey('Stopped. The agent was killed; nothing outside ') + res.sandbox + grey(' was touched.'));
      line('');
      return { exit: 130 };
    }
    // The sandbox stays. It holds the job's own logs, which are the only
    // diagnostic a person has when live fails — deleting it to be tidy would
    // throw away the answer to "why?". It lives in temp; the OS sweeps it.
    return {
      reason: res.reason,
      detail: res.detail,
      note: grey('what live left behind, if you want to look: ') + path.join(res.sandbox, '.praxis', 'jobs'),
    };
  }

  const r = res.receipt;
  const shown = prettyPath(r.file, os.homedir());
  const v = r.verification;

  line('');
  line(g(rule('none of this was a recording')));
  line('');
  line(g(chip('sealed', 'sage', CHIP_W) + '  ' + bold('on this machine') + '  ' + grey(shown)));
  if (v.ok) {
    line(g(chip('verified', 'sage', CHIP_W) + '  ' + bold('chain intact · signature valid')));
    for (const l of wrap(`${v.entries} entries, checked offline just now — no network, no model call`, CONTENT - COL)) {
      line(g(pad(COL) + dim(l)));
    }
  } else {
    line(g(chip('unverified', 'rose', CHIP_W) + '  ' + bold(v.reason || 'verification failed')));
  }
  line('');
  line(g(row('provenance', grey(`${r.provenance} — sealed in, the demo’s work, never yours`))));

  if (res.judged) {
    const s = r.summary || {};
    const totals = {};
    if (s.true) totals.TRUE = s.true;
    if (s.false) totals.FALSE = s.false;
    if (s.unverifiable) totals.UNVERIFIABLE = s.unverifiable;
    line('');
    line(g(rule('judged')));
    line(g(sage('ruled just now') + grey(' · on this machine, minutes old')));
    line('');
    line(g(chip(r.verdict, headlineTone(r.verdict), HEADLINE_W) + '  ' + grey(summariseTotals(totals))));
    line('');
    for (const c of r.verdicts) {
      line(renderClaim({ claim: c.claim, verdict: c.verdict, reasoning: c.reasoning }));
      line('');
    }
    line(g(rule('what that verdict is, exactly')));
    for (const l of boundaryLines({ hadUnverifiable: hasUnverifiable(r.verdicts) })) {
      const w = wrap(l, CONTENT - 2);
      line(g(blue('·') + ' ' + grey(w[0])));
      for (const rest of w.slice(1)) line(g('  ' + grey(rest)));
    }
  } else {
    // The agent worked and the receipt is real; only the ruling is missing.
    // Falling back to a recording here would trade proof for theatre.
    line('');
    line(g(row('no verdict', amber(res.judgeError || 'the judge could not be reached'))));
    for (const l of wrap('None was invented. The receipt above is still real, still sealed, still verifiable — evidence does not need the judge.', CONTENT - COL)) {
      line(g(pad(COL) + grey(l)));
    }
  }

  line('');
  line(g(row('the work', grey(res.sandbox))));
  line(g(pad(COL) + dim('still there if you want to read what the agent actually wrote')));

  closing({
    receiptPath: r.file,
    displayPath: shown,
    elapsedMs: Date.now() - startedAt,
    agentDetected: pre.canLive,
    suggestLive: false, // they just watched it
    cmd,
  });
  return { exit: v.ok ? 0 : 1 };
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
    // Live routes through the same job engine `praxis run` uses (D33) — no
    // second way to spawn an agent, so the demo cannot show a path the product
    // does not have. When it cannot finish, it names why and the replay takes
    // over in the open.
    const r = await playLive(cmd, pre, started);
    if (r.exit !== undefined) return r.exit;
    line('  ' + amber('· ') + degradeMessage(r.reason, r.detail, cmd));
    if (r.note) line('  ' + dim(r.note));
    line('');
  }

  // ── the recording ────────────────────────────────────────────────────────
  const loaded = loadCorpus();
  if (!loaded.ok) return floorExit(loaded.reason, loaded.detail, cmd);
  const corpus = loaded.corpus;

  line(g(rule('replay')));
  line(g(grey(`a real session · ${corpus.source.project} · ${String(corpus.recordedAt).slice(0, 10)}`)));
  line(g(dim('nothing here reaches the network')));
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

  // ── the seal moment ──────────────────────────────────────────────────────
  // The visual peak, and the frame the README GIF loops from — so a scroller
  // meets proof first. The order is fixed by the launch spec (D96): seal block,
  // then the verification state, then the recorded-verdict label ADJACENT to it
  // and never as a footnote, then elapsed, then the command to check it.
  line('');
  line(g(rule('none of this part is a recording')));
  line('');
  // Every chip padded to one width, so the text beside them lands on the same
  // column as the labelled rows below — one edge down the whole block.
  line(g(chip('sealed', 'sage', CHIP_W) + '  ' + bold('on this machine') + '  ' + grey(shown)));
  if (v.ok) {
    line(g(chip('verified', 'sage', CHIP_W) + '  ' + bold('chain intact · signature valid')));
    for (const l of wrap(`${v.entries} entries, checked offline just now — no network, no model call`, CONTENT - COL)) {
      line(g(pad(COL) + dim(l)));
    }
  } else {
    // Sealing succeeded but verification did not: say so rather than claim it.
    line(g(chip('unverified', 'rose', CHIP_W) + '  ' + bold(v.reason || 'verification failed')));
  }
  line('');
  line(g(amber('recorded'.padEnd(COL)) + grey('the verdicts above are a replay of a real run')));
  line(g(row('provenance', grey('demo-replay — sealed in, never counts as real work'))));
  line(g(row('no verdict', grey('no judge ran here, and a verdict is never invented'))));

  // ── the bridge ───────────────────────────────────────────────────────────
  closing({
    receiptPath: sealed.file, // absolute — this one gets pasted
    displayPath: shown,
    elapsedMs: Date.now() - started,
    agentDetected: pre.canLive,
    cmd,
    offline: true,
  });

  return v.ok ? 0 : 1;
}
