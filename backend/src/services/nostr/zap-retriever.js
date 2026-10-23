import { randomUUID } from 'node:crypto';
import { HttpError } from '../../utils/errors.js';

function queryRelay(url, request, { WebSocketImpl, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(url);
    const subscriptionId = randomUUID();
    const events = new Map();
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* The relay may already have closed. */ }
      error ? reject(error) : resolve([...events.values()]);
    };
    const timer = setTimeout(() => finish(new Error('Zap receipt relay timed out')), timeoutMs);
    socket.addEventListener('open', () => {
      try {
        socket.send(JSON.stringify(['REQ', subscriptionId, {
          kinds: [9735],
          '#e': [request.offer_event_id],
          since: Math.max(0, Number(request.invoice_issued_at) - 120),
          limit: 100
        }]));
      } catch (error) { finish(error); }
    });
    socket.addEventListener('message', ({ data }) => {
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      if (!Array.isArray(message)) return;
      if (message[0] === 'EVENT' && message[1] === subscriptionId &&
          message[2]?.kind === 9735 && typeof message[2].id === 'string') {
        events.set(message[2].id, message[2]);
      } else if (message[0] === 'EOSE' && message[1] === subscriptionId) finish();
    });
    socket.addEventListener('error', () => finish(new Error('Zap receipt relay connection failed')));
    socket.addEventListener('close', () => finish(new Error('Zap receipt relay closed before EOSE')));
  });
}

export function createZapReceiptRetriever({ WebSocketImpl = globalThis.WebSocket, timeoutMs = 5000 } = {}) {
  if (!WebSocketImpl) throw new Error('A WebSocket implementation is required for Nostr receipt retrieval.');
  return async purchase => {
    const zapRequest = typeof purchase.zap_request === 'string' ? JSON.parse(purchase.zap_request) : purchase.zap_request;
    const relayTag = zapRequest.tags.find(tag => tag[0] === 'relays');
    const relays = relayTag?.slice(1) ?? [];
    if (!relays.length || relays.length > 10) throw new HttpError(500, 'PURCHASE_RELAY_CONFIG_INVALID', 'The stored Zap request has no supported receipt relays.');
    const results = await Promise.allSettled(relays.map(url => queryRelay(url, {
      offer_event_id: purchase.offer_event_id,
      invoice_issued_at: purchase.invoice_issued_at
    }, { WebSocketImpl, timeoutMs })));
    const successful = results.filter(result => result.status === 'fulfilled');
    if (!successful.length) throw new HttpError(503, 'ZAP_RELAYS_UNAVAILABLE', 'No configured Nostr relay is currently available for receipt lookup.');
    const events = new Map();
    for (const result of successful) for (const event of result.value) events.set(event.id, event);
    return [...events.values()];
  };
}
