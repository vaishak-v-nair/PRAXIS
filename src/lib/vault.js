// Obsidian vault bridge — praxis writes what the AI did INTO the second
// brain the user already trusts. Plain markdown with [[wikilinks]]: a hub
// note per project, a mirror of the living memory, one note per session,
// one note per traced commit. The vault graph becomes the visual history of
// your AI work. Best-effort everywhere: a vault write must never break a
// hook, a commit, or a session.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redact } from './redact.js';

export function vaultRoot(cfg) {
  return cfg && typeof cfg.vault === 'string' && cfg.vault.trim() ? cfg.vault.trim() : null;
}

function under(base, target) {
  if (!base) return false;
  try {
    const rel = path.relative(path.resolve(base), path.resolve(target));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

/**
 * A vault path is honored only if it sits under the user's home directory OR
 * the current repo. A cloned repo can ship a hostile `.praxis/config.json`;
 * without this, its `vault` value would steer where session notes get written
 * on the victim's disk. Home-or-repo confinement blocks writes to system paths
 * or sibling projects while still allowing a vault on any drive the user
 * actually works in (e.g. E:\project\Personal Intelligence).
 */
export function vaultPathAllowed(root, home = os.homedir(), repoRoot = null) {
  if (!root) return false;
  return under(home, root) || (repoRoot && under(repoRoot, root));
}

export function vaultDirFor(cfg, projectName, home = os.homedir(), repoRoot = null) {
  const root = vaultRoot(cfg);
  if (!root || !vaultPathAllowed(root, home, repoRoot)) return null;
  return path.join(root, 'Praxis', projectName);
}

function safeWrite(file, content) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return true;
  } catch {
    return false;
  }
}

function ensureHub(dir, projectName) {
  const hub = path.join(dir, `${projectName}.md`);
  if (fs.existsSync(hub)) return;
  safeWrite(
    hub,
    `---\ntags: [praxis, project]\n---\n\n# ${projectName}\n\n` +
      `Auto-maintained by [praxis](https://github.com/vaishak-v-nair/PRAXIS): ` +
      `the memory and decision trail of your AI coding sessions.\n\n` +
      `- [[${projectName} - Memory]] — the living project memory Claude reads\n` +
      `- Sessions/ — one note per coding session, newest tells the story\n` +
      `- Commits/ — the AI context behind traced commits\n`,
  );
}

/** Mirror .praxis/memory.md into the vault (already redacted at the source). */
export function mirrorMemory(dir, projectName, memoryContent) {
  if (!dir) return false;
  ensureHub(dir, projectName);
  return safeWrite(
    path.join(dir, `${projectName} - Memory.md`),
    `---\ntags: [praxis, memory]\nupdated: ${new Date().toISOString()}\n---\n\n` +
      `> Auto-mirrored from \`.praxis/memory.md\` in [[${projectName}]]. Edit the source, not this copy.\n\n` +
      String(memoryContent),
  );
}

/** One note per capture: what the session was, in the vault's own language. */
export function writeSessionNote(dir, projectName, info = {}) {
  if (!dir) return false;
  ensureHub(dir, projectName);
  const now = new Date();
  // second resolution so a pre-compact snapshot + Stop in the same minute
  // don't clobber each other's note
  const stamp = now.toISOString().slice(0, 19).replace('T', ' ').replaceAll(':', '.');
  const lines = [
    '---',
    `tags: [praxis, session${info.snapshot ? ', snapshot' : ''}]`,
    `project: "[[${projectName}]]"`,
    '---',
    '',
    `# ${info.snapshot ? 'Pre-compact snapshot' : 'Session'} — ${now.toISOString().slice(0, 10)}`,
    '',
  ];
  if (info.asks && info.asks.length) {
    lines.push('## Working on');
    for (const a of info.asks) lines.push(`- ${a}`);
    lines.push('');
  }
  if (info.files && info.files.length) {
    lines.push('## Files touched');
    lines.push(info.files.join(' · '));
    lines.push('');
  }
  const facts = [];
  if (info.tokens > 0) facts.push(`session ended at ${Math.round(info.tokens / 1000)}k context tokens`);
  if (info.turns) facts.push(`${info.turns} transcript lines`);
  if (facts.length) lines.push(`— ${facts.join(' · ')}`);
  lines.push('', `Memory: [[${projectName} - Memory]]`);
  return safeWrite(path.join(dir, 'Sessions', `${stamp}.md`), redact(lines.join('\n') + '\n'));
}

/** One note per traced commit: the AI's testimony, browsable in the graph. */
export function writeCommitNote(dir, projectName, { hash, subject, block } = {}) {
  if (!dir || !hash) return false;
  ensureHub(dir, projectName);
  const content =
    `---\ntags: [praxis, commit]\nproject: "[[${projectName}]]"\ncommit: ${hash}\n---\n\n` +
    `# ${hash} — ${String(subject || '').slice(0, 80)}\n\n` +
    '```\n' +
    String(block || '').trim() +
    '\n```\n\n' +
    `Memory at the time: [[${projectName} - Memory]]\n`;
  return safeWrite(path.join(dir, 'Commits', `${hash}.md`), redact(content));
}
