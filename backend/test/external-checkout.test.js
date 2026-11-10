import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { createOfferService } from '../src/services/offers/service.js';
import { buildOfferEvent, buildLicenseEvent } from '../src/services/nostr/events.js';
import { createBtcRateProvider, fiatMinorToSats, resolveOfferSats } from '../src/services/payments/rates.js';
import { validate } from '../src/validators/validation.js';
import { PostgresOfferStore } from '../src/repositories/offers.js';
import { applyMigrations } from '../src/database/migrate.js';

const creatorSecret = generateSecretKey();
const creatorPubkey = getPublicKey(creatorSecret);
const attestorSecret = generateSecretKey();
const attestorPubkey = getPublicKey(attestorSecret);
const sha = value => createHash('sha256').update(value).digest('hex');

const kesTerms = {
  brand: 'Acme Kenya', content_url: 'https://example.org/preview.mp4', content_sha256: 'c'.repeat(64),
  price: { currency: 'KES', amount_minor: 400000 }, usage_rights: 'Social use', duration: { type: 'fixed', days: 30 }
};

// ---------------------------------------------------------------------------
// Pricing and rates
// ---------------------------------------------------------------------------

test('fiat to sats conversion is integer-only and rounds up to a whole sat', () => {
  // KES 4,000 at KES 10,000,000 per BTC = 0.0004 BTC = 40,000 sats exactly.
  assert.equal(fiatMinorToSats(400000, 1_000_000_000), 40000);
  // Any remainder rounds up so the creator never receives less than the price.
  assert.equal(fiatMinorToSats(1, 1_000_000_000), 1);
  assert.equal(fiatMinorToSats(400001, 1_000_000_000), 40001);
  assert.throws(() => fiatMinorToSats(0, 100), TypeError);
  assert.throws(() => fiatMinorToSats(100, 0), TypeError);
  assert.throws(() => fiatMinorToSats(1.5, 100), TypeError);
});

test('rate provider caches per currency, tolerates a brief upstream outage, and rejects unknown currencies', async () => {
  let calls = 0;
  let clock = 1000;
  let fail = false;
  const provider = createBtcRateProvider({
    ttlSeconds: 300, now: () => clock,
    fetch: async (url) => {
      calls += 1;
      if (fail) throw new Error('offline');
      assert.match(url, /ids=bitcoin&vs_currencies=kes$/);
      return { ok: true, json: async () => ({ bitcoin: { kes: 9876543.21 } }) };
    }
  });
  const first = await provider.getRate('kes');
  assert.deepEqual(first, { currency: 'KES', btc_price_minor: 987654321, fetched_at: 1000 });
  await provider.getRate('KES');
  assert.equal(calls, 1, 'second read inside the TTL is served from cache');
  clock += 301;
  fail = true;
  assert.deepEqual(await provider.getRate('KES'), first, 'a recently stale rate is used while the source is down');
  clock += 300 * 6;
  await assert.rejects(provider.getRate('KES'), { code: 'RATE_UNAVAILABLE' });
  await assert.rejects(provider.getRate('XYZ'), { code: 'CURRENCY_UNSUPPORTED' });
});

test('offer terms accept a KES price without sats or a Lightning Address, and still require some price', () => {
  validate('Terms', kesTerms);
  validate('Terms', { ...kesTerms, lightning_address: 'creator@example.org' });
  const { price, ...unpriced } = kesTerms;
  assert.throws(() => validate('Terms', unpriced), TypeError);
  assert.throws(() => validate('Terms', { ...kesTerms, price: { currency: 'kes', amount_minor: 100 } }), TypeError);
  assert.throws(() => validate('Terms', { ...kesTerms, price: { currency: 'KES', amount_minor: 0 } }), TypeError);
  assert.throws(() => validate('Terms', { ...kesTerms, price: { currency: 'KES', amount_minor: 10.5 } }), TypeError);
});

test('sats-priced offers keep their exact amount; KES offers are quoted from the server rate', async () => {
  assert.deepEqual(await resolveOfferSats({ amount_sats: 5000 }, null), { amountSats: 5000, rate: null });
  const rateProvider = { getRate: async () => ({ currency: 'KES', btc_price_minor: 1_000_000_000, fetched_at: 1 }) };
  assert.equal((await resolveOfferSats(kesTerms, rateProvider)).amountSats, 40000);
  await assert.rejects(resolveOfferSats(kesTerms, null), { code: 'RATE_UNAVAILABLE' });
});

