import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { projectPaths } from '../lib/paths.js';
import { extractEssence } from '../lib/checkpoint.js';
import { ensureMemory, addSessionEntry } from '../lib/memory.js';
import { writeState } from '../lib/state.js';
import { analyzeTranscript, classifyContext, writeHealthFile, DEFAULT_CONTEXT_LIMIT } from '../lib/health.js';
import { cleanUserText } from '../lib/transcript.js';
import { vaultDirFor, mirrorMemory, writeSessionNote, appendArchiveNote } from '../lib/vault.js';

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
  let turns = 0;
  const lines = text.split('\n').filter(Boolean);
  turns = lines.length;
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
  for (const line of text.split('\n')) {
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
    for (const line of text.split('\n')) {
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

export async function capture() {
  try {
    const raw = await readStdin();
    let data = {};
    try {
      data = JSON.parse(stripBom(raw).trim() || '{}');
    } catch {
      /* no/invalid payload */
    }

    const cwd = typeof data.cwd === 'string' ? data.cwd : process.cwd();
    const p = projectPaths(cwd);
    if (!fs.existsSync(p.praxisDir)) {
      process.exit(0); // not a PRAXIS project — nothing to do
    }
    // PreCompact = snapshot BEFORE Claude squeezes the session and detail is
    // lost forever. Stop = the regular end-of-session capture.
    const snapshot = data.hook_event_name === 'PreCompact';
    writeState(p.praxisDir, 'switching'); // tray: context is being carried over
    ensureMemory(p.memoryFile);

    let files = [];
    let turns = 0;
    let asks = [];
    let lastClaude = '';
    let commits = [];
    let analysis = null;
    if (typeof data.transcript_path === 'string') {
      let text = '';
      try {
        text = stripBom(fs.readFileSync(data.transcript_path, 'utf8'));
      } catch {
        /* transcript unreadable — degrade gracefully */
      }
      ({ files, turns } = summarizeTranscriptText(text));
      asks = recentAsks(text);
      lastClaude = extractEssence(text, 1).lastClaude;
      commits = sessionCommits(text, cwd);
      analysis = analyzeTranscript(text);
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

    let maxBytes = 16384;
    let redactOn = true;
    try {
      const cfg = JSON.parse(fs.readFileSync(p.configFile, 'utf8'));
      if (Number.isFinite(cfg.maxLogBytes)) maxBytes = cfg.maxLogBytes;
      if (cfg.redact === false) redactOn = false;
      if (cfg.capture === false) process.exit(0);
    } catch {
      /* use defaults */
    }

    const entry = addSessionEntry(
      p.memoryFile,
      `${new Date().toISOString()} - ${snapshot ? 'pre-compact snapshot' : 'session'}`,
      body,
      { maxBytes, redact: redactOn },
    );

    // Obsidian bridge: the session becomes a linked note in the user's vault
    try {
      const cfg = JSON.parse(fs.readFileSync(p.configFile, 'utf8'));
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
    } catch {
      /* the vault is a mirror, never a blocker */
    }

    writeState(p.praxisDir, 'restored'); // tray: context safely written back
  } catch {
    // Swallow everything — a hook must never break the session.
  }
  process.exit(0);
}
