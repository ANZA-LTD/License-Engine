import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validate } from '../../validators/validation.js';
import { finalizeEvent } from 'nostr-tools/pure';
import { buildOfferEvent, buildLicenseEvent } from '../nostr/events.js';
import { HttpError } from '../../utils/errors.js';
import { verifySpeedWebhook } from '../payments/speed.js';
import { parseLightningAddress } from '../payments/lnurl.js';
import { validateZapReceipt } from '../payments/zap.js';
import { mediaRef, previewUrl, thumbnailUrl } from '../media/cloudinary.js';
import { resolveOfferSats } from '../payments/rates.js';

const DISCOVERY_LIMIT = 50;

export function createOfferService({ store, verifyEvent, kind, attestorPubkey, attestorSecretKey = null,
  speedWebhookSecret, paymentProvider = null, zapPaymentProvider = null, paymentEnabled = true,
  paymentNetwork = 'regtest', cloudinary = null, rateProvider = null, now = () => Math.floor(Date.now() / 1000) }) {
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
    if (!offer.event_id || !offer.terms.lightning_address) throw new HttpError(409, 'LIGHTNING_UNAVAILABLE', 'This offer does not accept Lightning payments.');
    const { amountSats } = await resolveOfferSats(offer.terms, rateProvider);
    const amountMsat = amountSats * 1000;
    if (!Number.isSafeInteger(amountMsat)) throw new HttpError(422, 'AMOUNT_UNSUPPORTED', 'This offer amount exceeds Lightning millisatoshi precision.');
    const hash = value => createHash('sha256').update(value).digest('hex');
    const reservation = await store.reserveZapPurchase({
      purchase: {
        id: randomUUID(), offer_id: offer.id, offer_event_id: offer.event_id,
        creator_pubkey: offer.creator_pubkey, lightning_address: offer.terms.lightning_address,
        amount_sats: amountSats, amount_msat: amountMsat, network: paymentNetwork,
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
    const result = await store.verifyZapPurchase({
      purchaseId: purchase.id, receiptEvent: receipt,
      settledAt: evidence.settled_at, licenseEvent: signed
    });
    // The download grant is now issued atomically inside verifyZapPurchase.
    // Fall back to issuing one explicitly only if the store did not return it
    // (e.g. the offer has no video_id yet).
    if (result?.verified && result?.offer?.status === 'licensing' && result?.offer?.license_event_id && result?.offer?.video_id) {
      if (!result.downloadGrant) {
        try {
          if (typeof store.issueDownloadGrantForPurchase === 'function') {
            await store.issueDownloadGrantForPurchase({
              offerId: result.offer.id,
              purchaseId: purchase.id,
              licenseEventId: result.offer.license_event_id,
              videoId: result.offer.video_id,
              expiresInSeconds: 3600,
              maxUses: 5
            });
          }
        } catch (e) {
          // ignore grant issuance errors
        }
      }
    }
    return result;
  };
  // Signs the license event for a payment settled outside Lightning (for
  // example a card or mobile-money checkout run by an external payment
  // service). The external service is authenticated service-to-service; the
  // engine records its reference and never handles the funds.
  const signExternalLicense = (offerEvent, attestation) => {
    const template = buildLicenseEvent({ kind, attestorPubkey, offerEvent, settlement: {
      offer_event_id: offerEvent.id,
      external_reference: attestation.externalReference,
      evidence_type: 'external-payment-attestation',
      settled_at: attestation.settledAt
    } });
    const signed = finalizeEvent(template, attestorSecretKey);
    if (signed.pubkey !== attestorPubkey) throw new HttpError(500, 'ATTESTOR_KEY_MISMATCH', 'The configured attestor key cannot sign this license event.');
    return signed;
  };
  const sha256Hex = value => createHash('sha256').update(value).digest('hex');
  const mintDownloadGrant = async ({ offer, purchaseId = null, externalReference = null }) => {
    if (!offer.license_event_id || !offer.video_id || !['licensing', 'licensed'].includes(offer.status)) {
      throw new HttpError(409, 'LICENSE_NOT_ISSUED', 'A license has not been issued for this offer.');
    }
    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = now() + 3600;
    await store.issueDownloadGrant({
      id: randomUUID(), offerId: offer.id, purchaseId,
      licenseEventId: offer.license_event_id, videoId: offer.video_id,
      tokenHash: sha256Hex(rawToken), expiresAt, maxUses: 5, externalReference
    });
    return { status: 201, body: { grantToken: rawToken, expiresAt } };
  };
  return {
    /** Public BTC price for a fiat currency, used to show a sats estimate. */
    async getRate(currency) {
      if (!rateProvider) throw new HttpError(503, 'RATE_UNAVAILABLE', 'Exchange rates are not configured.');
      return { status: 200, body: await rateProvider.getRate(currency) };
    },
    async create({ pubkey, body, key, digest }) {
      // An empty Lightning Address field means "no Lightning payments".
      if (body && typeof body === 'object' && body.lightning_address === '') {
        const { lightning_address: _empty, ...withoutAddress } = body;
        body = withoutAddress;
      }
      input('OfferDraft', body);
      const { video_id: videoId, ...rest } = body;
      // The Lightning Address is optional. When present it is normalised and
      // signed into the offer; when absent the offer is simply not payable over
      // Lightning and another configured checkout must be used.
      const destination = rest.lightning_address
        ? { lightning_address: parseLightningAddress(rest.lightning_address).address } : {};
      if (!rest.lightning_address) delete rest.lightning_address;
      let terms;
      if (videoId) {
        // The content layer resolves the canonical reference. The browser never
        // supplies the media URL for a video-backed offer, so it cannot point
        // an offer at an asset it does not own or at someone else's content.
        const video = await store.getOwnedVideo(videoId, pubkey);
        if (!video) throw new HttpError(404, 'NOT_FOUND', 'Video not found.');
        if (video.status !== 'ready') throw new HttpError(409, 'VIDEO_NOT_READY', 'This video is still processing and cannot be offered yet.');
        terms = { ...rest, ...destination, content_url: previewUrl(mediaRef(video)), content_sha256: video.reference_sha256 };
      } else {
        terms = { ...rest, ...destination };
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
      const watermarkFor = (video) => {
        if (!video || !video.width || !video.height) return cloudinary?.watermarkLandscape ?? null;
        return video.height > video.width
          ? cloudinary?.watermarkPortrait ?? null
          : cloudinary?.watermarkLandscape ?? null;
      };
      return { status: 200, body: { offers: rows.map(({ offer, video }) => {
        const media = video ? mediaRef(video) : null;
        const watermark = media ? watermarkFor(video) : null;
        return {
          offer_id: offer.id, video_id: offer.video_id ?? null,
          title: offer.terms.title ?? null, description: offer.terms.description ?? null,
          creator_public_key: offer.creator_pubkey,
          preview_url: media ? previewUrl(media, undefined, watermark) : offer.terms.content_url,
          thumbnail_url: media ? thumbnailUrl(media, undefined, watermark) : null,
          duration_seconds: video?.duration_seconds ?? null,
          license_duration: offer.terms.duration, price_sats: offer.terms.amount_sats ?? null,
          price: offer.terms.price ?? null,
          status: offer.status, created_at: offer.created_at
        };
      }) } };
    },
    async get(id, pubkey) {
      const stored = await store.getOffer(id);
      if (!stored) throw new HttpError(404, 'NOT_FOUND', 'Offer not found.');
      if (stored.offerId) return { status: 200, body: stored };
      if (!['published', 'licensing', 'licensed'].includes(stored.status) && stored.creator_pubkey !== pubkey) throw new HttpError(404, 'NOT_FOUND', 'Offer not found.');
      // Attach a watermarked preview (and thumbnail) when the offer references a
      // creator-owned video, mirroring the discover projection.
      let enriched = stored;
      if (cloudinary && stored.video_id && !stored.preview_url) {
        const video = await store.getVideo(stored.video_id);
        if (video) {
          const media = mediaRef(video);
          const watermark = (video.height > video.width) ? cloudinary.watermarkPortrait : cloudinary.watermarkLandscape;
          enriched = { ...stored, preview_url: previewUrl(media, undefined, watermark), thumbnail_url: thumbnailUrl(media, undefined, watermark) };
        }
      }
      if (enriched.creator_pubkey !== pubkey && enriched.external_payment) {
        // The external payment reference is the payment service's record key.
        const { external_payment: externalPayment, ...rest } = enriched;
        enriched = { ...rest, external_payment: { settled_at: externalPayment.settled_at } };
      }
      if (enriched.creator_pubkey !== pubkey && enriched.payment) {
        const { payment, ...publicOffer } = enriched;
        return { status: 200, body: { ...publicOffer, payment: {
          status: payment.status,
          ...(payment.settled_at ? { settled_at: payment.settled_at } : {})
        } } };
      }
      return { status: 200, body: enriched };
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
      const { amountSats } = await resolveOfferSats(offer.terms, rateProvider);
      const invoice = await paymentProvider.createInvoice({
        amountSats,
        description: `ContentPort license: ${offer.terms.title || offer.id}`,
        expiry: 3600,
        reference: `contentport_${offer.id}`
      });
      if (!invoice?.id || !String(invoice.payment_hash || '') || !/^ln/i.test(String(invoice.request || '')) ||
          Number(invoice.amount_sat) !== amountSats || invoice.status !== 'pending') {
        throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'Polar LND returned an invalid Lightning invoice.');
      }
      const next = { ...offer, payment: {
        provider: paymentProvider.name || 'polar-lnd', invoice_id: invoice.id, payment_hash: String(invoice.payment_hash),
        request: invoice.request, amount_sats: amountSats, status: 'pending',
        reference: `contentport_${offer.id}`, expires_at: invoice.expires_at
      } };
      await store.saveOfferDocument(next);
      return { status: 201, body: { offerId: offer.id, amountSats, paymentRequest: invoice.request } };
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
    async getLicense(id) {
      const offer = await store.getOffer(id);
      if (!offer || !['published', 'licensing', 'licensed'].includes(offer.status)) throw new HttpError(404, 'NOT_FOUND', 'Offer not found.');
      if (!offer.license_event_id) throw new HttpError(404, 'NOT_FOUND', 'No license has been issued for this offer.');
      const event = await store.getOfferEvent(id, offer.license_event_id);
      if (!event) throw new HttpError(404, 'NOT_FOUND', 'License event is unavailable.');
      return { status: 200, body: { offerId: id, licenseNostrEventId: offer.license_event_id, event } };
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
      let downloadGrantToken = null;
      let downloadGrantExpiresAt = null;
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
            const result = await issueZapLicense(claimed, receipt, evidence);
            // The grant is issued atomically inside verifyZapPurchase when the
            // purchase transitions to verified and the offer has a video_id.
            // The raw token is only available at this moment; it is stored as a
            // hash in the database and cannot be retrieved on subsequent polls.
            if (result?.downloadGrant) {
              downloadGrantToken = result.downloadGrant.grantToken;
              downloadGrantExpiresAt = result.downloadGrant.expiresAt;
            }
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
        ...(offer?.licensed_at ? { licensedAt: offer.licensed_at } : {}),
        ...(downloadGrantToken ? { downloadGrantToken, downloadGrantExpiresAt } : {})
      } };
    },
    /**
     * Issues a short-lived download grant to the buyer who paid. The route id
     * is either an offer id (external checkout, proven by X-External-Credential)
     * or a Lightning purchase id (proven by the buyer's X-Purchase-Token).
     * Purchase ids are public (they appear in the signed license event), so a
     * purchase id alone never authorises a download: the secret is required.
     */
    async issueDownloadGrant(id, purchaseToken, externalCredential) {
      if (typeof externalCredential === 'string' && externalCredential.length) {
        if (!/^[0-9a-f]{64}$/.test(externalCredential)) throw new HttpError(403, 'FORBIDDEN', 'The download credential is not valid for this offer.');
        const association = await store.getExternalPurchaseAssociationByToken(sha256Hex(externalCredential));
        if (!association || association.offer_id !== id) {
          throw new HttpError(403, 'FORBIDDEN', 'The download credential is not valid for this offer.');
        }
        const offer = await store.getOffer(id);
        if (!offer || offer.external_payment?.reference !== association.external_reference) {
          throw new HttpError(409, 'LICENSE_NOT_ISSUED', 'A license has not been issued for this purchase.');
        }
        return mintDownloadGrant({ offer, externalReference: association.external_reference });
      }
      if (!paymentEnabled) throw new HttpError(503, 'PAYMENTS_DISABLED', 'Lightning payments are not enabled in this environment.');
      if (!zapPaymentProvider) throw new HttpError(404, 'NOT_FOUND', 'Download grants are unavailable.');
      if (typeof purchaseToken !== 'string' || !/^[0-9a-f]{64}$/.test(purchaseToken)) {
        throw new HttpError(404, 'NOT_FOUND', 'Purchase not found.');
      }
      const purchase = await store.getZapPurchaseForBuyer(id, sha256Hex(purchaseToken));
      if (!purchase || purchase.status !== 'verified') throw new HttpError(404, 'NOT_FOUND', 'Purchase not found.');
      const offer = await store.getOffer(purchase.offer_id);
      if (!offer) throw new HttpError(409, 'LICENSE_NOT_ISSUED', 'A license has not been issued for this purchase.');
      return mintDownloadGrant({ offer, purchaseId: purchase.id });
    },
async consumeDownloadGrant(input) {
      const grantToken = typeof input === 'string' ? input : input?.grantToken;
      if (typeof grantToken !== 'string' || !/^[0-9a-f]{64}$/.test(grantToken)) throw new HttpError(404, 'NOT_FOUND', 'Download grant not found.');
      const tokenHash = createHash('sha256').update(grantToken).digest('hex');
      const grant = await store.consumeDownloadGrant(tokenHash, now());
      if (!grant) throw new HttpError(404, 'NOT_FOUND', 'Download grant not found or expired.');
      const video = await store.getVideo(grant.video_id);
      if (!video || !cloudinary) throw new HttpError(503, 'MEDIA_UNAVAILABLE', 'Protected media is unavailable.');
      const expiresAt = Math.floor(new Date(grant.expires_at).getTime() / 1000);
      const url = cloudinary.signedOriginalUrl({ publicId: video.public_id, format: video.format }, expiresAt, { filename: video.title });
      return { status: 200, body: { url, expiresAt } };
    },
    async lightningWebhook({ body, headers, rawBody, provider }) {
      if (!body || typeof body !== 'object') throw new HttpError(400, 'VALIDATION_ERROR', 'Webhook payload must be JSON.');
      if (provider !== 'speed') throw new HttpError(501, 'PROVIDER_NOT_SUPPORTED', 'This webhook provider is not supported.');
      verifySpeedWebhook({ rawBody, headers, secret: speedWebhookSecret });
      const normalized = normalizeWebhook(body);
      const entry = { id: randomUUID(), provider: normalized.provider, eventType: normalized.eventType,
        paymentHash: normalized.paymentHash || null, offerId: normalized.offerId || null, payload: body, headers };
      await store.saveLightningWebhook(entry);
      return { status: 200, body: { received: true, provider: entry.provider, eventType: entry.eventType, offerId: entry.offerId || null } };
    },
    /**
     * Service-to-service: an external payment service reports a settled
     * payment for an offer. The engine signs the license and registers the
     * buyer's download credential atomically. Safe to retry with the same
     * externalReference; a second, different payment for a licensed offer is
     * rejected with 409 so the caller can refund it.
     */
    async externalPaymentAttestation({ id, body }) {
      if (!body || typeof body !== 'object') throw new HttpError(400, 'VALIDATION_ERROR', 'Attestation body must be JSON.');
      const { offerId, offerEventId, externalReference, settledAt, credentialToken } = body;
      if (offerId !== id || typeof externalReference !== 'string' || !/^[A-Za-z0-9_.:-]{8,200}$/.test(externalReference)
        || !Number.isInteger(settledAt) || settledAt <= 0
        || typeof credentialToken !== 'string' || !/^[0-9a-f]{64}$/.test(credentialToken)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Attestation requires offerId matching the route, externalReference, settledAt and a 64-hex credentialToken.');
      }
      if (!attestorSecretKey) throw new HttpError(503, 'LICENSE_ATTESTOR_NOT_CONFIGURED', 'The license attestor is not configured.');
      const offer = await store.getOffer(offerId);
      if (!offer) throw new HttpError(404, 'NOT_FOUND', 'Offer not found.');
      if (offerEventId && offer.event_id !== offerEventId) throw new HttpError(409, 'OFFER_CHANGED', 'The signed offer has changed.');
      const offerEvent = offer.event_id ? await store.getOfferEvent(offerId, offer.event_id) : null;
      if (!offerEvent && !offer.license_event_id) {
        throw new HttpError(409, 'OFFER_NOT_PURCHASABLE', 'This offer is not available for licensing.');
      }
      const result = await store.recordExternalLicense({
        offerId, eventId: offer.event_id, externalReference, settledAt,
        credentialTokenHash: sha256Hex(credentialToken),
        buildEvent: () => signExternalLicense(offerEvent, { externalReference, settledAt })
      });
      return { status: result.created ? 201 : 200, body: {
        offerId, licenseEventId: result.offer.license_event_id, alreadyLicensed: !result.created
      } };
    }
  };
}
