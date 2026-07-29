// "Did you mean" — the answer sized to the mistake.
//
// `praxis recieve` used to dump the entire help screen: thirty-eight lines,
// four sections, a footer — at someone who mistyped one word and needs one.
// A wrong guess costs them a glance; the full dump costs them the scroll
// position they were working at.

/**
 * Damerau-Levenshtein distance (optimal string alignment). Command names are
 * tiny, so the O(a·b) table is nothing — and counting a transposition as one
 * edit matters here, because swapped letters ARE the typo ("stauts").
 */
export function distance(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/**
 * The nearest candidate worth suggesting, or null.
 *
 * Two edits is the ceiling — past that a suggestion is a guess wearing
 * confidence, and a wrong "did you mean" is worse than none. A shared
 * beginning of three letters buys one edit back, because command typos
 * overwhelmingly keep their opening ("recieve" is three edits from
 * "receipt", and obviously it).
 */
export function didYouMean(input, candidates) {
  const s = String(input || '').toLowerCase();
  if (!s) return null;
  let best = null;
  for (const c of candidates) {
    let d = distance(s, c);
    let p = 0;
    while (p < s.length && p < c.length && s[p] === c[p]) p++;
    if (p >= 3) d -= 1;
    if (best === null || d < best.d) best = { c, d };
  }
  return best && best.d <= 2 ? best.c : null;
}
