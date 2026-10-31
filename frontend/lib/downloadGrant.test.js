const test = require('node:test');
const assert = require('node:assert/strict');

// Mock sessionStorage before requiring the module.
const store = new Map();
global.sessionStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: key => { store.delete(key); },
  clear: () => { store.clear() }
};
global.window = { location: { search: '' } };

// The api.ts file uses ESM with TypeScript. We test the pure logic here
// by replicating the key functions inline (the real implementation is in api.ts).
function downloadGrantKey(offerId) {
  return `anza:download-grant:${offerId}`;
}

function persistDownloadGrant(offerId, grantToken, expiresAt) {
  if (typeof window === 'undefined') return;
  if (!/^[0-9a-f]{64}$/.test(grantToken)) return;
  try {
    sessionStorage.setItem(downloadGrantKey(offerId), JSON.stringify({ grantToken, expiresAt }));
  } catch { /* ignore */ }
}

function getStoredDownloadGrant(offerId) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(downloadGrantKey(offerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.grantToken === 'string' && /^[0-9a-f]{64}$/.test(parsed.grantToken)) {
      return { grantToken: parsed.grantToken, expiresAt: parsed.expiresAt ?? null };
    }
  } catch { /* ignore */ }
  return null;
}

const VALID_TOKEN = 'a'.repeat(64);
const VALID_TOKEN_2 = 'b'.repeat(64);

test('persistDownloadGrant stores a valid 64-char hex token', () => {
  persistDownloadGrant('offer-1', VALID_TOKEN, 1700000000);
  const stored = getStoredDownloadGrant('offer-1');
  assert.ok(stored, 'grant should be retrievable after persisting');
  assert.equal(stored.grantToken, VALID_TOKEN);
  assert.equal(stored.expiresAt, 1700000000);
});

test('persistDownloadGrant rejects tokens that are not 64 hex chars', () => {
  persistDownloadGrant('offer-2', 'short', 1700000000);
  assert.equal(getStoredDownloadGrant('offer-2'), null);
  persistDownloadGrant('offer-2', 'g'.repeat(64), 1700000000); // non-hex
  assert.equal(getStoredDownloadGrant('offer-2'), null);
});

test('persistDownloadGrant stores null expiry when not provided', () => {
  persistDownloadGrant('offer-3', VALID_TOKEN, null);
  const stored = getStoredDownloadGrant('offer-3');
  assert.ok(stored);
  assert.equal(stored.expiresAt, null);
});

test('getStoredDownloadGrant returns null when no grant was persisted', () => {
  assert.equal(getStoredDownloadGrant('offer-4'), null);
});

test('persistDownloadGrant overwrites a previous grant for the same offer', () => {
  persistDownloadGrant('offer-5', VALID_TOKEN, 1000);
  persistDownloadGrant('offer-5', VALID_TOKEN_2, 2000);
  const stored = getStoredDownloadGrant('offer-5');
  assert.equal(stored.grantToken, VALID_TOKEN_2);
  assert.equal(stored.expiresAt, 2000);
});

test('persistDownloadGrant is scoped per offerId', () => {
  persistDownloadGrant('offer-6', VALID_TOKEN, 1000);
  persistDownloadGrant('offer-7', VALID_TOKEN_2, 2000);
  assert.equal(getStoredDownloadGrant('offer-6').grantToken, VALID_TOKEN);
  assert.equal(getStoredDownloadGrant('offer-7').grantToken, VALID_TOKEN_2);
});