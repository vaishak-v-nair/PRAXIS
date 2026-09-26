import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createAppJwt, GitHubApi } from '../src/lib/verify/github-api.js';
import { checkConclusion, parsePullRequestDelivery, processPullRequest, verifyWebhookSignature } from '../src/lib/verify/github-app.js';
import { verifyGitHubPullRequest } from '../src/lib/verify/github-worker.js';
import { CLAIM_SCHEMA } from '../src/lib/verify/schema.js';

function payload(overrides = {}) {
  return Buffer.from(JSON.stringify({
    action: 'opened', installation: { id: 42 },
    repository: { id: 7, name: 'repo', owner: { login: 'owner' }, clone_url: 'https://github.com/owner/repo.git' },
    pull_request: { number: 3, title: 'Add feature', body: 'Added src/a.js', base: { sha: 'a'.repeat(40), ref: 'main' }, head: { sha: 'b'.repeat(40) } },
    ...overrides,
  }));
}

function result(verdict = 'VERIFIED', complete = true) {
  return { complete, target: { base: 'a'.repeat(40), head: 'b'.repeat(40) }, claims: [{ id: 'c1', sourceText: 'Added src/a.js' }], decision: { decisions: [{ claimId: 'c1', verdict, reason: 'evidence reason' }] } };
}

test('webhook validation uses the exact raw body and rejects changes', () => {
  const body = payload(), secret = 'a strong test webhook secret';
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  assert.equal(verifyWebhookSignature(body, secret, signature), true);
  assert.equal(verifyWebhookSignature(Buffer.concat([body, Buffer.from(' ')]), secret, signature), false);
});

test('pull request delivery is bounded to exact repository and commit identifiers', () => {
  const parsed = parsePullRequestDelivery('pull_request', payload());
  assert.equal(parsed.kind, 'pull_request'); assert.equal(parsed.number, 3); assert.equal(parsed.base, 'a'.repeat(40));
  assert.throws(() => parsePullRequestDelivery('pull_request', payload({ repository: { name: '../bad' } })), /Incomplete|Invalid/);
  assert.equal(parsePullRequestDelivery('issues', payload()).kind, 'ignored');
});

test('advisory mode is neutral and blocking mode follows per-claim evidence', () => {
  assert.equal(checkConclusion(result('CONTRADICTED'), 'advisory'), 'neutral');
  assert.equal(checkConclusion(result('VERIFIED'), 'blocking'), 'success');
  assert.equal(checkConclusion(result('UNSUPPORTED'), 'blocking'), 'failure');
  assert.equal(checkConclusion(result('VERIFIED', false), 'blocking'), 'failure');
});

test('pull request processing creates a check and one upserted comment', async () => {
  const calls = [], api = {
    baseConfig: async () => ({ mode: 'advisory' }),
    createCheck: async (...args) => { calls.push(['create', ...args]); return { id: 91 }; },
    updateCheck: async (...args) => { calls.push(['update', ...args]); },
    upsertComment: async (...args) => { calls.push(['comment', ...args]); },
  };
  const delivery = parsePullRequestDelivery('pull_request', payload());
  const handled = await processPullRequest(delivery, { api, deliveryId: 'delivery-123', verifyPullRequest: async () => result('CONTRADICTED') });
  assert.equal(handled.mode, 'advisory');
  assert.equal(calls[1][4].conclusion, 'neutral');
  assert.match(calls[2][4], /CONTRADICTED/);
});

test('GitHub App JWT is RS256 and installation token is repository-scoped', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwt = createAppJwt('123', privateKey.export({ format: 'pem', type: 'pkcs8' }), 2_000_000_000_000);
  const [header, body, signature] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256');
  assert.equal(JSON.parse(Buffer.from(body, 'base64url')).iss, '123');
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`${header}.${body}`), publicKey, Buffer.from(signature, 'base64url')), true);
  let request;
  const api = new GitHubApi({ fetchImpl: async (url, options) => { request = { url, options }; return new Response(JSON.stringify({ token: 'installation-token' }), { status: 201 }); } });
  assert.equal(await api.installationToken({ appId: '123', privateKey, installationId: 42, repositoryId: 7 }), 'installation-token');
  assert.deepEqual(JSON.parse(request.options.body), { repository_ids: [7] });
  assert.doesNotMatch(request.options.authorization || '', /installation-token/);
});

test('blocking opt-in is read only from the exact base revision', async () => {
  let requested = '';
  const api = new GitHubApi({ token: 'token', fetchImpl: async (url) => {
    requested = url;
    const content = Buffer.from(JSON.stringify({ mode: 'blocking' })).toString('base64');
    return new Response(JSON.stringify({ type: 'file', encoding: 'base64', content }), { status: 200 });
  } });
  assert.deepEqual(await api.baseConfig('owner', 'repo', 'a'.repeat(40)), { mode: 'blocking' });
  assert.match(requested, new RegExp(`ref=${'a'.repeat(40)}`));
});

test('GitHub worker binds a PR range to the core engine and persists its signed receipt', async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-github-source-'));
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-github-state-'));
  const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-q'); git('config', 'user.email', 'agent@example.test'); git('config', 'user.name', 'AI Agent');
  fs.writeFileSync(path.join(source, 'app.js'), 'export const value = 1;\n'); git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(source, 'app.js'), 'export const value = 2;\n'); git('add', '.'); git('commit', '-qm', 'Updated app.js'); const head = git('rev-parse', 'HEAD');
  const delivery = { owner: 'owner', repo: 'repo', number: 3, base, head, title: 'Update app', body: 'Updated app.js' };
  const manifest = { schema: CLAIM_SCHEMA, claims: [{ id: 'app', sourceText: 'Updated app.js', predicate: 'app changed', scope: { kind: 'file-change', paths: ['app.js'] }, source: { kind: 'report' }, requiredEvidence: ['file-change'], required: true }] };
  const output = await verifyGitHubPullRequest(delivery, {
    token: 'test-token', stateRoot, extractor: async () => manifest,
    checkout: async (root) => { execFileSync('git', ['clone', '-q', source, root], { windowsHide: true }); execFileSync('git', ['checkout', '-q', '--detach', head], { cwd: root, windowsHide: true }); },
  });
  assert.equal(output.decision.decisions[0].verdict, 'VERIFIED');
  assert.equal(output.receipt.signature.algorithm, 'Ed25519');
  assert.equal(fs.existsSync(output.artifact.file), true);
});
