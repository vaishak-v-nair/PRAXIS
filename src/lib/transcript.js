// Claude Code session transcripts (JSONL) are the one structured, version-safe
// window into a live session. `praxis hud` never touches the terminal Claude
// owns — it tails these files and reduces them to three plain-English fields:
// what you asked, what Claude says, what is running.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Claude Code stores transcripts under ~/.claude/projects/<sanitized cwd>/ */
export function transcriptDir(cwd = process.cwd(), home = os.homedir()) {
  const sanitized = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(home, '.claude', 'projects', sanitized);
}

/** Newest main-session transcript in a project dir (agent sidechains excluded). */
export function newestTranscript(dir) {
  let best = null;
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const f of files) {
    if (!f.endsWith('.jsonl') || f.startsWith('agent-')) continue;
    let m;
    try {
      m = fs.statSync(path.join(dir, f)).mtimeMs;
    } catch {
      continue;
    }
    if (!best || m > best.mtimeMs) best = { file: path.join(dir, f), mtimeMs: m };
  }
  return best && best.file;
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
  };
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
        }
      }
    }
    if (sawResult) state.lastEvent = 'tool';
  } else if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
    for (const item of e.message.content) {
      if (item.type === 'text' && item.text && item.text.trim()) {
        state.responding = item.text.trim();
        state.lastEvent = 'assistant';
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
