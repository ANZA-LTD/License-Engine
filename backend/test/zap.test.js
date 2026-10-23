import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { createZapRequest, validateZapReceipt } from '../src/services/payments/zap.js';

const receiverSecret = generateSecretKey();
const receiverPubkey = getPublicKey(receiverSecret);
const offerEventId = 'b'.repeat(64);
const amountMsat = 1000;
const paymentHash = 'c'.repeat(64);

function setup() {
  const zapRequest = createZapRequest({
    receiverPubkey, amountMsat, relays: ['wss://relay.example'], offerEventId, now: 1000
  });
  const purchase = {
    receiver_pubkey: receiverPubkey,
    zap_request_json: zapRequest.json,
    zap_request_id: zapRequest.event.id,
    invoice_request: 'lnbc10n1purchaseinvoice',
    amount_msat: amountMsat,
    offer_event_id: offerEventId,
    invoice_issued_at: 1000,
    payment_hash: paymentHash
  };
  const tags = [
    ['p', receiverPubkey], ['e', offerEventId], ['P', zapRequest.event.pubkey],
    ['bolt11', purchase.invoice_request], ['description', zapRequest.json]
  ];
  const receipt = overrides => finalizeEvent({
    kind: 9735, created_at: 1050, tags: overrides ?? tags, content: ''
  }, receiverSecret);
  return { zapRequest, purchase, receipt };
}

test('NIP-57 Zap request is signed and binds the receiver, exact amount, offer, and relays', () => {
  const { zapRequest } = setup();
  assert.equal(verifyEvent(zapRequest.event), true);
  assert.ok(zapRequest.event.tags.some(tag => tag[0] === 'p' && tag[1] === receiverPubkey));
  assert.ok(zapRequest.event.tags.some(tag => tag[0] === 'amount' && tag[1] === String(amountMsat)));
  assert.ok(zapRequest.event.tags.some(tag => tag[0] === 'e' && tag[1] === offerEventId));
  assert.ok(zapRequest.event.tags.some(tag => tag[0] === 'relays' && tag[1] === 'wss://relay.example'));
});

test('accepts a correctly signed receipt for the exact request and invoice', () => {
  const { purchase, receipt } = setup();
  const valid = receipt();
  const evidence = validateZapReceipt({ receipt: valid, purchase, verify: verifyEvent, now: 1100 });
  assert.deepEqual(evidence, {
    receipt_event_id: valid.id, settled_at: 1050, receiver_pubkey: receiverPubkey
  });
});

test('rejects forged, wrong receiver, wrong offer, wrong invoice, and wrong request receipts', () => {
  const { purchase, receipt } = setup();
  const valid = receipt();
  assert.throws(() => validateZapReceipt({
    receipt: { ...JSON.parse(JSON.stringify(valid)), sig: '0'.repeat(128) },
    purchase, verify: verifyEvent, now: 1100
  }), /signature or receiver key/);
  assert.throws(() => validateZapReceipt({
    receipt: receipt([['p', 'd'.repeat(64)], ...valid.tags.slice(1)]),
    purchase, verify: verifyEvent, now: 1100
  }), /recipient or offer/);
  assert.throws(() => validateZapReceipt({
    receipt: receipt([valid.tags[0], ['e', 'd'.repeat(64)], ...valid.tags.slice(2)]),
    purchase, verify: verifyEvent, now: 1100
  }), /recipient or offer/);
  assert.throws(() => validateZapReceipt({
    receipt: receipt([valid.tags[0], valid.tags[1], valid.tags[2], ['bolt11', 'lnbcwrong'], valid.tags[4]]),
    purchase, verify: verifyEvent, now: 1100
  }), /invoice does not match/);
  assert.throws(() => validateZapReceipt({
    receipt: receipt([valid.tags[0], valid.tags[1], valid.tags[2], valid.tags[3], ['description', '{}']]),
    purchase, verify: verifyEvent, now: 1100
  }), /not associated/);
});

test('rejects duplicate receipt tags, invalid timestamps, and mismatched preimages', () => {
  const { purchase, receipt } = setup();
  const validTags = receipt().tags;
  assert.throws(() => validateZapReceipt({
    receipt: receipt([...validTags, ['p', receiverPubkey]]), purchase, verify: verifyEvent, now: 1100
  }), /exactly one p tag/);
  assert.throws(() => validateZapReceipt({
    receipt: finalizeEvent({ kind: 9735, created_at: 999, tags: validTags, content: '' }, receiverSecret),
    purchase, verify: verifyEvent, now: 1100
  }), /timestamp is invalid/);
  const wrongPreimage = 'e'.repeat(64);
  assert.notEqual(createHash('sha256').update(Buffer.from(wrongPreimage, 'hex')).digest('hex'), paymentHash);
  assert.throws(() => validateZapReceipt({
    receipt: receipt([...validTags, ['preimage', wrongPreimage]]), purchase, verify: verifyEvent, now: 1100
  }), /preimage does not match/);
});

test('a matching optional preimage only binds the receipt to the invoice hash', () => {
  const preimage = 'f'.repeat(64);
  const { purchase, receipt } = setup();
  purchase.payment_hash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
  const evidence = validateZapReceipt({
    receipt: receipt([...(receipt().tags), ['preimage', preimage]]),
    purchase, verify: verifyEvent, now: 1100
  });
  assert.equal(evidence.settled_at, 1050);
});
