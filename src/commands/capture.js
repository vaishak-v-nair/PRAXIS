import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { projectPaths } from '../lib/paths.js';
import { extractEssence } from '../lib/checkpoint.js';
import { ensureMemory, addSessionEntry } from '../lib/memory.js';
import { writeState, writeCaptureState } from '../lib/state.js';
import { analyzeTranscript, classifyContext, writeHealthFile, DEFAULT_CONTEXT_LIMIT } from '../lib/health.js';
import { cleanUserText, asLines, readTranscriptLines } from '../lib/transcript.js';
import { vaultDirFor, mirrorMemory, writeSessionNote, appendArchiveNote } from '../lib/vault.js';
import { recordReceipt } from '../lib/receipt/record.js';
import { recordError, clearLastError } from '../lib/errors.js';

// Called by the Claude Code Stop hook. Reads the hook's JSON from stdin,
// derives a lightweight deterministic summary of the session, and appends it to
// .praxis/memory.md. MUST NOT crash the user's session — every path exits 0.

function stripBom(s) {
  return typeof s === 'string' && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve(data);
      }
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    setTimeout(finish, 1500); // never hang the session on a stuck pipe
  });
}

function collectFilePaths(obj, out, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return;
  if (typeof obj.file_path === 'string') out.add(obj.file_path);
  for (const v of Object.values(obj)) collectFilePaths(v, out, depth + 1);
}

export function summarizeTranscriptText(text) {
  const files = new Set();
  const lines = asLines(text).filter(Boolean);
  const turns = lines.length;
  for (const line of lines) {
    try {
      collectFilePaths(JSON.parse(line), files);
    } catch {
      /* skip unparseable line */
    }
  }
  return { files: [...files], turns };
}

/** The last few things the human actually asked for — the soul of a snapshot. */
export function recentAsks(text, max = 3) {
  const asks = [];
  for (const line of asLines(text)) {
    if (!line.includes('"type":"user"')) continue;
    try {
      const e = JSON.parse(line);
      if (e.isSidechain || e.type !== 'user' || !e.message) continue;
      const c = e.message.content;
      if (typeof c !== 'string') continue;
      const t = cleanUserText(c);
      if (t && !t.startsWith('/') && !asks.includes(t)) asks.push(t.slice(0, 80));
    } catch {
      /* skip */
    }
  }
  return asks.slice(-max);
}

