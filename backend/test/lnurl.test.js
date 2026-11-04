import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseLightningAddress, requestZapInvoice, resolveLightningAddress } from '../src/services/payments/lnurl.js';

function fakeRequest(responseForUrl, requests = []) {
  return (url, options, onResponse) => {
    requests.push({ url: new URL(url), options });
    const request = new EventEmitter();
    request.destroy = error => request.emit('error', error);
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = 200;
      onResponse(response);
      queueMicrotask(() => {
        response.emit('data', Buffer.from(JSON.stringify(responseForUrl(new URL(url)))));
        response.emit('end');
      });
    };
    return request;
  };
}

test('normalizes a creator Lightning Address and resolves an HTTPS LNURL-pay Zap endpoint', async () => {
  assert.deepEqual(parseLightningAddress('Creator@Wallet.Example.com'), {
    address: 'Creator@wallet.example.com', username: 'Creator', domain: 'wallet.example.com'
  });
  const endpointResponse = {
    callback: 'https://receiver.example.net/lnurl/callback', allowsNostr: true,
    nostrPubkey: 'a'.repeat(64), minSendable: 1000, maxSendable: 1000000
  };
  const requests = [];
  const endpoint = await resolveLightningAddress('Creator@wallet.example.com', {
    lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
    requestImpl: fakeRequest(() => endpointResponse, requests)
  });
  assert.deepEqual(endpoint, {
    address: 'Creator@wallet.example.com',
    callback: 'https://receiver.example.net/lnurl/callback',
    nostr_pubkey: 'a'.repeat(64), min_sendable: 1000, max_sendable: 1000000
  });
  assert.equal(requests[0].url.pathname, '/.well-known/lnurlp/Creator');
  let pinnedAddress;
  requests[0].options.lookup('ignored', {}, (_error, address, family) => {
    pinnedAddress = { address, family };
  });
  assert.deepEqual(pinnedAddress, { address: '8.8.8.8', family: 4 });
  assert.equal(requests[0].options.servername, 'wallet.example.com');
});

test('rejects private DNS answers and LNURL services that do not support signed Zaps', async () => {
  let requestCount = 0;
  const requestImpl = (...args) => { requestCount += 1; return fakeRequest(() => ({}))(...args); };
  await assert.rejects(resolveLightningAddress('creator@wallet.example.com', {
    lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }], requestImpl
  }), { code: 'LIGHTNING_ADDRESS_INVALID' });
  assert.equal(requestCount, 0);

  await assert.rejects(resolveLightningAddress('creator@wallet.example.com', {
    lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
    requestImpl: fakeRequest(() => ({ callback: 'https://receiver.example.net/cb', allowsNostr: false }))
  }), { code: 'ZAPS_NOT_SUPPORTED' });
});

test('sends the exact Zap request and amount to LNURL callback before validating its invoice', async () => {
  const requests = [];
  const endpoint = {
    address: 'creator@wallet.example.com', callback: 'https://receiver.example.net/callback',
    nostr_pubkey: 'a'.repeat(64), min_sendable: 1000, max_sendable: 2000
  };
  const zapRequestJson = '{"kind":9734,"content":"purchase"}';
  await assert.rejects(requestZapInvoice({
    endpoint, zapRequestJson, amountMsat: 1000, network: 'mainnet'
  }, {
    lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
    requestImpl: fakeRequest(() => ({ pr: 'not-a-bolt11-invoice' }), requests)
  }), { code: 'LIGHTNING_INVOICE_INVALID' });
  assert.equal(requests[0].url.searchParams.get('amount'), '1000');
  assert.equal(requests[0].url.searchParams.get('nostr'), zapRequestJson);
});

test('rejects invalid Lightning Address formats before network access', () => {
  for (const address of ['creator@localhost', 'creator@127.0.0.1', 'creator@bad domain', 'name@@wallet.com']) {
    assert.throws(() => parseLightningAddress(address), { code: 'INVALID_LIGHTNING_ADDRESS' });
  }
});
