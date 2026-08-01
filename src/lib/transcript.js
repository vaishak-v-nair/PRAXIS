// Claude Code session transcripts (JSONL) are the one structured, version-safe
// window into a live session. `praxis hud` never touches the terminal Claude
// owns — it tails these files and reduces them to three plain-English fields:
// what you asked, what Claude says, what is running.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

/**
 * Accept a transcript as either raw JSONL text or lines already split.
 *
 * Six things reduce a transcript line by line — the memory summary, recent
 * asks, session commits, essence extraction, session health, and receipt
 * evidence — and every one of them used to do its own `split('\n')` over the
 * same string. That is five redundant copies of the whole transcript per hook
 * fire, measured at 455 ms and 153 MB RSS on a 40 MB session.
 *
 * Taking lines instead lets the caller split ONCE (or never — see
 * readTranscriptLines) while every one of these functions stays callable with a
 * plain string, which is what the tests and the retro-capture paths pass.
 */
export function asLines(input) {
  if (Array.isArray(input)) return input;
  return String(input || '').split('\n');
}

/**
 * Read a transcript as lines without ever building the whole-file string.
 *
 * V8 refuses any string over 512 MiB, so `readFileSync(f, 'utf8')` throws
 * ERR_STRING_TOO_LONG on a big enough session — and on the hook path that throw
 * was swallowed, so the heaviest users (the ones with the most worth
 * remembering) silently got no memory at all. Streaming has no such ceiling:
 * the limit is per-string, and individual JSONL lines are small.
 */
export async function readTranscriptLines(file) {
  const lines = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) lines.push(line);
  // A BOM survives the stream on the first line, where every JSON.parse below
  // would choke on it exactly as it would have on the whole-file read.
  if (lines.length && lines[0].charCodeAt(0) === 0xfeff) lines[0] = lines[0].slice(1);
  return lines;
}

/** Claude Code stores transcripts under ~/.claude/projects/<sanitized cwd>/ */
export function transcriptDir(cwd = process.cwd(), home = os.homedir()) {
  const sanitized = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(home, '.claude', 'projects', sanitized);
}

/**
 * Every main-session transcript in a project dir, newest first (agent
 * sidechains excluded). One walk, so the doctor's liveness check and the
 * health report cannot disagree about which sessions exist.
 *
 * @returns {{file: string, mtimeMs: number}[]}
 */
