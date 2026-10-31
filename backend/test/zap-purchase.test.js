import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { createOfferService } from '../src/services/offers/service.js';
import { buildOfferEvent } from '../src/services/nostr/events.js';
import { createZapRequest } from '../src/services/payments/zap.js';

const creatorSecret = generateSecretKey();
const creatorPubkey = getPublicKey(creatorSecret);
const receiverSecret = generateSecretKey();
const receiverPubkey = getPublicKey(receiverSecret);
const attestorSecret = generateSecretKey();
const attestorPubkey = getPublicKey(attestorSecret);
const accessToken = 'a'.repeat(64);
const offerId = 'offer-test-1';
const terms = {
  brand: 'Example brand', lightning_address: 'creator@example.org',
  content_url: 'https://example.org/preview.mp4', content_sha256: 'c'.repeat(64),
  amount_sats: 1, usage_rights: 'Social use', duration: { type: 'perpetual' }
};
const offerEvent = finalizeEvent(buildOfferEvent({
  kind: 9998, creatorPubkey, attestorPubkey, terms, createdAt: 1000
}), creatorSecret);
const offerEventId = offerEvent.id;

function setup(findReceipts) {
  const zapRequest = createZapRequest({
    receiverPubkey, amountMsat: 1000, relays: ['wss://relay.example'],
    offerEventId, now: 1000
  });
  let purchase = {
    id: 'purchase-test-1', offer_id: offerId, offer_event_id: offerEventId,
    creator_pubkey: creatorPubkey, lightning_address: terms.lightning_address,
    amount_sats: 1, amount_msat: 1000, payment_network: 'mainnet',
    payment_hash: 'd'.repeat(64), invoice_request: 'lnbc10n1invoice',
    invoice_expires_at: 4600, invoice_issued_at: 1000, receiver_pubkey: receiverPubkey,
    zap_request_id: zapRequest.event.id, zap_request_json: zapRequest.json,
    zap_request: zapRequest.event, status: 'pending', next_receipt_check_at: 0,
    access_token_hash: createHash('sha256').update(accessToken).digest('hex')
  };
  const offer = { id: offerId, creator_pubkey: creatorPubkey, terms, event_id: offerEventId, status: 'published', video_id: 'video-test-1' };
  let downloadGrant = null;
  let existingGrant = null;
  const store = {
    getZapPurchaseForBuyer: async () => purchase,
    claimZapReceiptCheck: async () => purchase,
    getOffer: async () => offer,
    getOfferEvent: async () => offerEvent,
    getDownloadGrantForPurchase: async () => existingGrant,
    verifyZapPurchase: async ({ purchaseId, receiptEvent, settledAt, licenseEvent }) => {
      assert.equal(purchaseId, purchase.id);
      assert.equal(verifyEvent(licenseEvent), true);
      assert.equal(licenseEvent.pubkey, attestorPubkey);
      offer.status = 'licensing';
      offer.license_event_id = licenseEvent.id;
      offer.licensed_at = settledAt;
      purchase = { ...purchase, status: 'verified', receipt_event_id: receiptEvent.id, settled_at: settledAt };
      // Simulate the atomic grant issuance from verifyZapPurchase.
      downloadGrant = { grantToken: 'a'.repeat(64), expiresAt: 1100 };
      existingGrant = { id: 'grant-1', offer_id: offerId, purchase_id: purchase.id, video_id: 'video-test-1', expires_at: new Date(1100 * 1000).toISOString() };
      return { verified: true, purchase, offer, downloadGrant };
    }
  };
  const service = createOfferService({
    store, verifyEvent, kind: 9998, attestorPubkey, attestorSecretKey: attestorSecret,
    speedWebhookSecret: 'unused', zapPaymentProvider: { findReceipts },
    now: () => 1100
  });
  return { service, purchase: () => purchase, zapRequest, makeReceipt, getGrant: () => downloadGrant, setExistingGrant: g => { existingGrant = g; } };

  function makeReceipt({ validSignature = true } = {}) {
    const receipt = finalizeEvent({
      kind: 9735, created_at: 1050, content: '',
      tags: [
        ['p', receiverPubkey], ['e', offerEventId], ['P', zapRequest.event.pubkey],
        ['bolt11', purchase.invoice_request], ['description', zapRequest.json]
      ]
    }, receiverSecret);
    return validSignature ? receipt : { ...JSON.parse(JSON.stringify(receipt)), sig: '0'.repeat(128) };
  }
}

test('missing or invalid Zap receipts stay pending and never issue a license', async () => {
  const { service, purchase } = setup(async () => []);
  const missingStatus = await service.getPurchaseStatus(purchase().id, accessToken);
  assert.equal(missingStatus.body.status, 'PAYMENT_PENDING');
  assert.equal(purchase().status, 'pending');

  const invalid = setup(async () => [invalid.makeReceipt({ validSignature: false })]);
  const invalidStatus = await invalid.service.getPurchaseStatus(invalid.purchase().id, accessToken);
  assert.equal(invalidStatus.body.status, 'PAYMENT_PENDING');
  assert.equal(invalid.purchase().status, 'pending');
});

test('a valid receiver-signed receipt issues one Anza license attestation', async () => {
  const { service, purchase, makeReceipt } = setup(async () => [makeReceipt()]);
  const status = await service.getPurchaseStatus(purchase().id, accessToken);
  assert.equal(status.body.status, 'PAYMENT_ATTESTED');
  assert.equal(status.body.receiptState, 'verified');
  assert.ok(status.body.licenseNostrEventId);
  assert.equal(purchase().status, 'verified');
  // The download grant issued atomically inside verifyZapPurchase must be
  // surfaced via the purchase status polling endpoint.
  assert.equal(status.body.downloadGrantToken, 'a'.repeat(64));
  assert.equal(status.body.downloadGrantExpiresAt, 1100);
});

test('a purchase that is already verified does not re-issue a grant', async () => {
  const { service, purchase, makeReceipt } = setup(async () => [makeReceipt()]);
  // First call issues the license and grant.
  const first = await service.getPurchaseStatus(purchase().id, accessToken);
  assert.equal(first.body.status, 'PAYMENT_ATTESTED');
  assert.equal(first.body.downloadGrantToken, 'a'.repeat(64));
  // Second call: the purchase is already verified, so no new receipt check runs.
  // The raw grant token is never persisted (only its hash), so subsequent
  // polls must not return a token. The frontend should have already consumed
  // the token from the first response.
  const second = await service.getPurchaseStatus(purchase().id, accessToken);
  assert.equal(second.body.status, 'PAYMENT_ATTESTED');
  assert.equal(second.body.downloadGrantToken, undefined);
});
