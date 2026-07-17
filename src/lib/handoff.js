// The handoff capsule: everything a *different* AI tool needs to pick up this
// project mid-task, built from .praxis/memory.md. This is what makes switching
// tools cheap — the new tool starts warm instead of asking you to re-explain.

const LOG_MARKER = '## Session Log';

/** The durable project brief from a memory.md string — shared by switch + checkpoint. */
export function extractBrief(memoryContent) {
  const content = String(memoryContent || '');
  const idx = content.indexOf(LOG_MARKER);
  const project = (idx >= 0 ? content.slice(0, idx) : content)
    .replace(/^# PRAXIS Memory[^\n]*\n?/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^## Project\s*/m, '')
    .trim();
  if (!project || project.startsWith('_(No project summary yet')) return '';
  return project;
}

/** The newest N Session Log entries from a memory.md string. */
export function extractRecentEntries(memoryContent, maxEntries = 3) {
  const content = String(memoryContent || '');
  const idx = content.indexOf(LOG_MARKER);
  if (idx < 0) return [];
  return content
    .slice(idx + LOG_MARKER.length)
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\n(?=### )/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith('### '))
    .slice(0, maxEntries);
}

/**
 * Build the capsule text from a memory.md string.
 * Pure function — no filesystem, fully testable.
 */
export function buildCapsule(memoryContent, opts = {}) {
  const toolName = opts.toolName || 'a new AI tool';
  const maxEntries = Number.isFinite(opts.maxEntries) ? opts.maxEntries : 3;
  const now = opts.now || new Date().toISOString();

  const project =
    extractBrief(memoryContent) ||
    '_(No project brief saved yet — read the session notes below and the code itself.)_';

  const entries = extractRecentEntries(memoryContent, maxEntries);
  const sessions = entries.length
    ? entries.join('\n\n')
    : '_(No sessions logged yet.)_';

  return `# Handoff brief — continue this project in ${toolName}

Written by \`praxis switch\` on ${now}. Read all of it before doing anything.

## What this file is

The developer was working on this project in another AI tool and moved here
mid-task. Below is the project brief and the most recent session notes,
newest first. Your job: continue where they left off — do not start over,
do not re-ask what the project is.

## Project brief

${project}

## Recent sessions (newest first)

${sessions}

## Your first move

1. Confirm in one short sentence that you read this brief.
2. Continue the most recent work above. If the next step is genuinely
   unclear, ask one specific question — not "what is this project?".
`;
}
