import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { createOfferService } from '../src/services/offers/service.js';
import { createContentService } from '../src/services/content/service.js';
import { createCloudinary } from '../src/services/media/cloudinary.js';
import { createMedia, pendingReference } from '../src/services/media/index.js';
import { createContentServiceClient } from '../src/services/media/content-service.js';
import { HttpError } from '../src/utils/errors.js';

const creator = 'a'.repeat(64);
const other = 'b'.repeat(64);
const attestorPubkey = 'c'.repeat(64);
const ASSET = '11111111-2222-4333-8444-555555555555';
const SHA = 'd'.repeat(64);

/** A fake content service: records calls, lets the test finish processing. */
function fakeContentService() {
  const assets = new Map();
  const calls = [];
  const view = (a) => ({ ...a });
  return {
    calls, assets,
    async createUpload(input) {
      calls.push(['createUpload', input]);
      assets.set(ASSET, { id: ASSET, owner: input.ownerPubkey, status: 'uploading', contentType: input.contentType, sizeBytes: input.sizeBytes, sha256: null, previewUrl: null, thumbnailUrl: null });
      return { asset: view(assets.get(ASSET)), upload: { protocol: 'gcs-resumable', url: 'https://storage.example/upload?upload_id=xyz', chunkBytes: 8388608, maxBytes: 524288000 } };
    },
    async complete(id, owner) {
      calls.push(['complete', id, owner]);
      const a = assets.get(id);
      if (!a || a.owner !== owner) throw new HttpError(404, 'NOT_FOUND', 'Video not found.');
      a.status = 'processing';
      return view(a);
    },
    async get(id, owner) {
      const a = assets.get(id);
      if (!a || (owner && a.owner !== owner)) throw new HttpError(404, 'NOT_FOUND', 'Video not found.');
      return view(a);
    },
    async downloadUrl(id, opts) { calls.push(['downloadUrl', id, opts]); return { url: `https://storage.example/originals/${id}?X-Goog-Signature=abc`, expiresAt: 'x' }; },
    async remove(id, owner) { calls.push(['remove', id, owner]); assets.delete(id); },
    finish() {
      Object.assign(assets.get(ASSET), { status: 'ready', sha256: SHA, format: 'mov', durationSeconds: 12.4, width: 1080, height: 1920, sizeBytes: 2048,
        previewUrl: `https://media.example/p/${ASSET}/preview.mp4`, thumbnailUrl: `https://media.example/p/${ASSET}/thumbnail.jpg` });
    }
  };
}

function setup({ withCloudinary = false } = {}) {
  const offers = new Map(), videos = new Map(), requests = new Map(), sessions = new Map();
  const store = {
    getOffer: async (id) => offers.get(id),
    getVideo: async (id) => videos.get(id),
    getOwnedVideo: async (id, owner) => { const v = videos.get(id); return v && v.owner_public_key === owner ? v : undefined; },
    updateVideoDocument: async (v) => { videos.set(v.id, v); return 1; },
    listVideosByOwner: async (owner) => [...videos.values()].filter((v) => v.owner_public_key === owner),
    deleteOwnedVideo: async (id, owner) => (videos.get(id)?.owner_public_key === owner && videos.delete(id) ? 1 : 0),
    listOffersForVideo: async (videoId) => [...offers.values()].filter((o) => o.video_id === videoId).map((o) => ({ id: o.id, status: o.status, amount_sats: null, created_at: 1 })),
    listOffersForOwner: async () => [],
    listDiscoverableOffers: async () => [...offers.values()].filter((o) => o.status === 'published').map((offer) => ({ offer, video: videos.get(offer.video_id) })),
    async idempotent(scope, digest, work) {
      if (requests.has(scope)) return requests.get(scope);
      const result = await work({
        insertOffer: async (o) => { offers.set(o.id, o); return o; },
        insertVideo: async (v) => { videos.set(v.id, v); return v; },
        issueUploadSession: async (s) => { sessions.set(s.id, s); },
        consumeUploadSession: async (id, owner, at) => { const s = sessions.get(id); if (!s || s.owner_public_key !== owner || s.expires_at <= at) return false; return sessions.delete(id); }
      });
      requests.set(scope, result);
      return result;
    }
  };
  const cs = fakeContentService();
  const cloudinary = withCloudinary ? createCloudinary({ cloudName: 'demo', apiKey: 'apikey123', apiSecret: 'cloudinary-api-secret', folder: 'contentport/videos' }) : null;
  const media = createMedia({ cloudinary, contentService: cs, provider: 'content-service' });
  return {
    cs, offers, videos, sessions, media,
    content: createContentService({ store, cloudinary, media, now: () => 1000 }),
    service: createOfferService({ store, verifyEvent: () => true, kind: 9998, attestorPubkey, speedWebhookSecret: 'test-webhook-secret', media, now: () => 1000 })
  };
}

