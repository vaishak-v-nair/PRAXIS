import path from 'node:path';
import { CLAIM_SCHEMA, stableId, validateManifest } from './schema.js';

const CLAIM_SIGNAL = /\b(pass(?:ed|es)?|fail(?:ed|s)?|fix(?:ed|es)?|implement(?:ed|s)?|add(?:ed|s)?|creat(?:ed|es)?|updat(?:ed|es)?|remov(?:ed|es)?|chang(?:ed|es)?|build(?:s| built)?|test(?:s|ed)?|work(?:s|ing)?|complete(?:d)?|done)\b/i;
const FILE_TOKEN = /(?:^|[\s`'"(])((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:[A-Za-z0-9]{1,12}))(?=$|[\s`'"),.;:])/g;

export function extractClaimsFromText(text, source = { kind: 'report' }, fallbackPaths = []) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
  const claims = [];
  for (const [index, line] of lines.entries()) {
    if (!CLAIM_SIGNAL.test(line)) continue;
    const paths = [];
    for (const match of line.matchAll(FILE_TOKEN)) paths.push(match[1].replace(/\\/g, '/'));
    const lower = line.toLowerCase();
    let kind = 'generic';
    let requiredEvidence = [];
    if (/\btests?\b/.test(lower) && /\b(pass|passed|passes|green|successful)\b/.test(lower)) {
      kind = 'tests-pass'; requiredEvidence = ['test-result'];
    } else if (/\b(build|typecheck|compile)\b/.test(lower) && /\b(pass|passed|passes|successful|succeeds|built)\b/.test(lower)) {
      kind = 'build-pass'; requiredEvidence = ['build-result'];
    } else if (paths.length && /\b(updated|modified|changed|created|removed|deleted)\s+(?:the\s+)?(?:file\s+)?[`'\"]?(?:[A-Za-z0-9_.-]+[\\/])*[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,12}\b/i.test(line)) {
      kind = 'file-change'; requiredEvidence = ['file-change'];
    }
    const scopedPaths = paths.length ? paths : kind === 'generic' ? fallbackPaths : [];
    claims.push({
      id: stableId(`${index}\0${line}`), sourceText: line, predicate: line,
      scope: { kind, paths: scopedPaths }, source: { ...source, line: index + 1 }, requiredEvidence, required: true,
    });
  }
  return validateManifest({ schema: CLAIM_SCHEMA, claims });
}

export function manifestFromManualClaims(values) {
  return extractClaimsFromText(values.join('\n'), { kind: 'manual' });
}
