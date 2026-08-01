// What "update PRAXIS" actually means — which is less obvious than it sounds.
//
// Most of PRAXIS updates itself and needs nobody's help. The hooks and the MCP
// server are wired as `npx -y praxis-memory ...` on purpose (settings.js), so
// every session end already runs the newest published version. That is the
// whole reason the package name is frozen.
//
// Three things do NOT follow, and they are the entire point of this command:
//
//   1. A global install (`npm i -g praxis-memory`) is a pinned copy on PATH. It
//      goes stale silently and answers `praxis --version` with whatever it was
//      the day it was installed.
//   2. The `/praxis-*` slash commands are COPIED into .claude/commands at init
//      time. A release that adds a command does not add it to projects that
//      already exist — they simply never learn it is there.
//   3. Commands retired in a later release leave their template behind, because
//      init copies what it ships and has never deleted anything.
//
// So the honest answer to "am I up to date?" is different per surface, and this
// says so per surface rather than printing one reassuring number.

import { compareVersions } from './tray-host.js';

export { compareVersions };

/**
 * Pure: given what is installed where, what actually needs doing?
 *
 * Separated from the network and the filesystem so the advice is testable —
 * including the case that matters most, where everything is already current and
 * the right answer is to say so and stop.
 *
 * @param {object} o
 * @param {string} o.running        version of the copy executing right now
 * @param {string|null} o.latest    newest on the registry, null if unreachable
 * @param {string|null} o.global    version of the `praxis` on PATH, null if none
 * @param {string[]} [o.missingCommands]  templates this release ships that the project lacks
 * @param {string[]} [o.retiredCommands]  commands in the project that no release ships
 */
export function updatePlan({ running, latest, global: globalVersion, missingCommands = [], retiredCommands = [] } = {}) {
  const actions = [];
  const notes = [];

  const offline = !latest;
  const behind = !offline && compareVersions(latest, running) > 0;
  const ahead = !offline && compareVersions(running, latest) > 0;

  if (offline) {
    notes.push({
      id: 'offline',
      text: 'could not reach the npm registry — the version check was skipped, everything else still ran',
    });
  }

  // The hooks are the reassuring part, and saying it plainly is most of this
  // command's job: people expect to have to update, and mostly they do not.
  notes.push({
    id: 'hooks',
    text: behind
      ? `your hooks already run ${latest} — they resolve \`npx -y praxis-memory\` fresh every session`
      : 'your hooks run the newest published version automatically, every session',
  });

  if (globalVersion && !offline && compareVersions(latest, globalVersion) > 0) {
    actions.push({
      id: 'global',
      why: `the \`praxis\` command on your PATH is ${globalVersion}, and ${latest} is out`,
      run: 'npm install -g praxis-memory',
    });
  } else if (globalVersion) {
    notes.push({ id: 'global-current', text: `the \`praxis\` on your PATH is ${globalVersion} — current` });
  }

  if (missingCommands.length) {
    actions.push({
      id: 'commands-missing',
      why: `${missingCommands.length} slash command${missingCommands.length === 1 ? '' : 's'} this release ships ${
        missingCommands.length === 1 ? 'is' : 'are'
      } not in this project (${missingCommands.join(', ')})`,
      run: null, // this command does it
    });
  }
  if (retiredCommands.length) {
    actions.push({
      id: 'commands-retired',
      why: `${retiredCommands.length} slash command${retiredCommands.length === 1 ? '' : 's'} no longer shipped ${
        retiredCommands.length === 1 ? 'is' : 'are'
      } still here (${retiredCommands.join(', ')})`,
      run: null,
    });
  }

  return {
    running,
    latest,
    global: globalVersion,
    behind,
    ahead,
    offline,
    actions,
    notes,
    upToDate: actions.length === 0,
  };
}
