import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tokenize, BM25Index, buildProjectIndex, retrieveContext } from '../src/lib/retrieval/bm25.js';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-bm25-test-'));
  fs.mkdirSync(path.join(dir, '.praxis', 'archive', 'sessions'), { recursive: true });
  return dir;
}

test('tokenize normalizes text and removes stop words', () => {
  const tokens = tokenize('The quick brown fox jumps over the lazy dog! And why not?');
  assert.ok(!tokens.includes('the'));
  assert.ok(!tokens.includes('and'));
  assert.ok(!tokens.includes('why'));
  assert.ok(!tokens.includes('not'));
  assert.ok(tokens.includes('quick'));
  assert.ok(tokens.includes('brown'));
  assert.ok(tokens.includes('fox'));
  assert.ok(tokens.includes('jumps'));
  assert.ok(tokens.includes('lazy'));
  assert.ok(tokens.includes('dog'));
});

test('BM25Index ranks documents matching multiple terms higher', () => {
  const index = new BM25Index();
  index.addDocument({
    id: 'doc1',
    title: 'Database connection config',
    content: 'We configured Postgres database pooling with SSL connection parameters.',
  });
  index.addDocument({
    id: 'doc2',
    title: 'Frontend styles',
    content: 'Updated CSS theme variables and responsive padding layout for mobile.',
  });
  index.addDocument({
    id: 'doc3',
    title: 'Postgres migration',
    content: 'Ran database migration for users table in Postgres database.',
  });
  index.build();

  const results = index.search('Postgres database migration');
  assert.ok(results.length > 0);
  assert.equal(results[0].id, 'doc3'); // has all three keywords
  assert.equal(results[1].id, 'doc1'); // has Postgres and database
});

test('BM25Index handles empty queries and non-matching queries gracefully', () => {
  const index = new BM25Index();
  index.addDocument({ id: 'doc1', content: 'hello world' });
  index.build();

  assert.deepEqual(index.search(''), []);
  assert.deepEqual(index.search('xyznonexistentterm12345'), []);
});

test('retrieveContext searches sandbox memory and archive sessions', () => {
  const sbox = sandbox();
  const praxisDir = path.join(sbox, '.praxis');

  fs.writeFileSync(
    path.join(praxisDir, 'memory.md'),
    '# PRAXIS Memory\n## Project\nBuilding an agent trust substrate with cryptographic receipts.'
  );

  fs.writeFileSync(
    path.join(praxisDir, 'archive', 'sessions', '2026-08-01-auth.md'),
    'Implemented JWT authentication tokens and session refresh cookies.'
  );

  const resMem = retrieveContext(praxisDir, 'cryptographic receipts');
  assert.ok(resMem.length > 0);
  assert.equal(resMem[0].id, 'memory');

  const resAuth = retrieveContext(praxisDir, 'authentication cookies');
  assert.ok(resAuth.length > 0);
  assert.equal(resAuth[0].id, '2026-08-01-auth');
});