/** Commits made while this session ran — the concrete output, straight from git. */
export function sessionCommits(text, cwd, max = 3) {
  try {
    let since = '';
    for (const line of asLines(text)) {
      if (!line) continue;
      const m = line.match(/"timestamp":"([^"]+)"/);
      if (m) {
        since = m[1];
        break;
      }
    }
    if (!since) return [];
    const out = execFileSync('git', ['log', `--since=${since}`, '--format=%h %s'], {
      cwd,
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return out ? out.split('\n').slice(0, max) : [];
  } catch {
    return []; // no git, no repo, no problem
  }
}

export function shorten(file, cwd) {
  try {
    const rel = file.startsWith(cwd) ? file.slice(cwd.length).replace(/^[\\/]/, '') : file;
    return rel.replace(/\\/g, '/'); // OS-neutral in the memory file
  } catch {
    return file;
  }
}

/**
 * Everything capture does, minus the exit.
 *
 * Split out so the suite can run it in-process. `capture()` has to end in
 * process.exit(0) — a hook that returns a non-zero code surfaces as an error in
 * the user's Claude session — but a function whose last act is exiting cannot
 * be called by a test without taking the test runner down with it, and V8
 * coverage does not follow spawned processes. So the most-executed codepath in
 * the product was structurally untestable: it had 0% function coverage not
 * because nobody wrote the test, but because the shape forbade it.
 *
 * @param {{raw?: string}} [opts]  raw hook payload; read from stdin when absent
 * @returns {Promise<{outcome: string, recorded: boolean, wrote: boolean}>}
 */
export async function captureRun(opts = {}) {
  // Hoisted so the outer catch — the one that exists to keep a broken hook from
  // ever breaking a session — still knows where to leave the evidence.
  let praxisDir = null;
  let recorded = false;
  let wrote = false;
  const note = (phase, e) => {
    recorded = true;
    if (!praxisDir) return;
    // last-error.json is the general "most recent thing PRAXIS swallowed",
    // written by several commands and meant for a human. capture.json is
    // capture's alone, and is what the doctor's liveness check reads.
    recordError(praxisDir, phase, e);
    writeCaptureState(praxisDir, 'started', {
      error: { phase, message: (e && e.message) || String(e), at: new Date().toISOString() },
    });
  };
  try {
    const raw = opts.raw !== undefined ? opts.raw : await readStdin();
    let data = {};
    try {
      data = JSON.parse(stripBom(raw).trim() || '{}');
    } catch {
      /* no/invalid payload */
    }

    const cwd = typeof data.cwd === 'string' ? data.cwd : process.cwd();
    const p = projectPaths(cwd);
    if (!fs.existsSync(p.praxisDir)) {
      return { outcome: 'not-a-praxis-project', recorded, wrote }; // nothing to do here
    }
    praxisDir = p.praxisDir;

    // Config is read ONCE, and BEFORE anything is written. It used to be read
    // twice, and late — so `capture: false` returned after state.json already
    // said 'switching', and half an hour later doctor reported "a capture
    // started and never finished" about a capture somebody had deliberately
    // turned off. An opt-out must leave no trace at all.
    let maxBytes = 16384;
    let redactOn = true;
    let cfg = {};
    try {
      cfg = JSON.parse(fs.readFileSync(p.configFile, 'utf8')) || {};
      if (Number.isFinite(cfg.maxLogBytes)) maxBytes = cfg.maxLogBytes;
      if (cfg.redact === false) redactOn = false;
    } catch {
      /* no config, or unreadable: the defaults above are the documented ones */
    }
    if (cfg.capture === false) return { outcome: 'capture-disabled', recorded, wrote };

    // PreCompact = snapshot BEFORE Claude squeezes the session and detail is
    // lost forever. Stop = the regular end-of-session capture.
    const snapshot = data.hook_event_name === 'PreCompact';
    writeState(p.praxisDir, 'switching'); // tray: context is being carried over
    writeCaptureState(p.praxisDir, 'started'); // liveness: only capture writes this
    ensureMemory(p.memoryFile);

    let files = [];
    let turns = 0;
    let asks = [];
    let lastClaude = '';
    let commits = [];
    let analysis = null;
    let lines = [];
    if (typeof data.transcript_path === 'string') {
      try {
        // One streamed pass. This used to be readFileSync(...,'utf8') followed
        // by five separate split('\n') calls over the same 40 MB string —
        // 455 ms and 153 MB RSS on a real session, and a hard throw above V8's
        // 512 MiB string limit that this very catch then swallowed.
        lines = await readTranscriptLines(data.transcript_path);
      } catch (e) {
        // Degrade gracefully, but SAY SO. This is the catch that hides the
        // real failures: a permissions change, a moved transcript, or
        // ERR_STRING_TOO_LONG on a session past V8's 512 MiB string ceiling —
        // which is reachable, transcripts here already run past 100 MB. Every
        // one of those produced a memory entry with nothing in it and no
        // explanation anywhere.
        note('transcript-read', e);
      }
      // every consumer takes the SAME lines — one split, not five
      ({ files, turns } = summarizeTranscriptText(lines));
      asks = recentAsks(lines);
      lastClaude = extractEssence(lines, 1).lastClaude;
      commits = sessionCommits(lines, cwd);
      analysis = analyzeTranscript(lines);
      if (analysis.contextTokens > 0) {
        const { pct, level } = classifyContext(analysis.contextTokens);
        writeHealthFile(
          p.praxisDir,
          {
            sessionId: path.basename(data.transcript_path, '.jsonl'),
            contextTokens: analysis.contextTokens,
            contextLimit: DEFAULT_CONTEXT_LIMIT,
            pct,
            level,
            compactions: analysis.compactions,
          },
          'capture',
        );
      }
    }

    // a session where nothing happened writes nothing — "(no file changes
    // detected)" entries were pure noise in recap. The receipt below still
    // seals (a record of an empty session is honest; a memory of one is junk).
    const nothingHappened = !snapshot && !files.length && !asks.length && !commits.length;

    const rel = files.map((f) => shorten(f, cwd));
    const k = (n) => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
    const body = [
      snapshot && analysis && analysis.contextTokens > 0
        ? `- Context at snapshot: ${k(analysis.contextTokens)} tokens, squeeze #${analysis.compactions + 1} imminent`
        : null,
      asks.length ? `- Working on: ${asks.map((a) => `"${a}"`).join(' · ')}` : null,
      commits.length ? `- Commits: ${commits.join(' · ')}` : null,
      lastClaude
        ? `- In its words: "${lastClaude.replace(/\s+/g, ' ').replace(/\*\*|__|`/g, '').slice(0, 220)}"`
        : null,
      rel.length
        ? `- Files touched: ${rel.slice(0, 20).join(', ')}${rel.length > 20 ? ` (+${rel.length - 20} more)` : ''}`
        : '- (no file changes detected)',
      turns ? `- Transcript lines: ${turns}` : null,
      snapshot ? null : '- Run `/praxis-save` for a richer, decision-level summary.',
    ]
      .filter(Boolean)
      .join('\n');

    // (config was read once at the top, before any breadcrumb was written)

    if (!nothingHappened) {
      wrote = true;
      const entry = addSessionEntry(
        p.memoryFile,
        `${new Date().toISOString()} - ${snapshot ? 'pre-compact snapshot' : 'session'}`,
        body,
        { maxBytes, redact: redactOn },
      );

      // Obsidian bridge: the session becomes a linked note in the user's vault
      try {
        const project = path.basename(p.root);
        const vd = vaultDirFor(cfg, project, undefined, p.root);
        if (vd) {
          mirrorMemory(vd, project, fs.readFileSync(p.memoryFile, 'utf8'));
          if (entry.archived && entry.archived.length) appendArchiveNote(vd, project, entry.archived);
          writeSessionNote(vd, project, {
            snapshot,
            asks,
            files: rel.slice(0, 20),
            turns,
            tokens: analysis ? analysis.contextTokens : 0,
          });
        }
      } catch (e) {
        // The vault is a mirror and never a blocker — but an unmounted drive
        // or a permissions change means notes silently stop arriving in
        // Obsidian while memory.md keeps growing, and the two surfaces drift
        // apart with nothing to explain why.
        note('vault-mirror', e);
      }
    }

    // Silent proof-of-work: a session's TRUE end (Stop, not a mid-session
    // PreCompact squeeze) leaves a hash-chained, signed receipt of what the
    // agent DID — evidence only, ZERO model calls. The judge is opt-in
    // (`praxis receipt --verify` or the MCP tool); it never fires in a hook.
    // A receipt failure must never break the session.
    try {
      if (!snapshot && lines.length && typeof data.transcript_path === 'string') {
        await recordReceipt(
          p.receiptsDir,
          { text: lines, sessionId: path.basename(data.transcript_path, '.jsonl') },
          { project: path.basename(p.root), now: new Date().toISOString(), verify: false },
        );
      }
    } catch (e) {
      // Receipts are a bonus on the hook path, never a blocker — but an
      // unwritable key dir means proof-of-work stops being sealed, which is
      // the product's central claim quietly going false.
      note('receipt-seal', e);
    }

    writeState(p.praxisDir, 'restored'); // tray: context safely written back
    if (!recorded) writeCaptureState(p.praxisDir, 'done'); // liveness: got all the way through

    // Got all the way through. Anything recorded during THIS run stands; a
    // fault from an earlier run does not, or one bad session would show a
    // permanent alarm and the check becomes the thing people learn to ignore.
    if (!recorded) clearLastError(p.praxisDir);
    return { outcome: nothingHappened ? 'nothing-to-record' : 'captured', recorded, wrote };
  } catch (e) {
    // Swallow everything — a hook must never break the session. Swallowing it
    // SILENTLY was the bug: `praxis doctor` can only ever prove the hook is
    // installed, and installed is not the same claim as ran.
    note('capture', e);
  }
  return { outcome: 'failed', recorded, wrote };
}

/** The hook entry point: do the work, then always exit 0, whatever happened. */
export async function capture() {
  await captureRun();
  process.exit(0);
}