let n = 0;
const key = (p) => `${p}-${String(++n).padStart(12, '0')}`;
const offerBody = (videoId) => ({ video_id: videoId, title: 'Sunset', brand: 'Acme', price: { currency: 'KES', amount_minor: 400000 }, usage_rights: 'Social use', duration: { type: 'perpetual' } });

test('content service: upload authorisation is a resumable session bound to the creator and site', async () => {
  const { content, cs, sessions } = setup();
  await assert.rejects(content.authorizeUpload({ pubkey: creator, key: key('u'), digest: 'd', body: {} }), { status: 400 }, 'file details are required');
  await assert.rejects(content.authorizeUpload({ pubkey: creator, key: key('u'), digest: 'd', body: { filename: 'x.html', content_type: 'text/html', size_bytes: 10 } }), { status: 400 });
  const auth = await content.authorizeUpload({ pubkey: creator, key: key('u'), digest: 'd', origin: 'https://studio.example', body: { filename: 'clip.mov', content_type: 'video/quicktime', size_bytes: 2048 } });
  assert.equal(auth.status, 201);
  assert.equal(auth.body.provider, 'content-service');
  assert.equal(auth.body.asset_id, ASSET);
  assert.deepEqual(auth.body.upload, { protocol: 'gcs-resumable', url: 'https://storage.example/upload?upload_id=xyz', chunk_bytes: 8388608, max_bytes: 524288000 });
  assert.deepEqual(cs.calls[0], ['createUpload', { ownerPubkey: creator, filename: 'clip.mov', contentType: 'video/quicktime', sizeBytes: 2048, origin: 'https://studio.example' }]);
  assert.ok(sessions.has(auth.body.upload_session_id));
});

test('content service: register -> processing (no offers yet) -> ready with the real file hash -> offer signs it', async () => {
  const { content, service, cs, videos } = setup();
  const auth = (await content.authorizeUpload({ pubkey: creator, key: key('u'), digest: 'd', body: { filename: 'clip.mov', content_type: 'video/quicktime', size_bytes: 2048 } })).body;
  // Another creator cannot register this upload.
  await assert.rejects(content.register({ pubkey: other, key: key('r'), digest: 'd', body: { title: 'Mine', upload_session_id: auth.upload_session_id, asset_id: ASSET } }), { status: 404 });
  const registered = await content.register({ pubkey: creator, key: key('r'), digest: 'd', body: { title: 'Sunset clip', upload_session_id: auth.upload_session_id, asset_id: ASSET } });
  assert.equal(registered.status, 201);
  const video = registered.body.video;
  assert.equal(video.media_provider, 'content-service');
  assert.equal(video.status, 'processing');
  assert.equal(video.reference_sha256, pendingReference(ASSET), 'placeholder until the file is hashed');
  assert.equal(registered.body.preview_url, null, 'no preview while processing');
  await assert.rejects(content.register({ pubkey: creator, key: key('r'), digest: 'd', body: { title: 'Again', upload_session_id: auth.upload_session_id, asset_id: ASSET } }), { status: 409 });

  await assert.rejects(service.create({ pubkey: creator, key: key('o'), digest: 'd', body: offerBody(video.id) }), { code: 'VIDEO_NOT_READY' });

  cs.finish();
  const library = (await content.listMine({ pubkey: creator })).body.videos;
  assert.equal(library[0].video.status, 'ready');
  assert.equal(library[0].video.reference_sha256, SHA, 'the real SHA-256 of the file');
  assert.equal(library[0].video.original_sha256, SHA);
  assert.deepEqual([library[0].video.width, library[0].video.height, library[0].video.duration_seconds, library[0].video.format], [1080, 1920, 12, 'mov']);
  assert.equal(library[0].preview_url, `https://media.example/p/${ASSET}/preview.mp4`);
  assert.equal(library[0].original_url, null, 'originals are only reachable through signed links');
  assert.equal(videos.get(video.id).status, 'ready', 'the refresh is stored');

  const offer = await service.create({ pubkey: creator, key: key('o'), digest: 'd', body: offerBody(video.id) });
  assert.equal(offer.body.terms.content_url, `https://media.example/p/${ASSET}/preview.mp4`);
  assert.equal(offer.body.terms.content_sha256, SHA);
});

