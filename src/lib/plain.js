// The translation layer: Claude answers in developer-speak; many PRAXIS users
// don't read code. plainify() glosses jargon inline — "refactor (rewriting
// code without changing what it does)" — so the HUD story reads like English.
// Curated by hand: short, honest glosses. First occurrence per line only.

export const GLOSSARY = {
  refactor: 'rewriting code without changing what it does',
  refactoring: 'rewriting code without changing what it does',
  api: 'a way for programs to talk to each other',
  endpoint: 'one address a program can call',
  dependency: 'code from someone else this project needs',
  dependencies: 'code from someone else this project needs',
  repository: 'the project folder with its full history',
  'merge conflict': 'two edits collided; needs a human choice',
  lint: 'automatic style checking',
  linter: 'automatic style checker',
  compile: 'turn code into something the computer can run',
  runtime: 'while the program is running',
  schema: 'the defined shape of the data',
  migration: 'a scripted change to the database structure',
  regression: 'something that used to work broke',
  cache: 'a saved copy kept for speed',
  'context window': "the AI's working memory for this session",
  'pull request': 'a proposed set of changes for review',
  'stack trace': 'the error report showing where it broke',
  middleware: 'code that runs between request and response',
  'race condition': 'two things ran at once in the wrong order',
  'edge case': 'a rare situation most code forgets',
  'unit test': 'a small automatic check that code works',
  'test suite': 'the set of automatic checks',
  deploy: 'put it live',
  deployment: 'putting it live',
  'environment variable': 'a setting stored outside the code',
  timeout: 'gave up after waiting too long',
  async: 'runs in the background without waiting',
  parse: 'read and make sense of',
  query: 'a question asked of the database',
  boilerplate: 'standard filler code',
  scaffolding: 'the starter structure',
  breakpoint: 'a marked pause spot for inspection',
  rollback: 'undo back to the previous good state',
};

const PATTERNS = Object.keys(GLOSSARY)
  .sort((a, b) => b.length - a.length) // longest first: "context window" before "context"
  .map((term) => ({
    term,
    re: new RegExp(`\\b(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i'),
  }));

/**
 * Gloss the first occurrence of each known term: "refactor" →
 * "refactor (rewriting code without changing what it does)".
 * Skips terms already followed by a parenthesis (author explained it).
 */
export function plainify(text) {
  let out = String(text);
  for (const { term, re } of PATTERNS) {
    const m = out.match(re);
    if (!m) continue;
    const after = out.slice(m.index + m[1].length);
    if (after.trimStart().startsWith('(')) continue; // already explained
    out = out.slice(0, m.index) + m[1] + ' (' + GLOSSARY[term] + ')' + after;
  }
  return out;
}
