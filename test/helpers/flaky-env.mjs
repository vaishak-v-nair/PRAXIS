// One retry, for environment failures only, and never quietly.
//
// A handful of tests here drive the REAL job engine: they spawn a detached
// runner, which spawns an agent, which writes files and a transcript. That is
// the point — it is what makes the live path testable without spending tokens.
// It also means two or three real node processes per test on a CI runner with
// two cores, and those runners do sometimes refuse to fork: the signature is a
// job that never starts, or starts and produces nothing at all.
//
// That is an environment failure, not a defect, and re-running the same commit
// green is not evidence of anything. But blanket retries are how real
// regressions get buried, so this is deliberately narrow:
//
//   - ONE retry, never more.
//   - Only for failures whose shape says "nothing ran" — an empty read, a
//     spawn refused, a job that never appeared. A wrong VALUE fails instantly,
//     because a wrong value is a bug.
//   - Loud. Every retry prints, so a test that starts needing one is visible
//     rather than slowly becoming permanent.
//
// If the printed line ever becomes common, the answer is not a third attempt.

/** Failures that mean "the process never ran", as opposed to "it ran and was wrong". */
const ENVIRONMENTAL = [
  /did not match the regular expression[\s\S]*Input:\s*''/, // read a log that is still empty
  /spawn-failed/,
  /spawn \w+ (EAGAIN|ENOMEM|ENOENT)/,
  /EAGAIN|ENOMEM/,
  /'gone' !== |!== 'done'/, // a job that never reached a terminal state
];

export function isEnvironmental(err) {
  const text = [err && err.message, err && err.stack].filter(Boolean).join('\n');
  return ENVIRONMENTAL.some((re) => re.test(text));
}

/**
 * Run a test body, allowing exactly one retry if it failed for environmental
 * reasons. Anything else propagates immediately and unchanged.
 *
 * @param {string} label  what to print if a retry happens
 * @param {() => Promise<void>} fn
 */
export async function withEnvRetry(label, fn) {
  try {
    await fn();
    return;
  } catch (err) {
    if (!isEnvironmental(err)) throw err;
    // Loud on purpose. A silent retry is how a flake becomes a permanent
    // resident; a printed one is a thing somebody can notice and count.
    console.error(
      `\n  [env-retry] "${label}" failed in a way that means nothing ran ` +
        `(${String(err.message).split('\n')[0].slice(0, 90)}). Retrying ONCE.\n`,
    );
    await fn();
  }
}
