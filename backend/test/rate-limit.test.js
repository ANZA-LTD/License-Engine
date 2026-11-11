import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../src/app.js';

test('rate limiter: per-address, per-kind fixed windows', () => {
  let now = 0;
  const limiter = createRateLimiter({ limits: { read: 3, write: 1 }, nowMs: () => now });
  assert.equal(limiter.allow('1.1.1.1', 'write'), true);
  assert.equal(limiter.allow('1.1.1.1', 'write'), false, 'second write in the window is refused');
  assert.equal(limiter.allow('2.2.2.2', 'write'), true, 'another address has its own window');
  for (let i = 0; i < 3; i++) assert.equal(limiter.allow('1.1.1.1', 'read'), true);
  assert.equal(limiter.allow('1.1.1.1', 'read'), false, 'reads are counted separately');
  now = 60001;
  assert.equal(limiter.allow('1.1.1.1', 'write'), true, 'the window resets after a minute');
});