test('a KES-priced Lightning license records the settled sats amount and requires one', () => {
  const offerEvent = finalizeEvent(buildOfferEvent({
    kind: 9998, creatorPubkey, attestorPubkey, terms: { ...kesTerms, lightning_address: 'creator@example.org' }, createdAt: 1000
  }), creatorSecret);
  const license = buildLicenseEvent({ kind: 9998, attestorPubkey, offerEvent,
    settlement: { offer_event_id: offerEvent.id, payment_hash: 'f'.repeat(64), amount_sats: 40000, settled_at: 2000 } });
  assert.equal(JSON.parse(license.content).amount_sats, 40000);
  assert.throws(() => buildLicenseEvent({ kind: 9998, attestorPubkey, offerEvent,
    settlement: { offer_event_id: offerEvent.id, payment_hash: 'f'.repeat(64), settled_at: 2000 } }), /amount missing/);
});

// ---------------------------------------------------------------------------
// Offer creation and Lightning availability (in-memory store)
// ---------------------------------------------------------------------------

function memoryService({ offer, rateProvider = null, zapPaymentProvider = null } = {}) {
  const inserted = [];
  const reserved = [];
  const store = {
    idempotent: async (_scope, _digest, work) => work({ insertOffer: async value => { inserted.push(value); } }),
    getOffer: async () => offer,
    reserveZapPurchase: async ({ purchase }) => { reserved.push(purchase); return { purchase: { ...purchase, status: 'creating' }, shouldCreate: true }; },
    setZapRequest: async () => {},
    saveZapInvoice: async (id) => ({ ...reserved.at(-1), id, status: 'pending', invoice_request: 'lnbc1invoice' }),
    failZapPurchaseCreation: async () => {}
  };
  const service = createOfferService({ store, verifyEvent, kind: 9998, attestorPubkey, attestorSecretKey: attestorSecret,
    zapPaymentProvider, rateProvider, paymentNetwork: 'mainnet', now: () => 2000 });
  return { service, inserted, reserved };
}

test('a creator can publish a KES-priced offer with no Lightning Address', async () => {
  const { service, inserted } = memoryService();
  const { lightning_address, ...body } = { ...kesTerms };
  const result = await service.create({ pubkey: creatorPubkey, key: 'offer-key-000001', digest: 'd', body: { ...body, lightning_address: '' } });
  assert.equal(result.status, 201);
  assert.equal('lightning_address' in inserted[0].terms, false, 'an empty address is not signed into the offer');
  assert.deepEqual(inserted[0].terms.price, { currency: 'KES', amount_minor: 400000 });
});

test('Lightning checkout is refused for an offer without a Lightning Address', async () => {
  const offer = { id: 'o1', creator_pubkey: creatorPubkey, terms: kesTerms, event_id: 'e'.repeat(64), status: 'published' };
  const { service } = memoryService({ offer, zapPaymentProvider: {} });
  await assert.rejects(service.createPayment('o1', { key: 'k'.repeat(32), purchaseToken: 'a'.repeat(64) }), { code: 'LIGHTNING_UNAVAILABLE' });
});

test('Lightning checkout for a KES offer reserves the sats amount from the server rate', async () => {
  const terms = { ...kesTerms, lightning_address: 'creator@example.org' };
  const offer = { id: 'o2', creator_pubkey: creatorPubkey, terms, event_id: 'e'.repeat(64), status: 'published' };
  const zapPaymentProvider = {
    createRequest: async ({ amountSats }) => ({ endpoint: { address: terms.lightning_address, callback: 'https://x', nostr_pubkey: 'b'.repeat(64), min_sendable: 1, max_sendable: 1e12 },
      zapRequest: { json: '{}', event: { id: 'z'.repeat(64) } }, amountSats }),
    requestInvoice: async ({ amountMsat }) => { assert.equal(amountMsat, 40000 * 1000); return 'lnbc1invoice'; }
  };
  const rateProvider = { getRate: async () => ({ currency: 'KES', btc_price_minor: 1_000_000_000, fetched_at: 1 }) };
  const { service, reserved } = memoryService({ offer, rateProvider, zapPaymentProvider });
  const result = await service.createPayment('o2', { key: 'k'.repeat(32), purchaseToken: 'a'.repeat(64) });
  assert.equal(result.status, 201);
  assert.equal(reserved[0].amount_sats, 40000);
  assert.equal(result.body.amountSats, 40000);
});

// ---------------------------------------------------------------------------
// External (card / mobile money) attestation and download credentials, against
// real PostgreSQL so the transaction and unique constraints are exercised.
// ---------------------------------------------------------------------------