export function listTranscripts(dir) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.jsonl') || f.startsWith('agent-')) continue;
    try {
      out.push({ file: path.join(dir, f), mtimeMs: fs.statSync(path.join(dir, f)).mtimeMs });
    } catch {
      /* vanished between readdir and stat — not a session we can read */
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Newest main-session transcript in a project dir (agent sidechains excluded). */
export function newestTranscript(dir) {
  const all = listTranscripts(dir);
  return all.length ? all[0].file : null;
}

export function freshHudState() {
  return {
    asking: '', // your last prompt — or the question Claude asked you
    needsYou: false, // true while Claude is waiting on your answer
    responding: '', // Claude's latest words this turn
    running: null, // { name, detail, done, id, startTs }
    toolsThisTurn: 0,
    lastTs: null, // ISO timestamp of the newest event seen
    lastEvent: null, // 'user' | 'assistant' | 'tool'
    contextTokens: 0, // REAL context size: last assistant usage (input + cache)
    compactions: 0, // times this session has been squeezed
    timeline: [], // the session as a story: { ts, who: 'you'|'claude'|'action'|'note', text, count? }
  };
}

const TIMELINE_CAP = 200;

function pushTimeline(state, entry) {
  state.timeline.push(entry);
  if (state.timeline.length > TIMELINE_CAP) state.timeline.splice(0, state.timeline.length - TIMELINE_CAP);
}

/**
 * Fold one raw JSONL line into the HUD state. Unparseable or irrelevant lines
 * are ignored — the reducer never throws.
 */
export function applyLine(state, raw) {
  let e;
  try {
    e = JSON.parse(raw);
  } catch {
    return state;
  }
  if (!e || typeof e !== 'object' || e.isSidechain) return state;
  if (typeof e.timestamp === 'string') state.lastTs = e.timestamp;

  if (e.type === 'user' && e.message) {
    const c = e.message.content;
    const items = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
    let sawResult = false;
    for (const item of items) {
      if (item.type === 'tool_result') {
        sawResult = true;
        if (state.running && item.tool_use_id === state.running.id) state.running.done = true;
      } else if (item.type === 'text') {
        const text = cleanUserText(item.text || '');
        if (text) {
          state.asking = text;
          state.needsYou = false;
          state.responding = '';
          state.toolsThisTurn = 0;
          state.lastEvent = 'user';
          pushTimeline(state, { ts: state.lastTs, who: 'you', text });
        }
      }
    }
    if (sawResult) state.lastEvent = 'tool';
  } else if (e.type === 'system' && e.subtype === 'compact_boundary') {
    state.compactions++;
    pushTimeline(state, { ts: state.lastTs, who: 'note', text: 'Claude squeezed the session to keep going — older detail was compressed' });
  } else if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
    const u = e.message.usage;
    if (u) {
      const total =
        (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      if (total > 0) state.contextTokens = total;
    }
    const msgId = e.message.id;
    for (const item of e.message.content) {
      if (item.type === 'text' && item.text && item.text.trim()) {
        state.responding = item.text.trim();
        state.lastEvent = 'assistant';
        // streamed repeats of one message carry the same id + text: skip them
        const dup = msgId && state._lastClaudeMsgId === msgId && state._lastClaudeText === state.responding;
        if (!dup) {
          pushTimeline(state, { ts: state.lastTs, who: 'claude', text: state.responding, msgId });
          state._lastClaudeMsgId = msgId;
          state._lastClaudeText = state.responding;
        }
      } else if (item.type === 'tool_use') {
        state.toolsThisTurn++;
        if (item.name === 'AskUserQuestion') {
          state.asking = firstQuestion(item.input) || 'Claude has a question for you';
          state.needsYou = true;
        }
        state.running = {
          name: item.name,
          detail: toolDetail(item.name, item.input),
          done: false,
          id: item.id,
          startTs: typeof e.timestamp === 'string' ? e.timestamp : null,
        };
        state.lastEvent = 'tool';
        const label = toolInPlainEnglish(item.name, toolDetail(item.name, item.input).slice(0, 60));
        const last = state.timeline[state.timeline.length - 1];
        // a burst of the same tool reads as one line: "Reading a file … ×4"
        if (last && last.who === 'action' && last.name === item.name) {
          last.count = (last.count || 1) + 1;
          last.text = label;
          last.ts = state.lastTs;
        } else {
          pushTimeline(state, { ts: state.lastTs, who: 'action', name: item.name, text: label });
        }
      }
    }
  }
  return state;
}

/**
 * A user transcript line is not always something the human typed — strip
 * hook noise, slash-command wrappers, and system reminders down to the ask.
 */
export function cleanUserText(text) {
  if (!text) return '';
  let t = String(text);
  if (t.includes('<local-command-stdout>')) return '';
  const cmd = t.match(/<command-name>\/?([^<]+)<\/command-name>/);
  if (cmd) return '/' + cmd[1].trim();
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ');
  t = t.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** The one input field that tells a human what a tool call is doing. */
export function toolDetail(name, input) {
  if (!input || typeof input !== 'object') return '';
  const pick =
    input.command ??
    input.file_path ??
    input.pattern ??
    input.skill ??
    input.description ??
    input.url ??
    input.prompt ??
    '';
  return String(pick).replace(/\s+/g, ' ').trim().slice(0, 200);
}

function firstQuestion(input) {
  try {
    const q = input && Array.isArray(input.questions) && input.questions[0];
    return q && typeof q.question === 'string' ? q.question : '';
  } catch {
    return '';
  }
}

const PLAIN_TOOL_NAMES = {
  Read: 'Reading a file',
  Write: 'Writing a file',
  Edit: 'Editing a file',
  NotebookEdit: 'Editing a notebook',
  Bash: 'Running a command',
  PowerShell: 'Running a command',
  BashOutput: 'Checking a command that is still running',
  Grep: 'Searching the code',
  Glob: 'Looking for files',
  WebFetch: 'Reading a web page',
  WebSearch: 'Searching the web',
  Skill: 'Using a skill',
  Agent: 'Sent a helper agent to work',
  Task: 'Sent a helper agent to work',
  TodoWrite: 'Updating its to-do list',
  AskUserQuestion: 'Asking you a question',
  EnterPlanMode: 'Writing a plan',
  ExitPlanMode: 'Showing you its plan',
};

/** "Bash — git status" is jargon; "Running a command — git status" is not. */
export function toolInPlainEnglish(name, detail) {
  let label = PLAIN_TOOL_NAMES[name];
  if (!label) {
    label = name && name.startsWith('mcp__')
      ? `Using a connected app (${name.split('__')[1]})`
      : `Using ${name}`;
  }
  return detail ? `${label} — ${detail}` : label;
}

/** One line for the HUD header: what is happening right now, in plain English. */
export function whatIsHappening(state) {
  if (state.needsYou) return { kind: 'ask', text: 'Claude is waiting for YOUR answer' };
  if (state.running && !state.running.done && state.lastEvent === 'tool') {
    return { kind: 'busy', text: toolInPlainEnglish(state.running.name, '') };
  }
  if (state.lastEvent === 'assistant') return { kind: 'reply', text: 'Claude replied' };
  if (state.lastEvent === 'tool') return { kind: 'busy', text: 'Claude is thinking' };
  if (state.lastEvent === 'user') return { kind: 'busy', text: 'Claude is reading your message' };
  return { kind: 'idle', text: 'Waiting for the session to start' };
}
