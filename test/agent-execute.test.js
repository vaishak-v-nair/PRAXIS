import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeAgent } from '../src/lib/jobs/execute.js';

async function fixture(code, options = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-agent-exec-test-'));
  const entry = path.join(cwd, 'agent.cjs'); fs.writeFileSync(entry, code);
  const env = { ...process.env, PRAXIS_AGENT_ADAPTERS: JSON.stringify({ fixture: { plan: [process.execPath, entry] } }) };
  try { return await executeAgent({ tool: 'fixture', task: 'Inspect login; $(never-run) & echo "claim"', cwd, env, ...options }); }
  finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
test('foreground agent receives literal stdin and completion remains an unverified claim', async () => {
  const result = await fixture("let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>console.log(s));");
  assert.equal(result.status, 'completed'); assert.equal(result.exitCode, 0);
  assert.match(result.report, /\$\(never-run\) & echo "claim"/); assert.equal(result.verification, 'not_evaluated');
});
test('a success-looking report cannot override a real process failure', async () => {
  const result = await fixture("console.log('Everything works perfectly');process.exit(7);");
  assert.equal(result.status, 'failed'); assert.equal(result.exitCode, 7);
});
test('empty output does not become a completed plan', async () => {
  assert.equal((await fixture('process.exit(0);')).status, 'failed');
});
test('a hanging coding agent is terminated rather than marked complete', async () => {
  const result = await fixture('setInterval(()=>{},1000);', { timeoutMs: 180 });
  assert.equal(result.status, 'timed_out'); assert.notEqual(result.exitCode, 0);
});
test('output flooding is terminated within the result budget', async () => {
  const result = await fixture("setInterval(()=>process.stdout.write('x'.repeat(4096)),5);", { maxBytes: 1024 });
  assert.equal(result.status, 'output_limit'); assert.equal(result.report.length, 0);
});
test('explicit cancellation stops the owned process', async () => {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 180);
  try { assert.equal((await fixture('setInterval(()=>{},1000);', { signal: controller.signal })).status, 'cancelled'); }
  finally { clearTimeout(timer); }
});
test('an adapter cannot silently substitute editing permission for plan permission', async () => {
  await assert.rejects(fixture('console.log("bad");', { env: { PRAXIS_AGENT_ADAPTERS: JSON.stringify({ fixture: { acceptEdits: [process.execPath] } }) } }), /explicit argv array for mode plan/);
});
test('structured agent errors cannot masquerade as a completed plan with exit zero', async () => {
  const result = await fixture("console.log(JSON.stringify({error:{message:'API credits exhausted'},response:'Everything works'},null,2));");
  assert.equal(result.status, 'failed'); assert.equal(result.exitCode, 0);
});
test('split multibyte characters remain readable in streamed reports', async () => {
  const result = await fixture("const b=Buffer.from('I’ll inspect the résumé.');let i=0;const t=setInterval(()=>{if(i===b.length){clearInterval(t);return;}process.stdout.write(b.subarray(i,i+1));i++;},2);");
  assert.equal(result.status, 'completed'); assert.equal(result.report, 'I’ll inspect the résumé.');
});
