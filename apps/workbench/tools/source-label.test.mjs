import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLabel } from '../lib/source-label.mjs';

test('source presentation distinguishes local, upload, and remote origins without exposing opaque IDs', () => {
  assert.equal(sourceLabel('upload://private-id/project'), 'Uploaded folder');
  assert.equal(sourceLabel('E:\\BrosKi\\project'), 'Local folder');
  assert.equal(sourceLabel('/home/user/project'), 'Local folder');
  assert.equal(sourceLabel('https://github.com/org/repo'), 'GitHub repository');
  assert.equal(sourceLabel('git@github.com:org/repo.git'), 'GitHub repository');
  assert.equal(sourceLabel('https://gitlab.com/org/repo'), 'Remote repository');
  assert.equal(sourceLabel('not-a-known-source'), 'Project source');
});
