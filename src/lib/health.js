// Session health from the source of truth: Claude Code transcripts carry the
// REAL token usage of every assistant turn (input + cache reads), so PRAXIS
// can say "this session is 82% full" with actual numbers — no guessing.
// Claude is monitored deeply (transcripts); other tools shallowly (installed
// or not). The directional suggestion is what turns a number into a next step.

import fs from 'node:fs';
import path from 'node:path';
import { transcriptDir, newestTranscript, asLines } from './transcript.js';
import { TOOLS, ALTERNATES_FOR_CLAUDE } from './tools.js';

export const DEFAULT_CONTEXT_LIMIT = 200000;

/**
 * One pass over a transcript's text: real context tokens (last assistant
 * usage), compaction history, tool error rate, session span.
 * Pure function — testable without files.
 */
export function analyzeTranscript(text) {
  const out = {
    contextTokens: 0,
    model: '',
    compactions: 0,
    lastCompact: null, // { trigger, preTokens, postTokens }
    toolResults: 0,
    toolErrors: 0,
    firstTs: null,
    lastTs: null,
    lines: 0,
  };
  for (const line of asLines(text)) {
    if (!line) continue;
    out.lines++;
    const ti = line.indexOf('"timestamp":"');
    if (ti >= 0) {
      const ts = line.slice(ti + 13, ti + 13 + 24).replace(/".*$/, '');
      if (!out.firstTs) out.firstTs = ts;
      out.lastTs = ts;
    }
    if (line.includes('"subtype":"compact_boundary"')) {
      out.compactions++;
      try {
        const e = JSON.parse(line);
        const m = e.compactMetadata || {};
        out.lastCompact = { trigger: m.trigger, preTokens: m.preTokens, postTokens: m.postTokens };
      } catch {
        /* count it anyway */
      }
      continue;
    }
    if (line.includes('"type":"tool_result"')) {
      out.toolResults += line.split('"type":"tool_result"').length - 1;
      out.toolErrors += line.split('"is_error":true').length - 1;
    }
    if (line.includes('"usage":{') && !line.includes('"isSidechain":true')) {
      try {
        const e = JSON.parse(line);
        const u = e && e.message && e.message.usage;
        if (e.type === 'assistant' && u) {
          const total =
            (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
          if (total > 0) {
            out.contextTokens = total;
            if (e.message.model) out.model = e.message.model;
          }
        }
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

/** Turn a token count into a level a human can act on. */
export function classifyContext(tokens, limit = DEFAULT_CONTEXT_LIMIT) {
  // clamp at 100: usage can exceed the assumed window (bigger-context models);
  // "100% full" is honest, "103%" is a wrong-looking guess. Set contextLimit
  // in .praxis/config.json when you know the real window.
  const pct = limit > 0 ? Math.min(100, Math.round((tokens / limit) * 100)) : 0;
  const level = pct < 50 ? 'fresh' : pct < 75 ? 'warming' : pct < 88 ? 'heavy' : 'critical';
  return { pct, level };
}

/**
 * The directional suggestion: given a level and what is installed, say
 * exactly what to do next and why. Pure — testable.
 */
export function suggestNext(level, installed = {}) {
  if (level === 'fresh') {
    return { urgent: false, text: 'Plenty of room. Keep going.' };
  }
  if (level === 'warming') {
    return {
      urgent: false,
      text: 'Over half full. Finish the current thread; /praxis-save keeps the decisions.',
    };
  }
  const target = ALTERNATES_FOR_CLAUDE.find((k) => installed[k]);
  if (target) {
    return {
      urgent: level === 'critical',
      target,
      command: `praxis switch ${target}`,
      text:
        (level === 'critical' ? 'Nearly full. ' : 'Getting heavy. ') +
        `Best move: praxis switch ${target} — ${TOOLS[target].name} starts at 0% and your project memory comes along.`,
    };
  }
  return {
    urgent: level === 'critical',
    text:
      (level === 'critical' ? 'Nearly full. ' : 'Getting heavy. ') +
      'Type /compact in Claude to squeeze this session, or install another tool ' +
      `(${TOOLS.gemini.install}) so praxis switch can move you at 0%.`,
  };
}

/**
 * Which tools exist on this machine: PATH, install dirs, registry, /Applications.
 * Delegated to the doctor library so health, `praxis doctor` and the demo's
 * preflight can never disagree about what is installed (D42). Re-exported here
 * because this has been health's public surface since v0.3.
 */
export { detectTools } from './doctor.js';

/**
 * Full report for a project dir. Reads the newest session transcript.
 * Returns null when no session exists for this folder.
 */
export function healthReport(cwd = process.cwd()) {
  const file = newestTranscript(transcriptDir(cwd));
  if (!file) return null;
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let limit = DEFAULT_CONTEXT_LIMIT;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(cwd, '.praxis', 'config.json'), 'utf8'));
    if (Number.isFinite(cfg.contextLimit)) limit = cfg.contextLimit;
  } catch {
    /* default */
  }
  const a = analyzeTranscript(text);
  const { pct, level } = classifyContext(a.contextTokens, limit);
  // a session that stopped writing minutes ago is history, not "right now"
  let idleMinutes = null;
  if (a.lastTs) {
    const ms = Date.now() - Date.parse(a.lastTs);
    if (Number.isFinite(ms)) idleMinutes = Math.max(0, Math.floor(ms / 60000));
  }
  // praxis only knows when the transcript last changed, not whether the app is
  // open — so the states describe activity honestly. A paused session (you
  // stepped away, switched apps) is "idle", NOT "not open".
  const LIVE_MINUTES = 15; // writing recently → active
  const IDLE_MINUTES = 180; // paused but almost certainly still open
  return {
    sessionId: path.basename(file, '.jsonl'),
    file,
    ...a,
    contextLimit: limit,
    pct,
    level,
    idleMinutes,
    live: idleMinutes !== null && idleMinutes < LIVE_MINUTES,
    idle: idleMinutes !== null && idleMinutes >= LIVE_MINUTES && idleMinutes < IDLE_MINUTES,
  };
}

/**
 * Breadcrumb for the tray companion (and anything else watching):
 * .praxis/health.json, written by `praxis hud` (live) and `praxis capture`
 * (session end). Best-effort — never throws.
 */
export function writeHealthFile(praxisDir, report, source) {
  try {
    if (!report || !fs.existsSync(praxisDir)) return;
    fs.writeFileSync(
      path.join(praxisDir, 'health.json'),
      JSON.stringify(
        {
          sessionId: report.sessionId,
          contextTokens: report.contextTokens,
          contextLimit: report.contextLimit,
          pct: report.pct,
          level: report.level,
          compactions: report.compactions,
          updated: new Date().toISOString(),
          source,
        },
        null,
        2,
      ) + '\n',
    );
  } catch {
    /* cosmetic breadcrumb only */
  }
}
