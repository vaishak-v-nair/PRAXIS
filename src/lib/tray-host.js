/**
 * The decisions `praxis tray` makes about a host process, separated from the
 * spawning and killing so they can be tested without putting an icon in
 * anyone's notification area.
 *
 * Two of these exist because of bugs that were reproduced, not imagined:
 *
 *  - `isHostCommandLine` — the stop and restart paths used to run
 *    `taskkill /PID <n> /T /F` on whatever number was in the pidfile. A pidfile
 *    outlives its host, Windows recycles pids, and the next session start would
 *    force-kill an unrelated process TREE. Proven by writing a sacrificial
 *    process's pid into a pidfile and watching `praxis tray` destroy it.
 *
 *  - `shouldRestage` — the staged host script used to be compared byte-for-byte
 *    against the running install's copy, and ANY difference triggered a
 *    kill-and-restage. With two installs on one machine (a global `praxis` and
 *    `npx -y praxis-memory`, which is what the SessionStart hook runs) the two
 *    take turns overwriting each other, once per invocation, forever. Six
 *    alternating invocations produced four different host pids.
 */

/**
 * Read a pidfile's contents. The host writes a bare integer; a JSON record is
 * tolerated so a future format change cannot strand an old pidfile.
 * @returns {number} the pid, or 0 when there isn't a usable one
 */
export function parsePidFile(text) {
  if (text == null) return 0;
  const raw = String(text).trim();
  if (!raw) return 0;
  if (raw[0] === '{') {
    try {
      const n = parseInt(JSON.parse(raw).pid, 10);
      return Number.isInteger(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  }
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Does this command line belong to a PRAXIS tray host for THIS project?
 *
 * Deliberately strict, and false on anything it cannot confirm: the caller uses
 * this to decide whether to kill a process, so "I am not sure" has to mean
 * "leave it alone". Compares whole arguments rather than substrings, so
 * `E:\PA` never matches a host running for `E:\PA2`.
 */
export function isHostCommandLine(cmdline, root) {
  if (!cmdline || !root) return false;
  const c = String(cmdline);
  if (!/tray\.ps1|tray-mac\.js/i.test(c)) return false;
  const norm = (s) =>
    String(s)
      .replace(/^"+|"+$/g, '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase();
  const target = norm(root);
  if (!target) return false;
  // quoted arguments count as one token — project paths contain spaces
  const tokens = c.match(/"[^"]*"|\S+/g) || [];
  return tokens.some((t) => norm(t) === target);
}

/** Numeric semver compare. Prerelease tags are ignored — only the ladder matters. */
export function compareVersions(a, b) {
  const parse = (v) =>
    String(v ?? '')
      .trim()
      .split(/[-+]/)[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const dx = x[i] || 0;
    const dy = y[i] || 0;
    if (dx !== dy) return dx > dy ? 1 : -1;
  }
  return 0;
}

/**
 * Should the staged host script be replaced with the running install's copy?
 *
 * @param {object} o
 * @param {{version:string,sha256:string}|null} o.staged  what is on disk now
 * @param {{version:string,sha256:string}} o.incoming     what this install ships
 * @param {boolean} o.explicit  the user typed `praxis tray`, rather than the
 *                              SessionStart hook running `tray --ensure`
 *
 * The asymmetry is the whole point. An automatic invocation only ever moves
 * FORWARD, so an older install passing through cannot undo a newer one and the
 * two cannot ping-pong. A person typing the command gets what they typed.
 */
export function shouldRestage({ staged, incoming, explicit = false } = {}) {
  if (!incoming) return false;
  if (!staged || !staged.sha256) return true; // nothing staged, or staged by a praxis too old to leave a stamp
  if (staged.sha256 === incoming.sha256) return false; // already exactly this script
  if (explicit) return true;
  return compareVersions(incoming.version, staged.version) > 0;
}
