import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createZapReceiptRetriever } from '../src/services/nostr/zap-retriever.js';

const offerEventId = 'a'.repeat(64);
const receipt = { id: 'b'.repeat(64), kind: 9735, tags: [] };

function socketFactory(respond) {
  const sockets = [];
  class FakeSocket extends EventEmitter {
    constructor(url) {
      super();
      this.url = url;
      sockets.push(this);
      queueMicrotask(() => this.emit('open'));
    }
    addEventListener(name, callback) { this.on(name, callback); }
    send(serialized) { respond(this, JSON.parse(serialized)); }
    close() { this.emit('close'); }
  }
  return { WebSocketImpl: FakeSocket, sockets };
}

function purchase(relays = ['wss://relay-one.example', 'wss://relay-two.example']) {
  return {
    offer_event_id: offerEventId,
    invoice_issued_at: 1000,
    zap_request: { tags: [['relays', ...relays]] }
  };
}

test('retrieves and deduplicates kind 9735 receipts from request relays with bounded filters', async () => {
  const relayBehavior = (socket, request) => {
    assert.equal(request[0], 'REQ');
    assert.deepEqual(request[2], {
      kinds: [9735], '#e': [offerEventId], since: 880, limit: 100
    });
    socket.emit('message', { data: JSON.stringify(['EVENT', request[1], receipt]) });
    socket.emit('message', { data: JSON.stringify(['EOSE', request[1]]) });
  };
  const { WebSocketImpl, sockets } = socketFactory(relayBehavior);
  const events = await createZapReceiptRetriever({ WebSocketImpl })(purchase());
  assert.deepEqual(events, [receipt]);
  assert.equal(sockets.length, 2);
  assert.ok(sockets.every(socket => socket.url.startsWith('wss://relay-')));
});

test('relay outage is explicit when no configured relay returns a completed query', async () => {
  const { WebSocketImpl } = socketFactory(socket => socket.emit('error', new Error('offline')));
  await assert.rejects(
    createZapReceiptRetriever({ WebSocketImpl })(purchase(['wss://offline.example'])),
    { status: 503, code: 'ZAP_RELAYS_UNAVAILABLE' }
  );
});

test('rejects missing or excessive receipt relay lists from stored requests', async () => {
  const { WebSocketImpl } = socketFactory(() => {});
  const findReceipts = createZapReceiptRetriever({ WebSocketImpl });
  await assert.rejects(findReceipts(purchase([])), { status: 500, code: 'PURCHASE_RELAY_CONFIG_INVALID' });
  await assert.rejects(findReceipts(purchase(Array.from({ length: 11 }, (_, i) => `wss://relay${i}.example`))),
    { status: 500, code: 'PURCHASE_RELAY_CONFIG_INVALID' });
});
