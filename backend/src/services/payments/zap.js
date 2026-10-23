import { createHash } from 'node:crypto';
import { nip57 } from 'nostr-tools';
import { finalizeEvent, generateSecretKey, verifyEvent } from 'nostr-tools/pure';

function singleTag(event, name) {
  const matches = event.tags.filter(tag => tag[0] === name);
  if (matches.length !== 1 || !matches[0][1]) throw new TypeError(`Zap receipt must contain exactly one ${name} tag.`);
  return matches[0][1];
}

export function createZapRequest({ receiverPubkey, amountMsat, relays, offerEventId, now = Math.floor(Date.now() / 1000) }) {
  const template = nip57.makeZapRequest({ pubkey: receiverPubkey, amount: amountMsat, relays });
  template.created_at = now;
  template.tags.push(['e', offerEventId], ['t', 'contentport-license-purchase-v1']);
  const ephemeralSecret = generateSecretKey();
  try {
    const event = finalizeEvent(template, ephemeralSecret);
    const json = JSON.stringify(event);
    if (nip57.validateZapRequest(json) || !verifyEvent(event)) throw new TypeError('Could not create a valid NIP-57 Zap request.');
    return { event, json };
  } finally {
    ephemeralSecret.fill(0);
  }
}

export function validateZapReceipt({ receipt, purchase, verify = verifyEvent, now = Math.floor(Date.now() / 1000) }) {
  if (!receipt || receipt.kind !== 9735 || receipt.pubkey !== purchase.receiver_pubkey || !verify(receipt)) {
    throw new TypeError('Zap receipt signature or receiver key is invalid.');
  }
  if (singleTag(receipt, 'description') !== purchase.zap_request_json) {
    throw new TypeError('Zap receipt is not associated with this purchase request.');
  }
  const request = JSON.parse(purchase.zap_request_json);
  if (nip57.validateZapRequest(purchase.zap_request_json) || request.id !== purchase.zap_request_id) {
    throw new TypeError('Stored Zap request is invalid.');
  }
  if (singleTag(receipt, 'bolt11').toLowerCase() !== purchase.invoice_request.toLowerCase()) {
    throw new TypeError('Zap receipt invoice does not match this purchase.');
  }
  if (singleTag(receipt, 'P') !== request.pubkey ||
      singleTag(receipt, 'p') !== purchase.receiver_pubkey ||
      singleTag(receipt, 'e') !== purchase.offer_event_id) {
    throw new TypeError('Zap receipt recipient or offer does not match this purchase.');
  }
  if (singleTag(request, 'p') !== purchase.receiver_pubkey ||
      singleTag(request, 'amount') !== String(purchase.amount_msat) ||
      singleTag(request, 'e') !== purchase.offer_event_id) {
    throw new TypeError('Zap request does not match the creator, amount, and offer.');
  }
  if (!Number.isSafeInteger(receipt.created_at) || receipt.created_at < Number(purchase.invoice_issued_at) ||
      receipt.created_at > now + 60) {
    throw new TypeError('Zap receipt timestamp is invalid for this invoice.');
  }
  const preimages = receipt.tags.filter(tag => tag[0] === 'preimage');
  if (preimages.length > 1) throw new TypeError('Zap receipt contains multiple preimages.');
  if (preimages.length === 1) {
    if (!/^[0-9a-f]{64}$/.test(preimages[0][1]) ||
        createHash('sha256').update(Buffer.from(preimages[0][1], 'hex')).digest('hex') !== purchase.payment_hash) {
      throw new TypeError('Zap receipt preimage does not match the invoice payment hash.');
    }
  }
  return { receipt_event_id: receipt.id, settled_at: receipt.created_at, receiver_pubkey: receipt.pubkey };
}
