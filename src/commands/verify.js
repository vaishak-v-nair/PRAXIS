import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { emitJson, wantsJson } from '../lib/jsonout.js';
import { verifyStatic, verifyTrusted, verifyWithMcp, VerifyInputError } from '../lib/verify/index.js';
import { renderVerify, exitCodeFor } from '../lib/verify/render.js';
import { extractClaims, logExtraction } from '../lib/verify/extract.js';
import { readBoundedRegularFile } from '../lib/verify/schema.js';
function value(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; }
function values(argv, name) { const out = []; for (let i = 0; i < argv.length; i++) if (argv[i] === name && argv[i + 1]) out.push(argv[++i]); return out; }
function git(cwd, args) { try { return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } }
function commitNarrative(cwd, head) { const text = git(cwd, ['log', '-1', '--format=%s%n%b', head || 'HEAD']); if (!text) throw new VerifyInputError('missing-agent-report', 'The selected commit has no readable completion report. Use --report <file>.'); const [subject, ...rest] = text.split(/\r?\n/); return { subject, report: [subject, ...rest].join('\n').trim() }; }
function latestAgentCommit(cwd) {
  const records = git(cwd, ['log', '-50', '--format=%H%x00%an%x00%ae%x00%B%x1e']).split('\x1e');
  for (const record of records) {
    const [sha, name, email, ...body] = record.trim().split('\0');
    if (sha && /(?:ai[ -]?agent|claude|codex|copilot|gemini|cursor|devin)/i.test([name, email, body.join(' ')].join(' '))) return sha;
  }
  return null;
}
export function parseVerifyArgs(argv = [], cwd = process.cwd()) {
  const mode = value(argv, '--mode') || 'static'; if (!['static', 'trusted'].includes(mode)) throw new VerifyInputError('invalid-mode', 'Mode must be static or trusted.');
  const resolveFile = (v) => v ? path.resolve(cwd, v) : null;
  return { cwd, mode, base: value(argv, '--base'), head: value(argv, '--head'), manifest: resolveFile(value(argv, '--manifest')), report: resolveFile(value(argv, '--report')), taskFile: resolveFile(value(argv, '--task-file')), taskText: value(argv, '--task'), trustPolicy: resolveFile(value(argv, '--trust-policy')), mcpPolicy: resolveFile(value(argv, '--mcp-policy')), claims: values(argv, '--claim'), previewClaims: argv.includes('--preview-claims') };
}
function errorPayload(error) { return { ok: false, error: { code: error.code || 'verify-failed', summary: error.message, cause: error.message, preserved: [], next_command: error.nextCommand || null } }; }
export async function verifyCommand(argv = []) {
  const json = wantsJson(argv);
  if (argv.includes('--help') || argv.includes('-h')) { const help = 'praxis verify [--task <text>|--task-file <file>] [--report <file>|--manifest <file>|--claim <text>] [--base <ref>] [--head <ref>] [--mode static|trusted] [--trust-policy <file>] [--mcp-policy <file>] [--json]'; if (json) emitJson({ ok: true, help }); else console.log(`\n  ${help}\n\n  With no arguments, verifies the selected commit using its commit message as the agent report.\n`); return 0; }
  try {
    const options = parseVerifyArgs(argv); if (!options.head) { const agentHead = latestAgentCommit(options.cwd); if (agentHead) { options.head = agentHead; options.selectedBy = 'latest-agent-commit'; } } const narrative = !options.taskText || !options.report && !options.manifest && !options.claims.length ? commitNarrative(options.cwd, options.head) : null;
    if (options.taskFile) options.taskText = readBoundedRegularFile(options.taskFile, 'task description');
    options.taskText ||= narrative?.subject;
    if (!options.manifest && !options.claims.length) {
      const report = options.report ? readBoundedRegularFile(options.report, 'agent report') : narrative.report;
      const fallbackPaths = git(options.cwd, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', options.head || 'HEAD']).split(/\r?\n/).filter(Boolean);
      options.manifestObject = await extractClaims(report, { task: options.taskText, fallbackPaths });
      const root = git(options.cwd, ['rev-parse', '--show-toplevel']); logExtraction(root, { task: options.taskText, report, manifest: options.manifestObject });
      if (options.previewClaims) { const preview = { ok: false, status: 'CLAIMS_PREVIEW', proposedClaims: options.manifestObject.claims }; if (json) emitJson(preview); else console.log('\n' + preview.proposedClaims.map((c) => `  - ${c.sourceText}`).join('\n') + '\n'); return 3; }
    }
    const controller = new AbortController(), onInterrupt = () => controller.abort(); if (options.mode === 'trusted') process.once('SIGINT', onInterrupt);
    let result; try { result = options.mcpPolicy ? await verifyWithMcp({ ...options, signal: controller.signal }) : options.mode === 'trusted' ? await verifyTrusted({ ...options, signal: controller.signal }) : verifyStatic(options); } finally { process.removeListener('SIGINT', onInterrupt); }
    const code = exitCodeFor(result); if (json) emitJson({ ok: code === 0, ...result }); else console.log(renderVerify(result)); return code;
  } catch (error) { const payload = errorPayload(error); if (json) emitJson(payload); else console.error(`\n  PRAXIS Verify: ${payload.error.summary}\n`); return error instanceof VerifyInputError ? 2 : 4; }
}
