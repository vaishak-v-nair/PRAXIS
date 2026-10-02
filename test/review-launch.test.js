import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { availablePorts, waitForReview, openReview, REVIEW_URL, REVIEW_HEALTH } from '../src/lib/review-launch.js';

test('an occupied port is reported without stopping or replacing the existing service', async t => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(availablePorts([server.address().port]), /already in use/);
  assert.equal(server.listening, true);
});

test('readiness requires both the real API contract and the Project Review page', async () => {
  let ready = false, attempts = 0;
  const fetchImpl = async url => {
    if (url === REVIEW_HEALTH) { attempts++; if (attempts > 1) ready = true; return Response.json(ready ? { status: 'ok', providers: [] } : { status: 'failed', providers: [] }); }
    return new Response('<title>PRAXIS · Project Review</title>');
  };
  await waitForReview({ fetchImpl, sleep: async () => {}, timeout: 100 });
  assert.equal(attempts, 2);
  await assert.rejects(waitForReview({ timeout: 5, sleep: async () => {}, fetchImpl: async url => url === REVIEW_HEALTH
    ? Response.json({ status: 'ok', providers: [] }) : new Response('<title>Other app</title>') }), /did not become ready/);
});

test('browser opening uses a fixed loopback URL and no shell, across supported platforms', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    let call;
    openReview({ platform, spawnImpl: (command, args, options) => { call = { command, args, options }; const child = new EventEmitter(); child.unref = () => {}; return child; } });
    assert.equal(call.args.at(-1), REVIEW_URL);
    assert.equal(call.options.shell, false);
    assert.equal(call.options.windowsHide, true);
  }
});
