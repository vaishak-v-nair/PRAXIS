import fs from 'node:fs';
import path from 'node:path';
import { redact } from './redact.js';

const LOG_MARKER = '## Session Log';

export function defaultMemory() {
  return `# PRAXIS Memory
<!-- Maintained by PRAXIS. Rich summaries via /praxis-save; auto-log via the Stop hook. Loaded into Claude Code automatically through CLAUDE.md. -->

## Project
<!-- Durable facts about this project. Edit freely; PRAXIS preserves this section. -->
_(No project summary yet. Run \`/praxis-save\` in Claude Code, or edit this section.)_

${LOG_MARKER}
<!-- Newest first. Auto-appended by the Stop hook. Older entries trimmed when large. -->
`;
}

export function readMemory(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

export function ensureMemory(file) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, defaultMemory());
}

/**
 * Prepend a session entry to the Session Log, redact secrets, and trim the
 * oldest entries so the log never grows past `maxBytes`. The Project section
 * and everything above the log marker are preserved untouched.
 */
export function addSessionEntry(file, heading, body, opts = {}) {
  const maxBytes = Number.isFinite(opts.maxBytes) ? opts.maxBytes : 16384;
  const doRedact = opts.redact !== false;

  let content = readMemory(file) || defaultMemory();
  if (!content.includes(LOG_MARKER)) {
    content = content.trimEnd() + `\n\n${LOG_MARKER}\n`;
  }

  const markerIdx = content.indexOf(LOG_MARKER);
  const header = content.slice(0, markerIdx).trimEnd();
  const afterMarker = content.slice(markerIdx + LOG_MARKER.length);

  // Preserve an HTML comment immediately after the marker, if present.
  const commentMatch = afterMarker.match(/^\s*\n(<!--[\s\S]*?-->)\n?/);
  let logComment = '';
  let entriesText = afterMarker;
  if (commentMatch) {
    logComment = commentMatch[1];
    entriesText = afterMarker.slice(commentMatch[0].length);
  }

  let newEntry = `### ${heading}\n${body}`.trim();
  if (doRedact) newEntry = redact(newEntry);

  const entries = splitEntries(entriesText);
  entries.unshift(newEntry);

  const join = (arr) => arr.join('\n\n');
  let trimmed = false;
  const archived = [];
  while (entries.length > 1 && Buffer.byteLength(join(entries)) > maxBytes) {
    archived.unshift(entries.pop()); // oldest first
    trimmed = true;
  }
  if (archived.length && opts.archive !== false) {
    archiveEntries(file, archived, opts.archiveDir);
  }

  let logBody = join(entries);
  if (trimmed) {
    logBody += `\n\n_(older entries moved to .praxis/archive/sessions — nothing is lost)_`;
  }

  const rebuilt =
    header + '\n\n' + LOG_MARKER + '\n' +
    (logComment ? logComment + '\n\n' : '') +
    logBody + '\n';

  fs.writeFileSync(file, rebuilt);
  return { trimmed, entryCount: entries.length, archived };
}

/**
 * Entries rotated out of the working memory are never deleted — they move to
 * a permanent, month-per-file archive beside it. Best-effort: an archive
 * failure must never break the hook that called us.
 */
function archiveEntries(memoryFile, entries, dirOverride) {
  try {
    const dir = dirOverride || path.join(path.dirname(memoryFile), 'archive', 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    const month = new Date().toISOString().slice(0, 7);
    const file = path.join(dir, `${month}.md`);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(
        file,
        `# PRAXIS Archive — ${month}\n` +
          `<!-- Session entries moved here when the working memory hit its size cap. Nothing is deleted. Oldest first. -->\n\n`,
      );
    }
    fs.appendFileSync(file, entries.join('\n\n') + '\n\n');
  } catch {
    /* archive is a safety net, never a blocker */
  }
}

function splitEntries(text) {
  const t = (text || '').trim();
  if (!t) return [];
  return t
    .split(/\n(?=### )/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !s.startsWith('_(older entries'));
}
