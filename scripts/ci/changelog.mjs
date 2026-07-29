#!/usr/bin/env node
// The changelog gate.
//
// CHANGELOG.md is the source of truth for what a release changed, and this
// script is what makes that sentence enforceable rather than aspirational:
// the release workflow refuses to publish a version the file does not name,
// and the GitHub Release body is extracted FROM the file — so the two surfaces
// a person might read (the repo file, the release page) cannot drift apart.
//
// The stakes are the fleet's: sixteen shipped files run `npx -y praxis-memory`
// unpinned, every release lands on every install automatically, and this file
// is the only notice that fleet gets. A release nobody wrote up is a release
// nobody consented to.
//
//   node scripts/ci/changelog.mjs notes 0.10.0     print the section, or fail
//
// Zero dependencies, like everything else in scripts/ci — the suite and the
// gates run before any install step exists.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every `## [version] — date` section, in file order. */
export function sections(md) {
  const out = [];
  const re = /^## \[([^\]]+)\](?:\s*[—–-]+\s*(.+?))?\s*$/gm;
  let m;
  const heads = [];
  while ((m = re.exec(md))) heads.push({ version: m[1], date: m[2] || null, at: m.index, end: re.lastIndex });
  for (let i = 0; i < heads.length; i++) {
    const bodyEnd = i + 1 < heads.length ? heads[i + 1].at : md.length;
    out.push({
      version: heads[i].version,
      date: heads[i].date,
      body: md.slice(heads[i].end, bodyEnd).trim(),
    });
  }
  return out;
}

/**
 * The release notes for one version.
 *
 * Failure reasons are precise because the person reading them is mid-release:
 * `missing` names the fix (usually: rename [Unreleased] to this version) and
 * `empty` refuses a heading with nothing under it — an entry that says nothing
 * is the drift this gate exists to catch, wearing a disguise.
 *
 * @returns {{ok:true, body:string, date:string|null} | {ok:false, reason:'missing'|'empty', hint:string}}
 */
export function notesFor(md, version) {
  const all = sections(md);
  const hit = all.find((s) => s.version === version);
  if (!hit) {
    const unreleased = all.find((s) => /^unreleased$/i.test(s.version));
    const hint =
      unreleased && unreleased.body
        ? `CHANGELOG.md has no [${version}] section. The [Unreleased] section has content — rename it to [${version}] with today's date, commit, and re-tag.`
        : `CHANGELOG.md has no [${version}] section and [Unreleased] is empty. Write up what this release changes before publishing it onto every install.`;
    return { ok: false, reason: 'missing', hint };
  }
  if (!hit.body) {
    return { ok: false, reason: 'empty', hint: `CHANGELOG.md names [${version}] but the section is empty — a heading is not a changelog.` };
  }
  return { ok: true, body: hit.body, date: hit.date };
}

function main() {
  const [verb, version] = process.argv.slice(2);
  if (verb !== 'notes' || !version) {
    console.error('usage: node scripts/ci/changelog.mjs notes <version>');
    process.exit(2);
  }
  const md = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const res = notesFor(md, version.replace(/^v/, ''));
  if (!res.ok) {
    console.error(`::error title=changelog gate::${res.hint}`);
    process.exit(1);
  }
  process.stdout.write(res.body + '\n');
}

if (process.argv[1] && process.argv[1].endsWith('changelog.mjs')) main();
