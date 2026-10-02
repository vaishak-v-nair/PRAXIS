import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPublicSite } from '../scripts/build-public-site.mjs';
import { releaseAvailability } from '../web/test-your-project/install.mjs';

test('Cloudflare staging replaces only its owned output and excludes private files and upload metadata', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-public-stage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'web/test-your-project'), { recursive: true });
  fs.writeFileSync(path.join(root, 'web/index.html'), '<title>PRAXIS</title>');
  fs.writeFileSync(path.join(root, 'web/_headers'), '/*\n  X-Content-Type-Options: nosniff\n');
  fs.writeFileSync(path.join(root, 'web/.env'), 'private-fixture');
  fs.writeFileSync(path.join(root, 'web/test-your-project/index.html'), '<title>Trial</title>');
  fs.writeFileSync(path.join(root, 'web/test-your-project/release.json'), '{}');
  const first = buildPublicSite(root);
  fs.writeFileSync(path.join(first.destination, 'obsolete.js'), '// stale');
  const second = buildPublicSite(root);
  assert.ok(second.files.some(file => file.file === '_headers'));
  assert.ok(second.files.some(file => file.file === 'test-your-project/index.html'));
  assert.equal(fs.existsSync(path.join(second.destination, '.env')), false);
  assert.equal(fs.existsSync(path.join(second.destination, 'obsolete.js')), false);
  assert.match(fs.readFileSync(path.join(second.destination, '.assetsignore'), 'utf8'), /manifest-for-upload/);
  assert.equal(fs.readFileSync(path.join(root, 'web/.env'), 'utf8'), 'private-fixture');
});

test('consumer install stays unavailable for pending, unreachable or mismatched npm releases', async () => {
  assert.equal(await releaseAvailability('0.14.2', { fetchImpl: async () => new Response('', { status: 404 }) }), false);
  await assert.rejects(releaseAvailability('0.14.2', { fetchImpl: async () => new Response('', { status: 503 }) }), /registry/);
  await assert.rejects(releaseAvailability('0.14.2', { fetchImpl: async () => Response.json({ name: 'other', version: '0.14.2' }) }), /does not match/);
  await assert.rejects(releaseAvailability('../other'), /Invalid release/);
  assert.equal(await releaseAvailability('0.14.2', { fetchImpl: async () => Response.json({ name: 'praxis-memory', version: '0.14.2', bin: { 'praxis-memory': 'src/cli.js' } }) }), true);
});

test('Cloudflare config names the existing static Worker and builds canonical browser evidence', () => {
  const config = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
  assert.equal(config.name, 'praxis');
  assert.equal(config.assets.not_found_handling, 'none');
  assert.match(config.build.command, /build-web.mjs/);
  assert.equal(config.main, undefined);
  for (const binding of ['kv_namespaces', 'd1_databases', 'r2_buckets', 'vars']) assert.equal(config[binding], undefined);
});
