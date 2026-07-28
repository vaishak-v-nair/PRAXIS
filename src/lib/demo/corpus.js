// Loading and validating the replay corpus.
//
// The corpus is a curated recording of a real session (see
// scripts/curate-demo-corpus.mjs). It ships inside the npm tarball, so replay
// makes ZERO network calls — that is what lets the demo promise a stranger a
// sealed receipt in under a minute on any machine, including one with no
// agent CLI and no account.
//
// Everything here fails with a NAMED reason. The demo is the first thing a
// stranger runs; a stack trace at that moment is the end of the conversation.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where the packaged corpus lives inside the installed package. */
export function corpusPath() {
  return process.env.PRAXIS_DEMO_CORPUS || path.join(HERE, '..', '..', 'demo', 'corpus.json');
}

/** A corpus that would not replay cleanly is a corpus we refuse to play. */
export function validateCorpus(c) {
  const problems = [];
  if (!c || typeof c !== 'object') return ['corpus is not an object'];
  if (!Array.isArray(c.beats) || !c.beats.length) problems.push('no beats to play');
  if (!c.evidence || !Array.isArray(c.evidence.commands_run)) problems.push('no evidence to seal');
  if (!c.verdicts || !c.verdicts.before || !c.verdicts.after) problems.push('missing recorded verdicts');

  for (const b of c.beats || []) {
    if (b.kind === 'verdict' && !c.verdicts?.[b.which]) problems.push(`beat references missing verdict "${b.which}"`);
    if (b.claimRef) {
      const found = (c.verdicts?.before?.claims || []).some((x) => x.key === b.claimRef);
      if (!found) problems.push(`beat references missing claim "${b.claimRef}"`);
    }
    if (!b.text && !b.claimRef && b.kind !== 'verdict') problems.push(`beat of kind "${b.kind}" has nothing to show`);
  }
  return problems;
}

/**
 * Read the corpus off disk.
 * @returns {{ok:true, corpus:object} | {ok:false, reason:string, detail:string}}
 */
export function loadCorpus(file = corpusPath()) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return {
      ok: false,
      reason: 'corpus-missing',
      detail:
        e.code === 'ENOENT'
          ? 'the packaged demo recording is not in this install'
          : `the demo recording could not be read (${e.code || e.message})`,
    };
  }
  let corpus;
  try {
    corpus = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'corpus-corrupt', detail: 'the demo recording is not valid JSON' };
  }
  const problems = validateCorpus(corpus);
  if (problems.length) {
    return { ok: false, reason: 'corpus-corrupt', detail: `the demo recording is incomplete — ${problems[0]}` };
  }
  return { ok: true, corpus };
}
