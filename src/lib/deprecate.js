// Commands on their way out, and the ones already gone.
//
// PRAXIS grew a handful of features that other people had already built
// better. Keeping them is not free: they pad the tarball, pad the help, pad
// what a reviewer has to hold in their head, and dilute the one sentence this
// product exists to say. So they go — but not abruptly.
//
// The constraint that shapes the mechanism: sixteen shipped files invoke
// `npx -y praxis-memory`, unpinned. Every release lands on every install
// automatically. Deleting a command in a patch would break someone's script
// with no warning and no way back, so a deprecated command KEEPS WORKING and
// says where to go instead. It is removed a minor later, announced.
//
// And when it IS removed it leaves a headstone, not a hole. That same
// auto-upgrading fleet means someone's script calls `praxis cost` the morning
// after this ships; "unknown command" would be a dead end with a typo
// suggestion attached, so the name stays recognised long enough to say what
// replaced it.
//
// Notices go to stderr so piping a command's output stays clean.

export const REMOVAL_VERSION = '0.11.0';

/** Still shipping, still working, on notice. Empty is the goal state. */
export const DEPRECATED = {};

/**
 * Gone. The name is still recognised so the CLI answers usefully instead of
 * guessing at a typo. Removed in 0.11.0 after a full release of deprecation
 * notices, exactly as the contract above promises.
 */
export const REMOVED = {
  cost: {
    since: '0.11.0',
    instead: 'ccusage',
    run: 'npx ccusage',
    why: 'reads the same local files, covers Codex and other agents too, and is far better at it',
  },
  roi: {
    since: '0.11.0',
    instead: 'ccusage',
    run: 'npx ccusage monthly',
    why: 'reads the same local files, covers Codex and other agents too, and is far better at it',
  },
  hud: {
    since: '0.11.0',
    instead: 'cctop',
    run: 'npx cctop',
    why: 'does live session monitoring properly, in a niche already served by seven maintained tools',
  },
};

/** The notice, as a string, so it can be tested without capturing output. */
export function deprecationNotice(name, removeIn = REMOVAL_VERSION) {
  const d = DEPRECATED[name];
  if (!d) return null;
  return (
    `praxis ${name} is deprecated and will be removed in ${removeIn}.\n` +
    `Use ${d.instead} instead — it ${d.why}:  ${d.run}\n` +
    `PRAXIS is the evidence layer: receipts, the judge, and the deck. That is where the work goes now.`
  );
}

/** What to say when someone runs a command that is already gone. */
export function removalNotice(name) {
  const r = REMOVED[name];
  if (!r) return null;
  return (
    `praxis ${name} was removed in ${r.since}.\n` +
    `Use ${r.instead} instead — it ${r.why}:  ${r.run}\n` +
    `PRAXIS is the evidence layer: receipts, the judge, and the deck. That is where the work goes now.`
  );
}

/** Print it, dimly, without stopping the command from doing its job. */
export function warnDeprecated(name, write = (s) => process.stderr.write(s)) {
  const notice = deprecationNotice(name);
  if (!notice) return false;
  write('\n  ' + notice.split('\n').join('\n  ') + '\n\n');
  return true;
}

export function isDeprecated(name) {
  return Object.prototype.hasOwnProperty.call(DEPRECATED, name);
}

export function isRemoved(name) {
  return Object.prototype.hasOwnProperty.call(REMOVED, name);
}
