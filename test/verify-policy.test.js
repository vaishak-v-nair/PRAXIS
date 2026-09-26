import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLedger } from '../src/lib/verify/ledger.js';
import { evaluatePolicy } from '../src/lib/verify/policy.js';

const claims = [{ id: 'c-one', sourceText: 'Updated a.txt', required: true }, { id: 'c-two', sourceText: 'Tests pass', required: true }];

test('policy separates immutable evidence from decisions and absence never passes', () => {
  const ledger = createLedger({ head: 'abc' });
  ledger.append({ observer: 'git-diff', version: 1, claimIds: ['c-one'], status: 'supports', strength: 'direct' });
  ledger.append({ observer: 'static', version: 1, claimIds: ['c-two'], status: 'not-observed' });
  const result = evaluatePolicy(claims, ledger.entries());
  assert.equal(result.decisions[0].verdict, 'VERIFIED');
  assert.equal(result.decisions[1].verdict, 'UNSUPPORTED');
  assert.equal(result.summary.headline, 'INCOMPLETE');
  assert.ok(Object.isFrozen(ledger.entries()[0]));
});

test('direct contradiction outranks support conflict into human review', () => {
  const ledger = createLedger({ head: 'abc' });
  ledger.append({ observer: 'one', version: 1, claimIds: ['c-one'], status: 'supports', strength: 'direct' });
  ledger.append({ observer: 'two', version: 1, claimIds: ['c-one'], status: 'contradicts', strength: 'direct' });
  assert.equal(evaluatePolicy([claims[0]], ledger.entries()).decisions[0].verdict, 'NEEDS_HUMAN_REVIEW');
});

test('same claims evidence and policy produce byte-stable decisions', () => {
  const observations = [{ hash: 'h', claimIds: ['c-one'], status: 'supports', strength: 'direct' }];
  assert.deepEqual(evaluatePolicy([claims[0]], observations), evaluatePolicy([claims[0]], observations));
});
