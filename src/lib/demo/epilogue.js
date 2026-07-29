// What the demo says at the end, and what it says when something goes wrong.
//
// Both are pure functions over state, because both are load-bearing copy. The
// ending is the only moment a stranger decides whether PRAXIS is for them, and
// the failure lines are the only thing standing between a broken machine and a
// stack trace.

import fs from 'node:fs';
import path from 'node:path';
import { projectPaths } from '../paths.js';

/**
 * Is this project actually going to seal receipts on its own?
 *
 * The demo used to end with one cheerful line about "your next session". For a
 * stranger who ran the demo before installing anything, that line was simply
 * false. So the ending reads the real state and says the true thing.
 *
 * @returns {'not-initialized'|'just-initialized'|'armed'}
 */
export function armedState(cwd = process.cwd()) {
  const p = projectPaths(cwd);
  if (!fs.existsSync(p.praxisDir)) return 'not-initialized';
  try {
    const hasReceipts = fs.existsSync(p.receiptsDir) && fs.readdirSync(p.receiptsDir).some((f) => f.endsWith('.jsonl'));
    return hasReceipts ? 'armed' : 'just-initialized';
  } catch {
    return 'just-initialized';
  }
}

/** The state-aware middle line of the ending. */
export function armedLine(state, cmd = 'npx praxis-memory') {
  switch (state) {
    case 'armed':
      return `Your own sessions already seal receipts automatically — \`${cmd} receipt\` reads the latest.`;
    case 'just-initialized':
      return `PRAXIS is set up here — your receipts start sealing from your next session.`;
    default:
      return `Run \`${cmd}\` in a project to arm this for your own sessions.`;
  }
}

/**
 * The three closing lines, in order. Nothing here over-claims: the receipt is
 * real and on disk, the verdict on screen was a recording, and the offline
 * check costs nothing.
 */
export function epilogueLines({ receiptPath, displayPath, state, agentDetected, suggestLive, cmd = 'npx praxis-memory' }) {
  const b = epilogueBlock({ receiptPath, displayPath, state, agentDetected, suggestLive, cmd });
  const lines = [b.lead, `  ${b.command}`, b.state];
  if (b.live) lines.push(b.live);
  return lines;
}

/**
 * The same ending, as PARTS rather than a paragraph.
 *
 * A renderer that receives one flat list of strings can only lay them out one
 * way, so the pasteable command ends up wrapped in with the prose — and a
 * wrapped command is a broken command. Naming the parts lets the screen give
 * each one the treatment it needs, and keeps the words in one place either way.
 */
export function epilogueBlock({ receiptPath, displayPath, state, agentDetected, suggestLive, cmd = 'npx praxis-memory' }) {
  // Live mode ends here too, and inviting someone to try the thing they just
  // watched reads as a tool that wasn't paying attention. `suggestLive` lets
  // the caller say "they already have it"; it defaults to the detection.
  const offerLive = suggestLive === undefined ? agentDetected : suggestLive;
  return {
    lead: `This receipt is on your disk${displayPath && displayPath !== receiptPath ? ` (${displayPath})` : ''} — prove it offline, free:`,
    // PASTEABLE. A `~` reads nicely and then fails on Windows, where nothing
    // expands it — so the pretty path is for prose and the absolute path is for
    // anything the reader is invited to run.
    command: `${cmd} receipt verify ${receiptPath}`,
    state: armedLine(state, cmd),
    live: offerLive ? `An agent CLI is installed here, so \`${cmd} demo --live\` can run the same loop on real work.` : null,
  };
}

/**
 * The degrade taxonomy (D43). Every way this can fail gets its own honest
 * sentence and a pointer at a command that exists — never a stack trace, never
 * a shrug, never a silent fallback the user cannot see happening.
 *
 * `degrades: true` means the demo continues in replay. `floor: true` means
 * replay itself could not run and the demo stops with a named reason.
 */
export const DEGRADE = {
  'no-agent-cli': {
    degrades: true,
    line: 'No agent CLI found, so live mode is not available on this machine.',
  },
  'cli-unauthenticated': {
    degrades: true,
    line: 'The agent CLI is installed but not signed in, so live mode cannot run.',
  },
  'spawn-failed': {
    degrades: true,
    line: 'The agent CLI could not be started.',
  },
  'timed-out': {
    degrades: true,
    line: 'Live mode ran out of time — real work is unpredictable, and the demo will not wait forever.',
  },
  'nothing-sealed': {
    degrades: true,
    line: 'The agent finished but produced nothing worth sealing, so there is no live receipt to show.',
  },
  'judge-unreachable': {
    degrades: true,
    line: 'The judge could not be reached, so no verdict was ruled — and none was invented.',
  },
  'user-abort': {
    degrades: true,
    line: 'Stopped at your request.',
  },
  // The catch-all for live. It degrades rather than floors because live IS the
  // optional half — whatever went wrong there, the replay still owes the reader
  // a demo, and the raw code travels in the detail so nothing is hidden.
  'live-error': {
    degrades: true,
    line: 'Live mode hit an unexpected problem.',
  },
  'corpus-missing': {
    floor: true,
    line: 'The packaged demo recording is missing from this install, so there is nothing to replay.',
  },
  'corpus-corrupt': {
    floor: true,
    line: 'The packaged demo recording could not be read, so the replay cannot run.',
  },
  'unwritable': {
    floor: true,
    line: 'The demo could not write a receipt — its receipts folder is not writable.',
  },
  'disk-full': {
    floor: true,
    line: 'There is not enough free space to seal a receipt.',
  },
};

/** One honest line plus a pointer at a command that exists. */
export function degradeMessage(cls, detail, cmd = 'npx praxis-memory') {
  const entry = DEGRADE[cls];
  const head = entry ? entry.line : 'The demo hit an unexpected problem.';
  const withDetail = detail ? `${head} (${detail})` : head;
  const pointer = `\`${cmd} doctor\` checks this machine and names the fix.`;
  const tail = entry && entry.degrades ? 'Falling back to the recorded replay — it needs nothing but this package.' : pointer;
  return entry && entry.degrades ? `${withDetail} ${tail}` : `${withDetail} ${pointer}`;
}

/** Map a filesystem error to a floor class, so no raw errno reaches a human. */
export function classifyFsError(e) {
  const code = e && e.code;
  if (code === 'ENOSPC') return 'disk-full';
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'unwritable';
  return 'unwritable';
}

/** Where the sealed receipt is shown from — short, but unambiguous. */
export function prettyPath(p, home) {
  const h = home || '';
  if (h && p.startsWith(h)) return '~' + p.slice(h.length).replace(/\\/g, path.sep);
  return p;
}
