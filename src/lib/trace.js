// Trace — the "why" behind a commit. Git records what changed; the session
// transcript records what was asked and what the AI decided. Trace correlates
// the two: at commit time it distills the transcript window since the previous
// commit into a compact block and stores it in git notes (refs/notes/praxis).
// Notes travel with the repo, need no server, and work on any git host.

import path from 'node:path';
import { cleanUserText } from './transcript.js';
import { redact } from './redact.js';

/**
 * One pass over transcript text: everything a reviewer would want to know
 * about the work done since `sinceMs`. Pure — testable without files.
 */
export function scanWindow(text, sinceMs) {
  const out = { asks: [], said: [], files: new Set(), commands: 0, lastTokens: 0 };
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e || typeof e !== 'object' || e.isSidechain) continue;
    const ts = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : NaN;
    if (!Number.isFinite(ts) || ts < sinceMs) continue;

    if (e.type === 'user' && e.message) {
      const c = e.message.content;
      const items = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
      for (const item of items) {
        if (item.type !== 'text') continue;
        const t = cleanUserText(item.text || '');
        if (t && !t.startsWith('/')) out.asks.push(t);
      }
    } else if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
      const u = e.message.usage;
      if (u) {
        const total = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        if (total > 0) out.lastTokens = total;
      }
      for (const item of e.message.content) {
        if (item.type === 'text' && item.text && item.text.trim()) {
          out.said.push(item.text.trim());
        } else if (item.type === 'tool_use') {
          const name = item.name;
          const input = item.input || {};
          if ((name === 'Edit' || name === 'Write' || name === 'NotebookEdit') && input.file_path) {
            out.files.add(String(input.file_path));
          } else if (name === 'Bash' || name === 'PowerShell') {
            out.commands++;
          }
        }
      }
    }
  }
  return out;
}

const ONE = (s, n) => String(s).replace(/\s+/g, ' ').trim().slice(0, n);

/** The block a reviewer reads. Plain text, redacted, no jargon walls. */
export function buildTraceBlock(scan, meta = {}) {
  const lines = ['praxis trace — the AI context behind this commit', ''];

  const asks = scan.asks.slice(-3);
  if (asks.length) {
    lines.push('Asked:');
    for (const a of asks) lines.push('  · ' + ONE(a, 140));
  } else {
    lines.push('Asked: (no direct prompt in this window — likely autonomous follow-through)');
  }

  // paths outside this repo never enter the note — notes can be pushed, and
  // another project's file names are not this repo's business to publish
  const inside = [];
  let outside = 0;
  for (const f of scan.files) {
    const rel = meta.root ? path.relative(meta.root, f) : '';
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) inside.push(rel.replace(/\\/g, '/'));
    else outside++;
  }
  if (inside.length || outside) {
    const shown = inside.slice(0, 8);
    const extra = [];
    if (inside.length > 8) extra.push(`+${inside.length - 8} more`);
    if (outside) extra.push(`${outside} outside this repo`);
    lines.push('Touched: ' + shown.join(' · ') + (extra.length ? ` (${extra.join(' · ')})` : ''));
  }
  if (scan.commands > 0) lines.push(`Ran: ${scan.commands} command${scan.commands === 1 ? '' : 's'}`);

  // the AI's own words: the last substantial thing it said before the commit
  const why = [...scan.said].reverse().find((s) => s.replace(/\s+/g, ' ').length > 40);
  if (why) {
    lines.push('In its words:');
    lines.push('  "' + ONE(why.replace(/\*\*|__|`/g, ''), 300) + '"');
  }

  const facts = [];
  if (scan.lastTokens > 0 && meta.contextLimit) {
    facts.push(`session ${Math.min(100, Math.round((scan.lastTokens / meta.contextLimit) * 100))}% full at commit`);
  }
  if (meta.version) facts.push('praxis v' + meta.version);
  if (facts.length) {
    lines.push('');
    lines.push('— ' + facts.join(' · '));
  }

  return redact(lines.join('\n'));
}

/** Our line in .git/hooks/post-commit — appended, never overwriting anyone. */
export const HOOK_LINE = 'praxis trace --capture --quiet >/dev/null 2>&1 || true';

export function patchHookScript(existing) {
  const content = String(existing || '');
  if (content.includes(HOOK_LINE)) return { content, changed: false };
  if (!content.trim()) {
    return { content: '#!/bin/sh\n' + HOOK_LINE + '\n', changed: true };
  }
  return { content: content.trimEnd() + '\n' + HOOK_LINE + '\n', changed: true };
}

export function unpatchHookScript(existing) {
  const content = String(existing || '');
  if (!content.includes(HOOK_LINE)) return { content, changed: false };
  const next = content
    .split('\n')
    .filter((l) => l.trim() !== HOOK_LINE)
    .join('\n');
  return { content: next, changed: true };
}
