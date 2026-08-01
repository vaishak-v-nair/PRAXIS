// The checkpoint: save EVERYTHING, clear the context, reload the essence,
// keep going — in the same session. Two halves deliver it honestly:
// this CLI half writes the archive + brief + vault notes with pre-flight
// safety; the /praxis-checkpoint slash command half (which runs inside
// Claude and can see the live context) writes the rich brief and points the
// user at /compact — the only thing that can actually clear a live session.
// Pure builders live here; the command orchestrates and asks on doubt.

import path from 'node:path';
import { cleanUserText, toolDetail, toolInPlainEnglish, asLines } from './transcript.js';
import { extractBrief } from './handoff.js';

/**
 * Turn a raw transcript (JSONL text) into a readable conversation archive.
 * Full user + Claude words are kept; tool calls become one-line actions and
 * tool OUTPUTS are omitted on purpose — they are the bulk of a transcript,
 * the least readable part, and the most likely place for a secret to hide.
 * Pure function — no filesystem.
 */
export function buildArchive(transcriptText, opts = {}) {
  const project = opts.project || 'this project';
  const now = opts.now || new Date().toISOString();
  const parts = [];
  const stats = {
    userMsgs: 0,
    claudeMsgs: 0,
    tools: 0,
    compactions: 0,
    files: new Set(),
    tokens: 0,
    firstTs: null,
    lastTs: null,
  };
  let lastClaude = { id: null, text: null }; // streamed repeats carry the same id+text
  let lastAction = null; // burst of one tool reads as a single "×N" line

  for (const line of asLines(transcriptText)) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e || typeof e !== 'object' || e.isSidechain) continue;
    if (typeof e.timestamp === 'string') {
      if (!stats.firstTs) stats.firstTs = e.timestamp;
      stats.lastTs = e.timestamp;
    }

    if (e.type === 'user' && e.message) {
      const c = e.message.content;
      const items = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
      for (const item of items) {
        if (item.type !== 'text') continue;
        const text = cleanUserText(item.text || '');
        if (!text) continue;
        stats.userMsgs++;
        lastAction = null;
        parts.push(`## You\n\n${text}`);
      }
    } else if (e.type === 'system' && e.subtype === 'compact_boundary') {
      stats.compactions++;
      lastAction = null;
      parts.push('> _The session was compacted here — earlier detail above was compressed._');
    } else if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
      const u = e.message.usage;
      if (u) {
        const total =
          (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        if (total > 0) stats.tokens = total;
      }
      for (const item of e.message.content) {
        if (item.type === 'text' && item.text && item.text.trim()) {
          const text = item.text.trim();
          if (e.message.id && lastClaude.id === e.message.id && lastClaude.text === text) continue;
          lastClaude = { id: e.message.id, text };
          stats.claudeMsgs++;
          lastAction = null;
          parts.push(`## Claude\n\n${text}`);
        } else if (item.type === 'tool_use') {
          stats.tools++;
          if (typeof item.input?.file_path === 'string') stats.files.add(item.input.file_path);
          const label = toolInPlainEnglish(item.name, toolDetail(item.name, item.input).slice(0, 80));
          if (lastAction && lastAction.name === item.name) {
            lastAction.count++;
            parts[parts.length - 1] = `- ${label} ×${lastAction.count}`;
          } else {
            lastAction = { name: item.name, count: 1 };
            parts.push(`- ${label}`);
          }
        }
      }
    }
  }

  const files = [...stats.files];
  const header = [
    `# Session archive — ${project}`,
    '',
    `Saved by \`praxis checkpoint\` on ${now}.`,
    'Full conversation below. Tool outputs are omitted by design — they are',
    'noise at best and secrets at worst; the words and the actions are here.',
    '',
    `- Messages: ${stats.userMsgs} from you · ${stats.claudeMsgs} from Claude · ${stats.tools} tool actions`,
    stats.tokens > 0 ? `- Context at save: ${Math.round(stats.tokens / 1000)}k tokens` : null,
    stats.compactions > 0 ? `- Compacted ${stats.compactions}× before this save` : null,
    files.length ? `- Files touched: ${files.length}` : null,
    '',
    '---',
    '',
  ]
    .filter((l) => l !== null)
    .join('\n');

  return {
    markdown: header + parts.join('\n\n') + '\n',
    stats: { ...stats, files },
  };
}

/** The last few things the human asked, plus Claude's final words — the live essence. */
export function extractEssence(transcriptText, maxAsks = 5) {
  const asks = [];
  let lastClaude = '';
  for (const line of asLines(transcriptText)) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e || typeof e !== 'object' || e.isSidechain) continue;
    if (e.type === 'user' && e.message) {
      const c = e.message.content;
      const items = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
      for (const item of items) {
        if (item.type !== 'text') continue;
        const t = cleanUserText(item.text || '');
        if (t && !t.startsWith('/') && !asks.includes(t)) asks.push(t.slice(0, 200));
      }
    } else if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
      for (const item of e.message.content) {
        if (item.type === 'text' && item.text && item.text.trim()) lastClaude = item.text.trim();
      }
    }
  }
  return { asks: asks.slice(-maxAsks), lastClaude: lastClaude.slice(0, 600) };
}

/**
 * The deterministic RESUME.md — the reload payload when the CLI runs alone.
 * (The slash-command path writes a richer one: Claude holds the live context.)
 * Pure function — no filesystem.
 */
export function buildResume(memoryContent, essence = {}, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const project = extractBrief(memoryContent) || '_(No project brief saved yet — read the code and the archive.)_';
  const asks = essence.asks || [];

  return [
    '# RESUME — continue exactly here',
    '',
    `Written by \`praxis checkpoint\` on ${now}. This is the reload payload:`,
    'read all of it, then continue the work below. Do not start over, do not',
    're-ask what the project is.',
    '',
    '## Project brief',
    '',
    project,
    '',
    '## Where the session left off',
    '',
    asks.length
      ? 'Working on (oldest first):\n' + asks.map((a) => `- ${a}`).join('\n')
      : '_(No live transcript found — lean on the project brief and Session Log.)_',
    '',
    essence.lastClaude ? `Last thing Claude said:\n\n> ${essence.lastClaude.replace(/\n/g, '\n> ')}` : null,
    '',
    '## Your first move',
    '',
    '1. Confirm in one short sentence that you read this brief.',
    '2. Continue the most recent work above. If the next step is genuinely',
    '   unclear, ask one specific question — not "what is this project?".',
    '',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/**
 * Walk up from `dir` looking for an Obsidian vault (`.obsidian/` directory),
 * stopping at the confinement boundary (repo root or home). Returns the vault
 * root or null. `existsDir` is injectable for tests.
 */
export function findObsidianVault(dir, boundaries = [], existsDir = () => false) {
  let cur = path.resolve(dir);
  const stops = boundaries.filter(Boolean).map((b) => path.resolve(b));
  for (let i = 0; i < 32; i++) {
    if (existsDir(path.join(cur, '.obsidian'))) return cur;
    if (stops.some((b) => cur === b)) break; // boundary reached — do not walk past it
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}
