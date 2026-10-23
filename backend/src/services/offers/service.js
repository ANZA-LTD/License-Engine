import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validate } from '../../validators/validation.js';
import { finalizeEvent } from 'nostr-tools/pure';
import { buildOfferEvent, buildLicenseEvent } from '../nostr/events.js';
import { HttpError } from '../../utils/errors.js';
import { verifySpeedWebhook } from '../payments/speed.js';
import { parseLightningAddress } from '../payments/lnurl.js';
import { validateZapReceipt } from '../payments/zap.js';
import { mediaRef, previewUrl, thumbnailUrl } from '../media/cloudinary.js';

const DISCOVERY_LIMIT = 50;

export function createOfferService({ store, verifyEvent, kind, attestorPubkey, attestorSecretKey = null,
  speedWebhookSecret, paymentProvider = null, zapPaymentProvider = null, paymentEnabled = true,
  paymentNetwork = 'regtest', now = () => Math.floor(Date.now() / 1000) }) {
  const input = (schema, body) => {
    try { validate(schema, body); } catch (error) { throw new HttpError(400, 'VALIDATION_ERROR', error.message); }
  };
  const normalizeWebhook = body => {
    const payload = body && typeof body === 'object' ? body : {};
    const payment = payload.data?.object && typeof payload.data.object === 'object' ? payload.data.object : payload;
    const reference = String(payment.metadata?.offer_id || payment.metadata?.offerId || payment.offer_id || '');
    const offerId = reference.startsWith('contentport_') ? reference.slice('contentport_'.length) : reference;
    return {
      provider: 'speed', eventType: String(payload.event_type || 'unknown'),
      paymentHash: String(payment.payment_method_options?.lightning?.id || payment.id || ''),
      offerId, payload
    };
  };
  const invoiceHasExpired = payment => {
    if (!payment?.expires_at) return false;
    const expiry = typeof payment.expires_at === 'number'
      ? payment.expires_at
      : Math.floor(Date.parse(payment.expires_at) / 1000);
    return Number.isFinite(expiry) && expiry <= now();
  };
  const queueLicenseAttestation = async offer => {
    if (!attestorSecretKey || offer.license_event_id || !offer.payment?.settled_at) return offer;
    const offerEvent = await store.getOfferEvent(offer.id, offer.event_id);
    if (!offerEvent) throw new HttpError(503, 'LICENSE_EVENT_UNAVAILABLE', 'The original Nostr offer event is unavailable for license attestation.');
    const template = buildLicenseEvent({ kind, attestorPubkey, offerEvent, settlement: {
      offer_event_id: offer.event_id, payment_hash: offer.payment.payment_hash,
      amount_sats: offer.payment.amount_sats, settled_at: offer.payment.settled_at
    } });
    const signed = finalizeEvent(template, attestorSecretKey);
    if (signed.pubkey !== attestorPubkey) throw new HttpError(500, 'ATTESTOR_KEY_MISMATCH', 'The configured attestor key cannot sign this license event.');
    return store.queueLicense({ ...offer, status: 'licensing', license_event_id: signed.id }, signed);
  };
  const createZapPurchase = async (id, { key, purchaseToken }) => {
    if (!paymentEnabled) throw new HttpError(503, 'PAYMENTS_DISABLED', 'Lightning payments are not enabled in this environment.');
    if (!zapPaymentProvider) throw new HttpError(501, 'PAYMENT_NOT_CONFIGURED', 'Creator Lightning Address payments are not configured.');
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key) ||
        typeof purchaseToken !== 'string' || !/^[0-9a-f]{64}$/.test(purchaseToken)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'A valid purchase idempotency key and access token are required.');
    }
    const offer = await store.getOffer(id);
    if (!offer || !['published', 'licensing', 'licensed'].includes(offer.status)) throw new HttpError(404, 'NOT_FOUND', 'Offer not found.');
    if (offer.status !== 'published' || offer.license_event_id) throw new HttpError(409, 'OFFER_ALREADY_LICENSED', 'This offer is no longer available for purchase.');
    if (!offer.event_id || !offer.terms.lightning_address) throw new HttpError(409, 'OFFER_PAYMENT_DESTINATION_MISSING', 'This offer has no signed creator Lightning Address. The creator must publish a new offer.');
    const amountMsat = offer.terms.amount_sats * 1000;
    if (!Number.isSafeInteger(amountMsat)) throw new HttpError(422, 'AMOUNT_UNSUPPORTED', 'This offer amount exceeds Lightning millisatoshi precision.');
    const hash = value => createHash('sha256').update(value).digest('hex');
    const reservation = await store.reserveZapPurchase({
      purchase: {
        id: randomUUID(), offer_id: offer.id, offer_event_id: offer.event_id,
        creator_pubkey: offer.creator_pubkey, lightning_address: offer.terms.lightning_address,
        amount_sats: offer.terms.amount_sats, amount_msat: amountMsat, network: paymentNetwork,
        idempotency_hash: hash(key), access_token_hash: hash(purchaseToken)
      },
      now: now()
    });
    let purchase = reservation.purchase;
    const response = () => ({
      offerId: purchase.offer_id, purchaseId: purchase.id, amountSats: Number(purchase.amount_sats),
      paymentRequest: purchase.invoice_request
    });
    if (!reservation.shouldCreate) {
      if (purchase.status === 'pending') return { status: 200, body: response() };
      if (purchase.status === 'verified') throw new HttpError(409, 'OFFER_ALREADY_LICENSED', 'This offer has already been licensed.');
      if (purchase.status === 'creating') throw new HttpError(409, 'PURCHASE_CREATION_IN_PROGRESS', 'The purchase request is still being created. Retry with the same request key.');
      throw new HttpError(409, 'PURCHASE_RETRY_REQUIRED', 'The previous payment request could not be used. Start a new purchase request.');
    }
    try {
      let requestJson = purchase.zap_request_json;
      let endpoint;
      if (requestJson) {
        endpoint = {
          address: purchase.lightning_address, callback: purchase.callback_url,
          nostr_pubkey: purchase.receiver_pubkey,
          min_sendable: Number(purchase.min_sendable), max_sendable: Number(purchase.max_sendable)
        };
      } else {
        const created = await zapPaymentProvider.createRequest({
          lightningAddress: purchase.lightning_address,
          amountSats: Number(purchase.amount_sats),
          offerEventId: purchase.offer_event_id,
          now: now()
        });
        if (created.endpoint.address !== purchase.lightning_address) {
          throw new HttpError(502, 'LIGHTNING_ADDRESS_CHANGED', 'The resolved creator Lightning Address does not match the signed offer.');
        }
        endpoint = created.endpoint;
        requestJson = created.zapRequest.json;
        await store.setZapRequest(purchase.id, {
          receiverPubkey: endpoint.nostr_pubkey, callbackUrl: endpoint.callback,
          minSendable: endpoint.min_sendable, maxSendable: endpoint.max_sendable,
          zapRequestId: created.zapRequest.event.id, zapRequestJson: requestJson,
          zapRequest: created.zapRequest.event
        });
      }
      const invoice = await zapPaymentProvider.requestInvoice({
        endpoint, zapRequestJson: requestJson, amountMsat: Number(purchase.amount_msat)
      });
      purchase = await store.saveZapInvoice(purchase.id, invoice);
      return { status: 201, body: response() };
    } catch (error) {
      await store.failZapPurchaseCreation(purchase.id);
      throw error;
    }
  };
  const issueZapLicense = async (purchase, receipt, evidence) => {
    if (!attestorSecretKey) throw new HttpError(503, 'LICENSE_ATTESTOR_NOT_CONFIGURED', 'The license attestor is not configured.');
    const offer = await store.getOffer(purchase.offer_id);
    const offerEvent = await store.getOfferEvent(purchase.offer_id, purchase.offer_event_id);
    if (!offer || !offerEvent) throw new HttpError(503, 'LICENSE_EVENT_UNAVAILABLE', 'The signed offer event is unavailable for license attestation.');
    const template = buildLicenseEvent({ kind, attestorPubkey, offerEvent, settlement: {
      offer_event_id: purchase.offer_event_id, payment_hash: purchase.payment_hash,
      amount_sats: Number(purchase.amount_sats), settled_at: evidence.settled_at,
      purchase_id: purchase.id, receipt_event_id: receipt.id,
      receiver_pubkey: purchase.receiver_pubkey, payment_network: 'mainnet'
    } });
    const signed = finalizeEvent(template, attestorSecretKey);
    if (signed.pubkey !== attestorPubkey) throw new HttpError(500, 'ATTESTOR_KEY_MISMATCH', 'The configured attestor key cannot sign this license event.');
    await store.verifyZapPurchase({
      purchaseId: purchase.id, receiptEvent: receipt,
      settledAt: evidence.settled_at, licenseEvent: signed
    });
  };
  return {
    async create({ pubkey, body, key, digest }) {
      input('OfferDraft', body);
      const { video_id: videoId, ...rest } = body;
      const { address: lightningAddress } = parseLightningAddress(rest.lightning_address);
      let terms;
      if (videoId) {
        // The content layer resolves the canonical reference. The browser never
        // supplies the media URL for a video-backed offer, so it cannot point
        // an offer at an asset it does not own or at someone else's content.
        const video = await store.getOwnedVideo(videoId, pubkey);
        if (!video) throw new HttpError(404, 'NOT_FOUND', 'Video not found.');
        if (video.status !== 'ready') throw new HttpError(409, 'VIDEO_NOT_READY', 'This video is still processing and cannot be offered yet.');
        terms = { ...rest, lightning_address: lightningAddress, content_url: previewUrl(mediaRef(video)), content_sha256: video.reference_sha256 };
      } else {
        terms = { ...body, lightning_address: lightningAddress };
        try {
          const url = new URL(terms.content_url);
          if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
        } catch { throw new HttpError(400, 'VALIDATION_ERROR', 'Content URL must be a valid public HTTPS reference.'); }
      }
      input('Terms', terms);
      return store.idempotent(`${pubkey}:POST:/offers:${key}`, digest, async tx => {
        const offer = { id: randomUUID(), creator_pubkey: pubkey, terms, status: 'draft', event_id: null,
          ...(videoId ? { video_id: videoId } : {}), created_at: now() };
        await tx.insertOffer(offer);
        return { status: 201, body: offer };
      });
    },
    // Brand discovery. Eligibility is decided here, not by the frontend: only
    // offers the licensing engine already published are listed, an offer that
    // is already licensed is no longer purchasable and is not offered again, and
    // the projection carries a watermarked preview rather than the original.
    async discover() {
      const rows = await store.listDiscoverableOffers(DISCOVERY_LIMIT);
      return { status: 200, body: { offers: rows.map(({ offer, video }) => {
        const media = video ? mediaRef(video) : null;
        return {
          offer_id: offer.id, video_id: offer.video_id ?? null,
          title: offer.terms.title ?? null, description: offer.terms.description ?? null,
          creator_public_key: offer.creator_pubkey,
          preview_url: media ? previewUrl(media) : offer.terms.content_url,
          thumbnail_url: media ? thumbnailUrl(media) : null,
          duration_seconds: video?.duration_seconds ?? null,
          license_duration: offer.terms.duration, price_sats: offer.terms.amount_sats,
          status: offer.status, created_at: offer.created_at
        };
      }) } };
    },
    async get(id, pubkey) {
      const stored = await store.getOffer(id);
      if (!stored) throw new HttpError(404, 'NOT_FOUND', 'Offer not found.');
      if (stored.offerId) return { status: 200, body: stored };
      if (!['published', 'licensing', 'licensed'].includes(stored.status) && stored.creator_pubkey !== pubkey) throw new HttpError(404, 'NOT_FOUND', 'Offer not found.');
      if (stored.creator_pubkey !== pubkey && stored.payment) {
        const { payment, ...publicOffer } = stored;
        return { status: 200, body: { ...publicOffer, payment: {
          status: payment.status,
          ...(payment.settled_at ? { settled_at: payment.settled_at } : {})
        } } };
      }
      return { status: 200, body: stored };
    },
    async publish({ id, pubkey, body, key, digest }) {
      input('SignedEvent', body);
      let valid = false;
      try { valid = verifyEvent(body); } catch { /* Invalid cryptographic input. */ }
      if (!valid) throw new HttpError(400, 'INVALID_EVENT', 'Invalid event ID or signature.');
      return store.idempotent(`${pubkey}:POST:/offers/${id}/publish:${key}`, digest, async tx => {
        const offer = await tx.getOfferForUpdate(id);
        if (!offer) throw new HttpError(404, 'NOT_FOUND', 'Offer not found.');
        if (offer.creator_pubkey !== pubkey) throw new HttpError(403, 'FORBIDDEN', 'Only the creator can publish this offer.');
        if (offer.event_id) {
          if (offer.event_id !== body.id) throw new HttpError(409, 'OFFER_IMMUTABLE', 'An event is already assigned to this offer.');
          return { status: 202, body: offer };
        }
        const expected = buildOfferEvent({ kind, creatorPubkey: pubkey, attestorPubkey, terms: offer.terms, createdAt: body.created_at });
        let payload;
        try { payload = JSON.parse(body.content); } catch { throw new HttpError(400, 'INVALID_EVENT', 'Event content must contain JSON.'); }
        if (body.pubkey !== pubkey || body.kind !== kind || Math.abs(now() - body.created_at) > 300 ||
            !isDeepStrictEqual(body.tags, expected.tags) || !isDeepStrictEqual(payload, JSON.parse(expected.content))) {
          throw new HttpError(400, 'INVALID_EVENT', 'Event must match the creator, configured kind, draft terms, tags, attestor, and timestamp policy.');
        }
        const next = { ...offer, status: 'publishing', event_id: body.id };
        await tx.queueOffer(next, body);
        return { status: 202, body: next };
      });
    },
    async createPayment(id, request = {}) {
      if (!paymentEnabled) throw new HttpError(503, 'PAYMENTS_DISABLED', 'Lightning payments are not enabled in this environment.');
      if (zapPaymentProvider) return createZapPurchase(id, request);
      if (!paymentProvider) throw new HttpError(501, 'PAYMENT_NOT_CONFIGURED', "Polar LND is not configured. Add the Creator node's LND_REST_URL and LND_MACAROON to backend/.env.");
      const offer = await store.getOffer(id);
      if (!offer || !['published', 'licensing', 'licensed'].includes(offer.status)) throw new HttpError(404, 'NOT_FOUND', 'Offer not found.');
      if (offer.status === 'licensed') throw new HttpError(409, 'OFFER_ALREADY_LICENSED', 'This offer has already been licensed.');
      if (offer.payment?.status === 'settled' || (offer.payment?.status === 'pending' && !invoiceHasExpired(offer.payment))) {
        return { status: 200, body: { offerId: offer.id, amountSats: offer.payment.amount_sats, paymentRequest: offer.payment.request } };
      }
      const invoice = await paymentProvider.createInvoice({
        amountSats: offer.terms.amount_sats,
        description: `ContentPort license: ${offer.terms.title || offer.id}`,
        expiry: 3600,
        reference: `contentport_${offer.id}`
      });
      if (!invoice?.id || !String(invoice.payment_hash || '') || !/^ln/i.test(String(invoice.request || '')) ||
          Number(invoice.amount_sat) !== offer.terms.amount_sats || invoice.status !== 'pending') {
        throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'Polar LND returned an invalid Lightning invoice.');
      }
      const next = { ...offer, payment: {
        provider: paymentProvider.name || 'polar-lnd', invoice_id: invoice.id, payment_hash: String(invoice.payment_hash),
        request: invoice.request, amount_sats: offer.terms.amount_sats, status: 'pending',
        reference: `contentport_${offer.id}`, expires_at: invoice.expires_at
      } };
      await store.saveOfferDocument(next);
      return { status: 201, body: { offerId: offer.id, amountSats: offer.terms.amount_sats, paymentRequest: invoice.request } };
    },
    async getStatus(id) {
      if (zapPaymentProvider) throw new HttpError(404, 'NOT_FOUND', 'Use the purchase-specific status endpoint.');
      let offer = await store.getOffer(id);
      if (!offer || !['published', 'licensing', 'licensed'].includes(offer.status)) throw new HttpError(404, 'NOT_FOUND', 'Offer not found.');
      if (offer.payment?.status === 'pending' && paymentProvider?.lookupInvoice) {
        try {
          const invoice = await paymentProvider.lookupInvoice(offer.payment.payment_hash);
          if (invoice.status === 'settled') {
            offer = { ...offer, payment: { ...offer.payment, status: 'settled', settled_at: invoice.settled_at ?? now() } };
            await store.saveOfferDocument(offer);
            offer = await queueLicenseAttestation(offer);
          }
        } catch (error) {
          if (!(error instanceof HttpError) || error.status !== 503) throw error;
        }
      }
      if (offer.payment?.status === 'settled' && !offer.license_event_id) {
        offer = await queueLicenseAttestation(offer);
      }
      return { status: 200, body: {
        offerId: offer.id,
        status: offer.status === 'licensed' ? 'LICENSED' : offer.payment?.status === 'settled' ? 'PAYMENT_SETTLED' : offer.payment?.status === 'pending' ? 'PAYMENT_PENDING' : 'OPEN',
        ...(offer.payment?.settled_at ? { paymentSettledAt: offer.payment.settled_at } : {}),
        ...(offer.licensed_at ? { licensedAt: offer.licensed_at } : {}),
        ...(offer.license_event_id ? { licenseNostrEventId: offer.license_event_id } : {})
      } };
    },
    async getPurchaseStatus(id, purchaseToken) {
      if (!paymentEnabled) throw new HttpError(503, 'PAYMENTS_DISABLED', 'Lightning payments are not enabled in this environment.');
      if (!zapPaymentProvider) throw new HttpError(404, 'NOT_FOUND', 'Purchase status is unavailable.');
      if (typeof purchaseToken !== 'string' || !/^[0-9a-f]{64}$/.test(purchaseToken)) {
        throw new HttpError(404, 'NOT_FOUND', 'Purchase not found.');
      }
      const tokenHash = createHash('sha256').update(purchaseToken).digest('hex');
      let purchase = await store.getZapPurchaseForBuyer(id, tokenHash);
      if (!purchase) throw new HttpError(404, 'NOT_FOUND', 'Purchase not found.');
      if (purchase.status === 'pending' && Number(purchase.next_receipt_check_at) <= now()) {
        const claimed = await store.claimZapReceiptCheck(id, now());
        if (claimed) {
          const receipts = await zapPaymentProvider.findReceipts(claimed);
          for (const receipt of receipts) {
            let evidence;
            try {
              evidence = validateZapReceipt({ receipt, purchase: claimed, verify: verifyEvent, now: now() });
            } catch (error) {
              console.warn('Rejected NIP-57 receipt candidate', receipt?.id, error.message);
              continue;
            }
            await issueZapLicense(claimed, receipt, evidence);
            break;
          }
        }
      }
      purchase = await store.getZapPurchaseForBuyer(id, tokenHash);
      const offer = await store.getOffer(purchase.offer_id);
      return { status: 200, body: {
        purchaseId: purchase.id,
        status: purchase.status === 'verified'
          ? offer?.status === 'licensed' ? 'LICENSED' : 'PAYMENT_ATTESTED'
          : purchase.status === 'expired' ? 'EXPIRED' : 'PAYMENT_PENDING',
        receiptState: purchase.status === 'verified' ? 'verified' : 'awaiting_receipt',
        ...(offer?.license_event_id ? { licenseNostrEventId: offer.license_event_id } : {}),
        ...(offer?.licensed_at ? { licensedAt: offer.licensed_at } : {})
      } };
    },
    async lightningWebhook({ body, headers, rawBody, provider = 'speed' }) {
      if (!body || typeof body !== 'object') throw new HttpError(400, 'VALIDATION_ERROR', 'Webhook payload must be JSON.');
      if (provider !== 'speed') throw new HttpError(501, 'PROVIDER_NOT_SUPPORTED', 'This webhook provider is not supported.');
      verifySpeedWebhook({ rawBody, headers, secret: speedWebhookSecret });
      const normalized = normalizeWebhook(body);
      const entry = { id: randomUUID(), provider: normalized.provider, eventType: normalized.eventType,
        paymentHash: normalized.paymentHash || null, offerId: normalized.offerId || null, payload: body, headers };
      await store.saveLightningWebhook(entry);
      return { status: 200, body: { received: true, provider: entry.provider, eventType: entry.eventType, offerId: entry.offerId || null } };
    }
  };
}