test('content service: an offer can be created right after processing finishes, without visiting the library', async () => {
  const { content, service, cs } = setup();
  const auth = (await content.authorizeUpload({ pubkey: creator, key: key('u'), digest: 'd', body: { filename: 'clip.mp4', content_type: 'video/mp4', size_bytes: 2048 } })).body;
  const video = (await content.register({ pubkey: creator, key: key('r'), digest: 'd', body: { title: 'Clip', upload_session_id: auth.upload_session_id, asset_id: ASSET } })).body.video;
  cs.finish();
  const offer = await service.create({ pubkey: creator, key: key('o'), digest: 'd', body: offerBody(video.id) });
  assert.equal(offer.body.terms.content_sha256, SHA);
});

test('media layer: signed downloads, discovery and delete go to the right provider', async () => {
  const { content, service, cs, media, offers } = setup({ withCloudinary: true });
  const auth = (await content.authorizeUpload({ pubkey: creator, key: key('u'), digest: 'd', body: { filename: 'clip.mp4', content_type: 'video/mp4', size_bytes: 2048 } })).body;
  const video = (await content.register({ pubkey: creator, key: key('r'), digest: 'd', body: { title: 'Brand "deal"', upload_session_id: auth.upload_session_id, asset_id: ASSET } })).body.video;
  cs.finish();
  const ready = (await content.getOne({ id: video.id, pubkey: creator })).body.video;

  const url = await media.signedOriginalUrl(ready, Math.floor(Date.now() / 1000) + 600, { filename: ready.title });
  assert.match(url, /X-Goog-Signature/);
  const call = cs.calls.find((c) => c[0] === 'downloadUrl');
  assert.equal(call[1], ASSET);
  assert.ok(call[2].ttlSeconds >= 590 && call[2].ttlSeconds <= 600);

  // A Cloudinary video in the same library still uses Cloudinary links.
  const cldVideo = { id: 'v-cld', owner_public_key: creator, cloud_name: 'demo', public_id: 'contentport/videos/x', format: 'mp4', width: 1920, height: 1080, status: 'ready' };
  assert.match(media.previewUrl(cldVideo), /res\.cloudinary\.com\/demo/);
  assert.match(media.offerContentUrl(cldVideo), /res\.cloudinary\.com/);

  const offer = (await service.create({ pubkey: creator, key: key('o'), digest: 'd', body: offerBody(video.id) })).body;
  offers.set(offer.id, { ...offer, status: 'published' });
  const [listing] = (await service.discover()).body.offers;
  assert.equal(listing.preview_url, `https://media.example/p/${ASSET}/preview.mp4`);
  assert.equal(listing.thumbnail_url, `https://media.example/p/${ASSET}/thumbnail.jpg`);

  offers.clear();
  await content.remove({ id: video.id, pubkey: creator });
  assert.deepEqual(cs.calls.find((c) => c[0] === 'remove'), ['remove', ASSET, creator]);
});

test('content service client: signs requests (HMAC over time, method, path, body) and hides server errors', async () => {
  const SECRET = 'x'.repeat(40);
  let seen;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen = { method: req.method, url: req.url, body, ts: req.headers['x-cs-timestamp'], sig: req.headers['x-cs-signature'] };
      if (req.url.startsWith('/boom')) { res.writeHead(500); res.end('{"error":{"message":"stack trace here"}}'); return; }
      res.writeHead(req.url.includes('missing') ? 404 : 200, { 'Content-Type': 'application/json' });
      res.end(req.url.includes('missing') ? '{"error":{"code":"NOT_FOUND","message":"Video not found."}}' : '{"ok":true}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const client = createContentServiceClient({ baseUrl, auth: 'hmac', hmacSecret: SECRET }, { now: () => 1700000000 });
    await client.complete(ASSET, creator);
    const expected = createHmac('sha256', SECRET).update(`1700000000.POST./v1/assets/${ASSET}/complete.${createHash('sha256').update(seen.body).digest('hex')}`).digest('hex');
    assert.equal(seen.sig, expected);
    assert.equal(JSON.parse(seen.body).ownerPubkey, creator);
    await client.get(ASSET, creator);
    assert.equal(seen.url, `/v1/assets/${ASSET}?owner=${creator}`, 'the query is part of the signed path');
    await assert.rejects(client.get('missing-id'), { status: 404, message: 'Video not found.' });
    const broken = createContentServiceClient({ baseUrl: `${baseUrl}/boom`, auth: 'hmac', hmacSecret: SECRET });
    await assert.rejects(broken.get(ASSET), (e) => e.status === 503 && !e.message.includes('stack trace'));
  } finally {
    await new Promise((r) => server.close(r));
  }
});
