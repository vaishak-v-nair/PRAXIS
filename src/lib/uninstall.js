/**
 * Taking PRAXIS back out of a project.
 *
 * This exists because getting it out used to take six separate surgeries by
 * hand — `.praxis/`, the hooks, `.mcp.json`, the CLAUDE.md block, the slash
 * commands, and the notes written into an Obsidian vault — and knowing which
 * half of that vault was machine-written and which half the user typed
 * themselves. Nobody should have to know that. What people actually reach for
 * is `rm -rf .praxis`, which leaves hooks firing `npx -y praxis-memory` at the
 * end of every session against a directory that is no longer there.
 *
 * Every function here is the exact inverse of the one that wrote the thing:
 * settings.js, mcp/config.js, claudemd.js, init.js. They are surgical on
 * purpose — a settings file usually holds hooks that are nothing to do with
 * PRAXIS, an `.mcp.json` usually holds other servers, and a CLAUDE.md usually
 * holds the project's actual instructions. Removing PRAXIS must not cost the
 * user any of that.
 */
import fs from 'node:fs';
import path from 'node:path';

// The two forms PRAXIS has ever written into a hooks file. The legacy bare
// `praxis <cmd>` shipped until 0.9.1; an install from then that never upgraded
// still has it, and an uninstall that did not recognise it would leave a hook
// behind that fails loudly forever after the package is gone.
const PRAXIS_COMMAND = /^\s*(npx\s+(-y\s+)?praxis-memory|praxis)\s+\S/;

const CLAUDEMD_START = '<!-- PRAXIS:START (managed - do not edit) -->';
const CLAUDEMD_END = '<!-- PRAXIS:END -->';
// Exactly what patchClaudeMd writes when it creates the file from nothing. The
// sentence matters as much as the managed block: leaving it behind puts "This
// project uses PRAXIS" in a file Claude reads at the start of every session, in
// a project that no longer does. A stale instruction is worse than no
// instruction, so it comes out too — but only on a verbatim match, because the
// rest of a CLAUDE.md is somebody's actual project brief.
const CLAUDEMD_HEADING = '# Project Memory';
const CLAUDEMD_LINE = 'This project uses PRAXIS so Claude Code remembers context across sessions.';

const GITIGNORE_RULE =
  '# PRAXIS local memory (may contain project details — commit only after review)\n.praxis/\n';

const readJson = (f) => {
  try {
    const raw = fs.readFileSync(f, 'utf8');
    const j = JSON.parse(raw || '{}');
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
};

/**
 * Is there anything of ours in here at all?
 *
 * These three exist because the first version of `uninstall` built its plan
 * from `fs.existsSync`, which is a different question. A settings file, an
 * `.mcp.json` and a CLAUDE.md all routinely outlive PRAXIS — they hold other
 * people's hooks, other people's servers, and the project's own brief — so
 * "the file is there" made a second uninstall offer to remove things it had
 * already removed, on a project where nothing was installed.
 */
export function fileHasPraxisHooks(settingsFile) {
  const settings = readJson(settingsFile);
  if (!settings || !settings.hooks || typeof settings.hooks !== 'object') return false;
  for (const list of Object.values(settings.hooks)) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || !Array.isArray(entry.hooks)) continue;
      if (entry.hooks.some((h) => h && typeof h.command === 'string' && PRAXIS_COMMAND.test(h.command))) return true;
    }
  }
  return false;
}

export function mcpHasPraxis(mcpFile) {
  const cfg = readJson(mcpFile);
  return Boolean(cfg && cfg.mcpServers && typeof cfg.mcpServers === 'object' && 'praxis' in cfg.mcpServers);
}

export function claudeMdHasBlock(claudeMdFile) {
  try {
    const c = fs.readFileSync(claudeMdFile, 'utf8');
    return c.includes(CLAUDEMD_START) || c.includes(CLAUDEMD_LINE);
  } catch {
    return false;
  }
}

/**
 * Strip PRAXIS's hooks from a settings file, from every event, leaving every
 * other hook exactly where it was.
 *
 * Deletes the file only when PRAXIS was the entire contents of it — a settings
 * file that also carries the user's own keys is edited, never removed.
 */
