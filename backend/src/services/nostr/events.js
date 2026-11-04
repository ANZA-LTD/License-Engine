import { validate } from '../../validators/validation.js';

// Kind numbers are deployment configuration, not registered ContentPort kinds.
function envelope(kind, pubkey, createdAt, tags, payload) {
  if (!Number.isInteger(kind) || kind < 1000 || kind >= 10000) {
    throw new TypeError('Configure an experimental regular event kind in 1000..9999');
  }
  validate('hex', pubkey);
  validate('integer', createdAt);
  return { kind, pubkey, created_at: createdAt, tags, content: JSON.stringify(payload) };
}
export function buildOfferEvent({ kind, creatorPubkey, attestorPubkey, terms, createdAt }) {
  validate('Terms', terms);
  validate('hex', attestorPubkey);
  return envelope(kind, creatorPubkey, createdAt, [['t', 'contentport-offer-v1']], {
    schema: 'contentport.offer.v1', terms, attestor_pubkey: attestorPubkey
  });
}
// Inputs must already have passed signature and the configured payment-evidence policy.
// This pure builder does not verify payment, sign events, or publish to relays.
export function buildLicenseEvent({ kind, attestorPubkey, offerEvent, settlement }) {
  validate('SignedEvent', offerEvent);
  validate('Settlement', settlement);
  const offer = JSON.parse(offerEvent.content);
  if (offer.schema !== 'contentport.offer.v1') throw new TypeError('Unsupported offer schema');
  validate('Terms', offer.terms);
  if (offer.attestor_pubkey !== attestorPubkey) throw new TypeError('Unauthorized attestor');
  if (settlement.offer_event_id !== offerEvent.id) throw new TypeError('Offer reference mismatch');
  const isExternal = Boolean(settlement.external_reference) && !settlement.payment_hash;
  // Lightning path remains anchored to the signed satoshi amount. External
  // (KES) payments are priced by the Payment Microservice mapping, so the
  // placeholder amount_sats must not be compared for external attestations.
  if (!isExternal) {
    if (settlement.amount_sats !== offer.terms.amount_sats) throw new TypeError('Payment amount mismatch');
  }
  if (settlement.settled_at < offerEvent.created_at) throw new TypeError('Settlement predates offer');
  const endsAt = offer.terms.duration.type === 'perpetual' ? null
    : settlement.settled_at + offer.terms.duration.days * 86400;
  if (endsAt !== null) validate('integer', endsAt);
  const payload = {
    schema: 'contentport.license.v1', offer_event_id: offerEvent.id,
    starts_at: settlement.settled_at, ends_at: endsAt,
    evidence_type: isExternal
      ? (settlement.evidence_type || 'external-payment-attestation')
      : (settlement.receipt_event_id ? 'contentport-nip57-provider-attestation' : 'contentport-settlement-attestation')
  };
  if (!isExternal) {
    payload.payment_hash = settlement.payment_hash;
    payload.amount_sats = settlement.amount_sats;
  }
  if (settlement.external_reference) payload.external_reference = settlement.external_reference;
  if (settlement.purchase_id) payload.purchase_id = settlement.purchase_id;
  if (settlement.receipt_event_id) payload.zap_receipt_event_id = settlement.receipt_event_id;
  if (settlement.receiver_pubkey) payload.receiver_pubkey = settlement.receiver_pubkey;
  if (settlement.payment_network) payload.payment_network = settlement.payment_network;
  return envelope(kind, attestorPubkey, settlement.settled_at,
    [['e', offerEvent.id], ['p', offerEvent.pubkey], ['t', 'contentport-license-v1']], payload);
}