async function withStore(run) {
  const { default: pg } = await import('pg');
  const schema = 'cp_ext_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  try {
    await applyMigrations(pool);
    await run(pool, new PostgresOfferStore(pool));
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

let offerClock = 1000;
async function publishedOffer(pool, store) {
  const offerId = randomUUID();
  const offerEvent = finalizeEvent(buildOfferEvent({ kind: 9998, creatorPubkey, attestorPubkey, terms: kesTerms, createdAt: offerClock++ }), creatorSecret);
  const videoId = randomUUID();
  await pool.query('INSERT INTO videos(id, owner_public_key, document) VALUES ($1, $2, $3)',
    [videoId, creatorPubkey, { id: videoId, public_id: 'contentport/videos/test', format: 'mp4', status: 'ready' }]);
  const document = { id: offerId, creator_pubkey: creatorPubkey, terms: kesTerms, status: 'published', event_id: offerEvent.id,
    video_id: videoId, created_at: 1000 };
  await store.saveOfferDocument(document);
  await pool.query('INSERT INTO nostr_outbox(event_id, offer_id, event) VALUES ($1, $2, $3)', [offerEvent.id, offerId, offerEvent]);
  return { offerId, offerEvent };
}

const serviceFor = store => createOfferService({ store, verifyEvent, kind: 9998, attestorPubkey, attestorSecretKey: attestorSecret,
  paymentEnabled: false, now: () => 5000 });

test('external payment attestation licenses once, is idempotent per reference, and rejects a second payment', async t => {
  if (!process.env.TEST_DATABASE_URL) { t.skip('Set TEST_DATABASE_URL to a disposable PostgreSQL database'); return; }
  await withStore(async (pool, store) => {
    const service = serviceFor(store);
    const { offerId, offerEvent } = await publishedOffer(pool, store);
    const credential = 'e'.repeat(64);
    const body = { offerId, offerEventId: offerEvent.id, externalReference: 'anza_ref_000001', settledAt: 4000, credentialToken: credential };
    const first = await service.externalPaymentAttestation({ id: offerId, body });
    assert.equal(first.status, 201);
    assert.equal(first.body.alreadyLicensed, false);
    const licensed = await store.getOffer(offerId);
    assert.equal(licensed.status, 'licensing');
    assert.equal(licensed.external_payment.reference, 'anza_ref_000001');
    const licenseEvent = await store.getOfferEvent(offerId, licensed.license_event_id);
    assert.equal(verifyEvent(licenseEvent), true);
    assert.equal(JSON.parse(licenseEvent.content).external_reference, 'anza_ref_000001');

    // A lost response is retried by the payment service: same license, no duplicate.
    const retry = await service.externalPaymentAttestation({ id: offerId, body });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.alreadyLicensed, true);
    assert.equal(retry.body.licenseEventId, first.body.licenseEventId);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM external_purchase_associations')).rows[0].n, 1);

    // A different payment for the same (already licensed) offer must be refunded, not licensed.
    await assert.rejects(service.externalPaymentAttestation({ id: offerId,
      body: { ...body, externalReference: 'anza_ref_000002', credentialToken: 'f'.repeat(64) } }), { code: 'OFFER_ALREADY_LICENSED' });
    await assert.rejects(service.externalPaymentAttestation({ id: offerId, body: { ...body, credentialToken: 'short' } }), { code: 'VALIDATION_ERROR' });
    await assert.rejects(service.externalPaymentAttestation({ id: 'other', body }), { code: 'VALIDATION_ERROR' });
  });
});

test('download grants require the buyer credential, work without Lightning enabled, and cannot be claimed by purchase id alone', async t => {
  if (!process.env.TEST_DATABASE_URL) { t.skip('Set TEST_DATABASE_URL to a disposable PostgreSQL database'); return; }
  await withStore(async (pool, store) => {
    const service = serviceFor(store);
    const { offerId, offerEvent } = await publishedOffer(pool, store);
    const other = await publishedOffer(pool, store);
    const credential = 'a1'.repeat(32);
    await service.externalPaymentAttestation({ id: offerId,
      body: { offerId, offerEventId: offerEvent.id, externalReference: 'anza_ref_000003', settledAt: 4000, credentialToken: credential } });

    const grant = await service.issueDownloadGrant(offerId, undefined, credential);
    assert.equal(grant.status, 201);
    assert.match(grant.body.grantToken, /^[0-9a-f]{64}$/);
    const row = (await pool.query('SELECT external_reference FROM download_grants WHERE token_hash = $1', [sha(grant.body.grantToken)])).rows[0];
    assert.equal(row.external_reference, 'anza_ref_000003');
    // The credential is reusable so the buyer can download again later.
    assert.equal((await service.issueDownloadGrant(offerId, undefined, credential)).status, 201);

    await assert.rejects(service.issueDownloadGrant(offerId, undefined, 'b2'.repeat(32)), { code: 'FORBIDDEN' });
    await assert.rejects(service.issueDownloadGrant(other.offerId, undefined, credential), { code: 'FORBIDDEN' });
    await assert.rejects(service.issueDownloadGrant(offerId, undefined, 'not-hex'), { code: 'FORBIDDEN' });
    // Purchase ids are public in license events; without the secret they grant nothing.
    await assert.rejects(service.issueDownloadGrant(offerId, randomUUID(), undefined), { status: 503 });
  });
});
