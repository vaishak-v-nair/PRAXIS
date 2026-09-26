import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { redact } from '../redact.js';
import { agentSpawn } from '../jobs/spawn.js';
import { changedLines } from './regen-static.js';
const BASE_ENV = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'COMSPEC', 'ComSpec', 'WINDIR', 'HOME', 'USERPROFILE', 'TMP', 'TEMP', 'LANG', 'LC_ALL'];
export function buildTrustedEnv(policy, source = process.env) { const out = {}; for (const key of [...BASE_ENV, ...policy.allowedEnv]) if (source[key] !== undefined) out[key] = source[key]; out.CI = '1'; out.PRAXIS_VERIFY = '1'; return out; }
function digest(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
export function terminateProcessTree(child) { if (!child?.pid) return; try { if (process.platform === 'win32') execFileSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); else process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } }
export function runBounded(argv, { cwd, env, timeoutMs, maxOutputBytes, signal } = {}) {
  return new Promise((resolve) => { const started = Date.now(); let launch;
    try { launch = agentSpawn(argv, { env }); } catch (error) { resolve({ code: null, error: error.message, timedOut: false, cancelled: false, overflow: false, durationMs: Date.now() - started, stdoutDigest: digest(''), stderrDigest: digest(''), stdoutBytes: 0, stderrBytes: 0 }); return; }
    const child = spawn(launch.file, launch.args, { cwd, env, windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), overflow = false, timedOut = false, cancelled = false, settled = false;
    const add = (which, chunk) => { const current = which === 'stdout' ? stdout : stderr, next = Buffer.concat([current, chunk]); if (next.length > maxOutputBytes) { overflow = true; terminateProcessTree(child); } if (which === 'stdout') stdout = next.subarray(0, maxOutputBytes); else stderr = next.subarray(0, maxOutputBytes); };
    child.stdout?.on('data', (c) => add('stdout', c)); child.stderr?.on('data', (c) => add('stderr', c));
    const timer = setTimeout(() => { timedOut = true; terminateProcessTree(child); }, timeoutMs), onAbort = () => { cancelled = true; terminateProcessTree(child); }; if (signal) signal.aborted ? onAbort() : signal.addEventListener('abort', onAbort, { once: true });
    const done = (code, error = null) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); const out = redact(stdout.toString('utf8')), err = redact(stderr.toString('utf8')); resolve(Object.freeze({ code: Number.isInteger(code) ? code : null, error: error?.message || null, timedOut, cancelled, overflow, durationMs: Date.now() - started, stdoutDigest: digest(out), stderrDigest: digest(err), stdoutBytes: stdout.length, stderrBytes: stderr.length })); };
    child.on('error', (e) => done(null, e)); child.on('close', (code) => done(code));
  });
}
function git(cwd, args) { return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function coverageFor(file, claims, target) {
  if (!file) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')), files = raw.files || raw;
    return Object.fromEntries(claims.map((claim) => {
      const paths = claim.scope.paths || [], pathEvidence = paths.map((wanted) => {
        const key = Object.keys(files).find((item) => item.replace(/\\/g, '/').endsWith(wanted));
        const expectedChangedLines = changedLines(target, wanted);
        if (!key) return { path: wanted, expectedChangedLines, coveredChangedLines: [] };
        const row = files[key], covered = new Set();
        if (Array.isArray(row.executed_lines)) for (const line of row.executed_lines) covered.add(Number(line));
        if (row.s && row.statementMap) for (const [id, count] of Object.entries(row.s)) if (Number(count) > 0 && row.statementMap[id]?.start?.line) covered.add(Number(row.statementMap[id].start.line));
        return { path: wanted, expectedChangedLines, coveredChangedLines: expectedChangedLines.filter((line) => covered.has(line)) };
      });
      return [claim.id, { paths: pathEvidence, allChangedLinesCovered: pathEvidence.length > 0 && pathEvidence.every((item) => item.expectedChangedLines.length > 0 && item.coveredChangedLines.length === item.expectedChangedLines.length) }];
    }));
  } catch { return null; }
}
export async function runTrustedObservers(target, claims, ledger, policy, { signal } = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-verify-')), worktree = path.join(parent, 'source'); let added = false, cleanupError = null;
  try { git(target.root, ['worktree', 'add', '--detach', '--force', worktree, target.head]); added = true; const env = buildTrustedEnv(policy);
    for (const command of policy.commands) {
      const related = command.claimIds.length ? claims.filter((c) => command.claimIds.includes(c.id)) : claims.filter((c) => command.evidence === 'test-result' ? c.scope.kind === 'tests-pass' || c.requiredEvidence.includes('test-result') : command.evidence === 'build-result' ? c.scope.kind === 'build-pass' : command.evidence === 'ci-result');
      const result = await runBounded(command.argv, { cwd: worktree, env, timeoutMs: command.timeoutMs, maxOutputBytes: policy.maxOutputBytes, signal }), failed = result.cancelled || result.timedOut || result.overflow || result.error || result.code !== 0;
      ledger.append({ observer: command.evidence === 'ci-result' ? 'ci-result' : 'trusted-command', version: 1, claimIds: related.map((c) => c.id), applicability: command.evidence, strength: 'supporting', status: failed ? result.code && result.code !== 0 ? 'contradicts' : 'failed' : 'supports', details: { commandId: command.id, argv: command.argv, ...result, network: policy.network } });
      if (!failed && command.evidence === 'test-result') { const coverage = coverageFor(command.coverageFile ? path.resolve(worktree, command.coverageFile) : null, related, target);
        for (const claim of related) { const row = coverage?.[claim.id], hasPaths = (row?.paths || []).length > 0, all = hasPaths && row.allChangedLinesCovered; ledger.append({ observer: 'dynamic-coverage', version: 1, claimIds: [claim.id], applicability: 'test execution of claimed changed paths', strength: 'direct', status: coverage && hasPaths ? all ? 'supports' : 'contradicts' : 'not-observed', details: row || { coverageFile: command.coverageFile, reason: 'coverage data unavailable or claim has no paths' } }); }
      } if (result.cancelled) break;
    }
  } finally { if (added) try { git(target.root, ['worktree', 'remove', '--force', worktree]); } catch (e) { cleanupError = e.message; } try { fs.rmSync(parent, { recursive: true, force: true }); } catch (e) { cleanupError ||= e.message; } }
  if (cleanupError) ledger.append({ observer: 'trusted-cleanup', version: 1, claimIds: [], applicability: 'temporary worktree cleanup', strength: 'none', status: 'failed', details: { error: cleanupError } }); return ledger.entries();
}