export function removePraxisHooks(settingsFile) {
  const settings = readJson(settingsFile);
  if (!settings) return { changed: false, removed: 0, deleted: false };
  if (!settings.hooks || typeof settings.hooks !== 'object') return { changed: false, removed: 0, deleted: false };

  let removed = 0;
  for (const event of Object.keys(settings.hooks)) {
    const list = settings.hooks[event];
    if (!Array.isArray(list)) continue;
    const kept = [];
    for (const entry of list) {
      if (!entry || !Array.isArray(entry.hooks)) {
        kept.push(entry);
        continue;
      }
      const hooks = entry.hooks.filter((h) => {
        const ours = h && typeof h.command === 'string' && PRAXIS_COMMAND.test(h.command);
        if (ours) removed++;
        return !ours;
      });
      if (hooks.length) kept.push({ ...entry, hooks });
    }
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (!removed) return { changed: false, removed: 0, deleted: false };
  if (!Object.keys(settings.hooks).length) delete settings.hooks;

  // Nothing of anyone's left in here: PRAXIS created this file, so PRAXIS
  // takes it away rather than leaving an empty `{}` behind.
  if (!Object.keys(settings).length) {
    fs.rmSync(settingsFile, { force: true });
    return { changed: true, removed, deleted: true };
  }
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  return { changed: true, removed, deleted: false };
}

/** Remove the `praxis` MCP server, keeping any other server registered here. */
export function removeMcpServer(mcpFile) {
  const cfg = readJson(mcpFile);
  if (!cfg || !cfg.mcpServers || typeof cfg.mcpServers !== 'object') return { changed: false, deleted: false };
  if (!( 'praxis' in cfg.mcpServers)) return { changed: false, deleted: false };

  delete cfg.mcpServers.praxis;
  if (!Object.keys(cfg.mcpServers).length) delete cfg.mcpServers;
  if (!Object.keys(cfg).length) {
    fs.rmSync(mcpFile, { force: true });
    return { changed: true, deleted: true };
  }
  fs.writeFileSync(mcpFile, JSON.stringify(cfg, null, 2) + '\n');
  return { changed: true, deleted: false };
}

/**
 * Remove the managed block from CLAUDE.md, and the file itself only if PRAXIS
 * wrote every word of it. A CLAUDE.md with the project's own instructions in it
 * is the single worst file to delete by accident, so the bar for deleting it is
 * that what remains matches, exactly, the boilerplate `patchClaudeMd` writes.
 */
export function removeClaudeMdBlock(claudeMdFile) {
  let content;
  try {
    content = fs.readFileSync(claudeMdFile, 'utf8');
  } catch {
    return { changed: false, deleted: false };
  }
  const start = content.indexOf(CLAUDEMD_START);
  const end = content.indexOf(CLAUDEMD_END);
  if (start === -1 || end === -1 || end < start) return { changed: false, deleted: false };

  const without = (content.slice(0, start) + content.slice(end + CLAUDEMD_END.length))
    .split('\n')
    .filter((l) => l.trim() !== CLAUDEMD_LINE)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  // Nothing of the project's own left — just our heading, or nothing at all.
  if (!without.trim() || without.trim() === CLAUDEMD_HEADING) {
    fs.rmSync(claudeMdFile, { force: true });
    return { changed: true, deleted: true };
  }
  fs.writeFileSync(claudeMdFile, without.replace(/^\n+/, '').trimEnd() + '\n');
  return { changed: true, deleted: false };
}

/**
 * Drop the `.praxis/` ignore rule PRAXIS added.
 *
 * The `.claude/settings.local.json` rule it also added is deliberately left
 * alone: keeping personal settings out of git is worth doing whether or not
 * PRAXIS is installed, and silently un-ignoring a file somebody has been
 * relying on is a worse outcome than one stale comment.
 */
export function removeGitignoreRule(root) {
  const file = path.join(root, '.gitignore');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { changed: false };
  }
  if (!raw.includes(GITIGNORE_RULE)) return { changed: false };
  const next = raw.replace(GITIGNORE_RULE, '').replace(/\n{3,}/g, '\n\n');
  if (next.trim()) fs.writeFileSync(file, next.replace(/^\n+/, ''));
  else fs.rmSync(file, { force: true });
  return { changed: true, deleted: !next.trim() };
}

/**
 * The slash commands this project has, including ones retired in later
 * releases. `init` copies the templates it ships and never deletes the ones it
 * stopped shipping, so a long-lived install still carries `praxis-cost`,
 * `praxis-roi` and `praxis-hud` — removed in 0.11.0. Uninstall matches on the
 * `praxis-` prefix rather than on today's template list, or it would leave
 * exactly those three behind.
 */
export function praxisCommandFiles(commandsDir) {
  try {
    return fs
      .readdirSync(commandsDir)
      .filter((f) => f.startsWith('praxis-') && f.endsWith('.md'))
      .sort()
      .map((f) => path.join(commandsDir, f));
  } catch {
    return [];
  }
}

/**
 * Where PRAXIS wrote notes inside the user's Obsidian vault, if it did.
 *
 * `vaultDirFor` puts them at `<vault>/Praxis/<project>`, so everything PRAXIS
 * ever wrote is under one folder and everything ELSE in that vault is the
 * user's own writing. This returns only that folder. The vault itself is never
 * a candidate for removal — someone's second brain is not ours to delete.
 */
export function vaultPraxisDirs(vaultRootPath, projectName) {
  if (!vaultRootPath) return null;
  const praxisDir = path.join(vaultRootPath, 'Praxis');
  const projectDir = path.join(praxisDir, projectName);
  if (!fs.existsSync(projectDir)) return null;
  // If this is the only project in the vault, the now-empty `Praxis/` wrapper
  // goes too — otherwise other projects still live there and it stays.
  let siblings = [];
  try {
    siblings = fs.readdirSync(praxisDir).filter((f) => f !== projectName);
  } catch {
    /* unreadable — keep the wrapper */
  }
  return { projectDir, wrapperDir: siblings.length ? null : praxisDir };
}
