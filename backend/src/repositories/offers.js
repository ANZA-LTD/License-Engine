import { HttpError } from '../utils/errors.js';

export class PostgresOfferStore {
  constructor(pool) { this.pool = pool; }
  // The video_id column mirrors document->>'video_id' so discovery and the
  // creator library can join without scanning the offers jsonb. Keeping it
  // derived from the document means the two can never disagree.
  static videoId(document) { return document?.video_id ?? null; }
  async getOffer(id) {
    return (await this.pool.query('SELECT document FROM offers WHERE id = $1', [id])).rows[0]?.document;
  }
  async getOfferEvent(id, eventId) {
    return (await this.pool.query('SELECT event FROM nostr_outbox WHERE offer_id = $1 AND event_id = $2', [id, eventId])).rows[0]?.event;
  }
  async saveOfferDocument(document) {
    const id = document.offerId || document.id;
    if (!id) throw new Error('Offer document must include offerId or id');
    await this.pool.query(
      'INSERT INTO offers(id, document, video_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document, video_id = EXCLUDED.video_id',
      [id, document, PostgresOfferStore.videoId(document)]
    );
    return document;
  }
  async queueLicense(offer, event) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`license:${offer.id}`]);
      const current = (await client.query('SELECT document FROM offers WHERE id = $1 FOR UPDATE', [offer.id])).rows[0]?.document;
      if (!current) throw new HttpError(404, 'NOT_FOUND', 'Offer not found.');
      if (current.license_event_id) { await client.query('COMMIT'); return current; }
      const next = { ...current, status: 'licensing', license_event_id: event.id, licensed_at: offer.payment.settled_at };
      await client.query('INSERT INTO nostr_outbox(event_id, offer_id, event) VALUES ($1, $2, $3)', [event.id, offer.id, event]);
      await client.query('UPDATE offers SET document = $2 WHERE id = $1', [offer.id, next]);
      await client.query('COMMIT');
      return next;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async saveLightningWebhook(entry) {
    await this.pool.query(
      `INSERT INTO lightning_webhooks(id, provider, event_type, payment_hash, offer_id, payload, headers)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entry.id, entry.provider, entry.eventType ?? null, entry.paymentHash ?? null, entry.offerId ?? null, entry.payload, entry.headers]
    );
    return entry;
  }
  async reserveZapPurchase({ purchase, now }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`purchase:${purchase.offer_id}`]);
      const offer = (await client.query('SELECT document FROM offers WHERE id = $1 FOR UPDATE', [purchase.offer_id])).rows[0]?.document;
      if (!offer || offer.event_id !== purchase.offer_event_id || offer.creator_pubkey !== purchase.creator_pubkey) {
        throw new HttpError(404, 'NOT_FOUND', 'Published offer not found.');
      }
      if (offer.status !== 'published') throw new HttpError(409, 'OFFER_NOT_PURCHASABLE', 'This offer is not available for purchase.');
      if (offer.terms.lightning_address !== purchase.lightning_address || offer.terms.amount_sats !== purchase.amount_sats) {
        throw new HttpError(409, 'OFFER_CHANGED', 'The signed offer payment destination or amount has changed.');
      }
      const previous = (await client.query('SELECT * FROM zap_purchases WHERE offer_id = $1 AND idempotency_hash = $2 FOR UPDATE',
        [purchase.offer_id, purchase.idempotency_hash])).rows[0];
      if (previous) {
        if (previous.access_token_hash !== purchase.access_token_hash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This purchase request key is already bound to a different access token.');
        if (previous.status === 'failed') {
          const restarted = (await client.query(`UPDATE zap_purchases SET receiver_pubkey = NULL, callback_url = NULL,
            min_sendable = NULL, max_sendable = NULL, zap_request_id = NULL, zap_request_json = NULL,
            zap_request = NULL, invoice_request = NULL, payment_hash = NULL, invoice_payee_pubkey = NULL,
            invoice_issued_at = NULL, invoice_expires_at = NULL, receipt_event_id = NULL, receipt_event = NULL,
            settled_at = NULL, status = 'creating', creation_lease_until = $2, updated_at = $3
            WHERE id = $1 RETURNING *`, [previous.id, now + 120, now])).rows[0];
          await client.query('COMMIT');
          return { purchase: restarted, shouldCreate: true };
        }
        if (previous.status === 'creating' && Number(previous.creation_lease_until) <= now) {
          const resumed = (await client.query(`UPDATE zap_purchases SET creation_lease_until = $2, updated_at = $3
            WHERE id = $1 RETURNING *`, [previous.id, now + 120, now])).rows[0];
          await client.query('COMMIT');
          return { purchase: resumed, shouldCreate: true };
        }
        await client.query('COMMIT');
        return { purchase: previous, shouldCreate: false };
      }
      await client.query(`UPDATE zap_purchases SET status = 'failed', updated_at = $2
        WHERE offer_id = $1 AND status = 'creating' AND creation_lease_until <= $2`, [purchase.offer_id, now]);
      const active = (await client.query(`SELECT id FROM zap_purchases
        WHERE offer_id = $1 AND status IN ('creating', 'pending') LIMIT 1`, [purchase.offer_id])).rows[0];
      if (active) throw new HttpError(409, 'PURCHASE_ALREADY_ACTIVE', 'A payment request is already active for this offer.');
      const created = (await client.query(`INSERT INTO zap_purchases(
        id, offer_id, offer_event_id, creator_pubkey, lightning_address, amount_sats, amount_msat,
        network, idempotency_hash, access_token_hash, status, creation_lease_until, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'creating',$11,$12,$12) RETURNING *`, [
        purchase.id, purchase.offer_id, purchase.offer_event_id, purchase.creator_pubkey, purchase.lightning_address,
        purchase.amount_sats, purchase.amount_msat, purchase.network, purchase.idempotency_hash,
        purchase.access_token_hash, now + 120, now
      ])).rows[0];
      await client.query('COMMIT');
      return { purchase: created, shouldCreate: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async getZapPurchase(id) {
    return (await this.pool.query('SELECT * FROM zap_purchases WHERE id = $1', [id])).rows[0];
  }
  async setZapRequest(id, { receiverPubkey, callbackUrl, minSendable, maxSendable, zapRequestId, zapRequestJson, zapRequest }) {
    const result = await this.pool.query(`UPDATE zap_purchases SET receiver_pubkey = $2, callback_url = $3,
      min_sendable = $4, max_sendable = $5, zap_request_id = $6, zap_request_json = $7, zap_request = $8, updated_at = $9
      WHERE id = $1 AND status = 'creating' AND zap_request_id IS NULL RETURNING *`,
    [id, receiverPubkey, callbackUrl, minSendable, maxSendable, zapRequestId, zapRequestJson, zapRequest, Math.floor(Date.now() / 1000)]);
    if (result.rowCount === 1) return result.rows[0];
    const previous = await this.getZapPurchase(id);
    if (previous?.zap_request_id === zapRequestId) return previous;
    throw new HttpError(409, 'PURCHASE_CREATION_CONFLICT', 'The purchase request is already being created.');
  }
  async saveZapInvoice(id, invoice) {
    const result = await this.pool.query(`UPDATE zap_purchases SET invoice_request = $2, payment_hash = $3,
      invoice_payee_pubkey = $4, invoice_issued_at = $5, invoice_expires_at = $6, status = 'pending',
      next_receipt_check_at = $7, updated_at = $7
      WHERE id = $1 AND status = 'creating' RETURNING *`,
    [id, invoice.request, invoice.payment_hash, invoice.payee_pubkey, invoice.timestamp, invoice.expires_at, Math.floor(Date.now() / 1000)]);
    if (result.rowCount !== 1) throw new HttpError(409, 'PURCHASE_CREATION_CONFLICT', 'The purchase could not be completed safely.');
    return result.rows[0];
  }
  async failZapPurchaseCreation(id) {
    await this.pool.query(`UPDATE zap_purchases SET status = 'failed', updated_at = $2
      WHERE id = $1 AND status = 'creating'`, [id, Math.floor(Date.now() / 1000)]);
  }
  async getZapPurchaseForBuyer(id, accessTokenHash) {
    return (await this.pool.query('SELECT * FROM zap_purchases WHERE id = $1 AND access_token_hash = $2',
      [id, accessTokenHash])).rows[0];
  }
  async claimZapReceiptCheck(id, now) {
    const result = await this.pool.query(`UPDATE zap_purchases SET receipt_attempts = receipt_attempts + 1,
      next_receipt_check_at = $2 + LEAST(600, 2 ^ LEAST(receipt_attempts, 9)), updated_at = $2
      WHERE id = $1 AND status = 'pending' AND next_receipt_check_at <= $2 RETURNING *`, [id, now]);
    return result.rows[0];
  }
  async verifyZapPurchase({ purchaseId, receiptEvent, settledAt, licenseEvent }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const purchase = (await client.query('SELECT * FROM zap_purchases WHERE id = $1 FOR UPDATE', [purchaseId])).rows[0];
      if (!purchase) throw new HttpError(404, 'NOT_FOUND', 'Purchase not found.');
      if (purchase.status === 'verified') { await client.query('COMMIT'); return false; }
      if (purchase.status !== 'pending') { await client.query('COMMIT'); return false; }
      const offer = (await client.query('SELECT document FROM offers WHERE id = $1 FOR UPDATE', [purchase.offer_id])).rows[0]?.document;
      if (!offer || offer.event_id !== purchase.offer_event_id || offer.status !== 'published') {
        throw new HttpError(409, 'OFFER_NOT_PURCHASABLE', 'The signed offer is no longer available for licensing.');
      }
      await client.query(`INSERT INTO nostr_outbox(event_id, offer_id, event) VALUES ($1, $2, $3)`,
        [licenseEvent.id, purchase.offer_id, licenseEvent]);
      const nextOffer = {
        ...offer,
        status: 'licensing',
        license_event_id: licenseEvent.id,
        licensed_at: settledAt,
        payment: {
          provider: 'nostr-zap', invoice_id: purchase.payment_hash, payment_hash: purchase.payment_hash,
          request: purchase.invoice_request, amount_sats: Number(purchase.amount_sats), status: 'attested',
          reference: purchase.id, expires_at: Number(purchase.invoice_expires_at), settled_at: settledAt
        }
      };
      await client.query('UPDATE offers SET document = $2 WHERE id = $1', [purchase.offer_id, nextOffer]);
      await client.query(`UPDATE zap_purchases SET status = 'verified', receipt_event_id = $2,
        receipt_event = $3, settled_at = $4, updated_at = $4 WHERE id = $1`,
      [purchaseId, receiptEvent.id, receiptEvent, settledAt]);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async idempotent(scope, digest, work) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [scope]);
      const previous = (await client.query('SELECT digest, response FROM api_requests WHERE scope = $1', [scope])).rows[0];
      if (previous) {
        if (previous.digest !== digest) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This key was already used for a different request body.');
        await client.query('COMMIT');
        return previous.response;
      }
      const response = await work({
        insertOffer: offer => client.query('INSERT INTO offers(id, document, video_id) VALUES ($1, $2, $3)',
          [offer.id, offer, PostgresOfferStore.videoId(offer)]),
        getOfferForUpdate: async id => (await client.query('SELECT document FROM offers WHERE id = $1 FOR UPDATE', [id])).rows[0]?.document,
        insertVideo: video => client.query('INSERT INTO videos(id, owner_public_key, document) VALUES ($1, $2, $3)',
          [video.id, video.owner_public_key, video]),
        issueUploadSession: session => client.query('INSERT INTO upload_sessions(id, owner_public_key, expires_at) VALUES ($1, $2, to_timestamp($3::double precision))',
          [session.id, session.owner_public_key, session.expires_at]),
        // Single use and owner scoped: consuming the session in the same
        // transaction as the insert keeps registration atomic.
        consumeUploadSession: (id, owner, now) => client
          .query('DELETE FROM upload_sessions WHERE id = $1 AND owner_public_key = $2 AND expires_at > to_timestamp($3::double precision) RETURNING id',
            [id, owner, now])
          .then(result => result.rowCount === 1),
        queueOffer: async (offer, event) => {
          await client.query('INSERT INTO nostr_outbox(event_id, offer_id, event) VALUES ($1, $2, $3)', [event.id, offer.id, event]);
          await client.query('UPDATE offers SET document = $2, event_id = $3, video_id = $4 WHERE id = $1',
            [offer.id, offer, event.id, PostgresOfferStore.videoId(offer)]);
        }
      });
      await client.query('INSERT INTO api_requests(scope, digest, response) VALUES ($1, $2, $3)', [scope, digest, response]);
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') throw new HttpError(409, 'EVENT_ALREADY_USED', 'This signed event is already assigned to an offer.');
      throw error;
    } finally { client.release(); }
  }
  async publishNext(publish) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const item = (await client.query(`SELECT * FROM nostr_outbox WHERE published_at IS NULL
        AND next_attempt_at <= now() ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
      if (!item) { await client.query('COMMIT'); return false; }
      let relay;
      try { relay = await publish(item.event); } catch (error) {
        const delay = Math.min(300, 2 ** Math.min(item.attempts + 1, 9));
        await client.query(`UPDATE nostr_outbox SET attempts = attempts + 1, last_error = $2,
          next_attempt_at = now() + ($3 * interval '1 second') WHERE event_id = $1`,
        [item.event_id, String(error.message).slice(0, 500), delay]);
        await client.query('COMMIT');
        return true;
      }
      await client.query(`UPDATE nostr_outbox SET published_at = now(), acknowledged_relay = $2,
        attempts = attempts + 1, last_error = NULL WHERE event_id = $1`, [item.event_id, relay]);
      await client.query(`UPDATE offers SET document = CASE
        WHEN document->>'status' = 'publishing' THEN jsonb_set(document, '{status}', '"published"'::jsonb)
        WHEN document->>'status' = 'licensing' THEN jsonb_set(document, '{status}', '"licensed"'::jsonb)
        ELSE document END WHERE id = $1`, [item.offer_id]);
      await client.query('COMMIT');
      return true;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
