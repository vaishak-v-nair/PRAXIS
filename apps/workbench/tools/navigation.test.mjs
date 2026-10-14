import test from 'node:test';
import assert from 'node:assert/strict';
import { readWorkspaceLocation, workspaceLocation, reviewViews, readFindingLocation, findingLocation } from '../lib/navigation.mjs';

test('legacy job URLs open Overview and all supported sections round trip', () => {
  const base = 'http://localhost:3000/?job=saved';
  assert.deepEqual(readWorkspaceLocation(base), { id: 'saved', view: 'overview', creating: false });
  for (const view of reviewViews) {
    const next = workspaceLocation(base, { id: 'saved', view });
    assert.equal(readWorkspaceLocation(new URL(next, base)).view, view);
  }
});
test('unrecognized sections cannot create an empty workspace', () => {
  assert.equal(readWorkspaceLocation('http://localhost/?job=a&view=unknown').view, 'overview');
  assert.equal(readWorkspaceLocation('http://localhost/?view=findings').view, 'overview');
});
test('new review and native folder picker open intake without implying execution', () => {
  for (const query of ['new=1', 'project=E%3A%5Cproject']) {
    assert.deepEqual(readWorkspaceLocation(`http://localhost/?${query}`), { id: null, view: 'overview', creating: true });
  }
  assert.equal(readWorkspaceLocation('http://localhost/?job=a&project=x&new=1').creating, false);
});
test('changing review clears selection and intake state, preserving unrelated parameters and hash', () => {
  const result = workspaceLocation('http://localhost/?job=old&view=findings&new=1&project=x&finding=f1&q=secret&severity=high&theme=dark#main', { id: 'next' });
  assert.equal(result, '/?theme=dark&job=next#main');
});
test('home and new review preserve no stale job selection', () => {
  assert.equal(workspaceLocation('http://localhost/?job=a&view=changes'), '/');
  assert.equal(workspaceLocation('http://localhost/?job=a&view=changes', { creating: true }), '/?new=1');
});
test('identifiers are encoded as data and retain the original pathname', () => {
  const result = workspaceLocation('http://localhost/review?lang=en', { id: 'a&new=1' });
  assert.equal(result, '/review?lang=en&job=a%26new%3D1');
  assert.deepEqual(readWorkspaceLocation(new URL(result, 'http://localhost')), { id: 'a&new=1', view: 'overview', creating: false });
});
test('finding, severity, and search survive a shareable URL without changing review context', () => {
  const base = 'http://localhost/?job=saved&view=findings&theme=dark';
  const next = findingLocation(base, { finding: 'f&1', severity: 'high', query: ' login path ' });
  assert.equal(next, '/?job=saved&view=findings&theme=dark&finding=f%261&severity=high&q=login+path');
  assert.deepEqual(readFindingLocation(new URL(next, base)), { finding: 'f&1', severity: 'high', query: 'login path' });
  assert.deepEqual(readWorkspaceLocation(new URL(next, base)), { id: 'saved', view: 'findings', creating: false });
});
test('invalid finding filters cannot persist or affect an evidence verdict', () => {
  const base = 'http://localhost/?job=saved&view=findings&severity=made-up&q=foo&finding=f1';
  assert.deepEqual(readFindingLocation(base), { finding: 'f1', severity: 'all', query: 'foo' });
  assert.equal(findingLocation(base, { severity: 'made-up' }), '/?job=saved&view=findings');
});
