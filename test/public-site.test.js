import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildPublicSite } from '../scripts/build-public-site.mjs';
import { buildVercelSite } from '../scripts/build-vercel-site.mjs';
import { releaseAvailability } from '../web/test-your-project/install.mjs';

test('Cloudflare staging replaces only its owned output and excludes private files and upload metadata', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-public-stage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'web/test-your-project'), { recursive: true });
  fs.writeFileSync(path.join(root, 'web/index.html'), '<title>PRAXIS</title>');
  fs.writeFileSync(path.join(root, 'web/_headers'), '/*\n  X-Content-Type-Options: nosniff\n');
  fs.writeFileSync(path.join(root, 'web/.env'), 'private-fixture');
  fs.mkdirSync(path.join(root, 'web/_qa'), { recursive: true });
  fs.writeFileSync(path.join(root, 'web/_qa/capture.html'), 'private-qa-fixture');
  fs.writeFileSync(path.join(root, 'web/notes.html'), 'unreviewed-fixture');
  fs.writeFileSync(path.join(root, 'web/test-your-project/index.html'), '<title>Trial</title>');
  fs.writeFileSync(path.join(root, 'web/test-your-project/release.json'), '{}');
  const first = buildPublicSite(root);
  fs.writeFileSync(path.join(first.destination, 'obsolete.js'), '// stale');
  const second = buildPublicSite(root);
  assert.ok(second.files.some(file => file.file === '_headers'));
  assert.ok(second.files.some(file => file.file === 'test-your-project/index.html'));
  assert.equal(fs.existsSync(path.join(second.destination, '.env')), false);
  assert.equal(fs.existsSync(path.join(second.destination, '_qa/capture.html')), false);
  assert.equal(fs.existsSync(path.join(second.destination, 'notes.html')), false);
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

test('production Vercel output excludes upload metadata and preserves public page and scanner hashes', () => {
  const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  assert.equal(config.buildCommand, 'node scripts/build-vercel-site.mjs');
  assert.equal(config.outputDirectory, 'web/dist');
  const result = spawnSync(process.execPath, ['scripts/build-vercel-site.mjs'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const destination = path.resolve(config.outputDirectory);
  const staged = path.resolve(JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8')).assets.directory);
  assert.equal(fs.existsSync(path.join(destination, 'manifest-for-upload.json')), false);
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  for (const name of ['index.html', 'appearance.js', 'test-your-project/index.html', 'test-your-project/local.html', 'test-your-project/engine/manifest.json']) {
    assert.equal(hash(path.join(destination, name)), hash(path.join(staged, name)), name);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'test-your-project/engine/manifest.json'), 'utf8'));
  for (const [name, expected] of Object.entries(manifest.files)) {
    assert.equal(hash(path.join(destination, 'test-your-project/engine', name)), expected, name);
    assert.equal(hash(path.join('apps/workbench/backend/regen', name)), expected, name);
  }
});

test('Vercel staging retains the generated engine and removes stale output without nesting it', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-vercel-stage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'web/test-your-project/engine'), { recursive: true });
  fs.writeFileSync(path.join(root, 'web/index.html'), '<title>PRAXIS</title>');
  fs.writeFileSync(path.join(root, 'web/vercel.json'), '{}');
  fs.writeFileSync(path.join(root, 'web/.env'), 'private-fixture');
  fs.writeFileSync(path.join(root, 'web/test-your-project/engine/manifest.json'), '{"schema":"fixture"}');
  const first = buildVercelSite(root);
  fs.writeFileSync(path.join(first.destination, 'obsolete.js'), '// stale');
  const second = buildVercelSite(root);
  assert.equal(fs.readFileSync(path.join(second.destination, 'test-your-project/engine/manifest.json'), 'utf8'), '{"schema":"fixture"}');
  for (const name of ['obsolete.js', 'dist', '.env', 'vercel.json', 'manifest-for-upload.json']) {
    assert.equal(fs.existsSync(path.join(second.destination, name)), false, name);
  }
  assert.equal(fs.readFileSync(path.join(root, 'web/.env'), 'utf8'), 'private-fixture');
});

test('Vercel staging refuses to replace an unrelated output directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-vercel-unowned-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'web/dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'web/dist/keep.txt'), 'unrelated');
  assert.throws(() => buildVercelSite(root), /unrelated/);
  assert.equal(fs.readFileSync(path.join(root, 'web/dist/keep.txt'), 'utf8'), 'unrelated');
});
