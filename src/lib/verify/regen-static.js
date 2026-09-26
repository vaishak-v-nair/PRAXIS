// Ported from Workbench ReGen's bounded reality.py checks. Committed blobs
// are read through Git; submitted code is never imported or executed.
import { execFileSync } from 'node:child_process';
const MOCKS = /(?:from|import|require\s*\()\s*['"]?(?:unittest\.mock|mock|pytest_mock|fakeredis|moto|responses)['"]?/i;
const CONSTANT_SUCCESS = /\b(?:return|resolve)\s+(?:true|\{\s*['"]?(?:success|ok)['"]?\s*:\s*(?:true|True)|\{\s*['"]status['"]\s*:\s*['"](?:success|ok)['"])/i;
const WRITE_NAME = /\b(?:def\s+|function\s+)?(?:save|create|update|delete|send|upload|persist|insert|write|commit|charge|process)(?:_|[A-Z]|\s*\()/i;
const SIDE_EFFECT = /\b(?:fetch|axios\.|requests\.|http\.|https\.|execute|executemany|save|commit|writeFile|insert|update|delete|send|upload|charge)\s*\(/i;
const FIXTURE = /(?:^|\/)(?:test|tests|__tests__|fixtures|__fixtures__|mocks|__mocks__)(?:\/|$)|(?:^|\/)(?:test_.*|.*\.(?:test|spec)\.[^/]+)$/i;
function git(root, args, maxBuffer = 4 * 1024 * 1024) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer }); }
export function committedText(target, relative) { if (FIXTURE.test(relative)) return { text: '', fixture: true }; try { const text = git(target.root, ['show', `${target.head}:${relative}`]); return { text: text.includes('\0') ? '' : text.slice(0, 2 * 1024 * 1024), fixture: false }; } catch { return { text: '', fixture: false }; } }
export function diffEvidence(target, relative) { try { const args = target.base ? ['diff', '--unified=0', target.base, target.head, '--', relative] : ['show', '--format=', '--unified=0', target.head, '--', relative], diff = git(target.root, args), hunks = [...diff.matchAll(/^@@[^@]*@@\s*(.*)$/gm)].map((m) => m[1].trim()).filter(Boolean).slice(0, 100); return { touched: diff.length > 0, hunks, digestInput: diff }; } catch { return { touched: false, hunks: [], digestInput: '' }; } }
export function changedLines(target, relative) {
  try {
    const args = target.base ? ['diff', '--unified=0', target.base, target.head, '--', relative] : ['show', '--format=', '--unified=0', target.head, '--', relative];
    const diff = git(target.root, args), lines = [];
    for (const match of diff.matchAll(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/gm)) {
      const start = Number(match[1]), count = match[2] === undefined ? 1 : Number(match[2]);
      for (let line = start; line < start + count && lines.length < 10000; line++) lines.push(line);
    }
    return lines;
  } catch { return []; }
}
export function inspectFalseSuccess(target, paths) {
  const findings = [];
  for (const relative of paths.slice(0, 100)) { const { text, fixture } = committedText(target, relative); if (!text || fixture) continue; const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) { const window = lines.slice(i, i + 8).join('\n'); if (MOCKS.test(lines[i])) findings.push({ path: relative, line: i + 1, rule: 'production-mock-import' }); if (WRITE_NAME.test(lines[i]) && CONSTANT_SUCCESS.test(window) && !SIDE_EFFECT.test(window)) findings.push({ path: relative, line: i + 1, rule: 'constant-success-without-side-effect' }); if (findings.length >= 60) return findings; }
  } return findings;
}
