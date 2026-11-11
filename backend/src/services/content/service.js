import { randomUUID } from 'node:crypto';
import { validate } from '../../validators/validation.js';
import { HttpError } from '../../utils/errors.js';
import { ALLOWED_FORMATS, RESOURCE_TYPE } from '../media/cloudinary.js';
import { CONTENT_SERVICE, createMedia, pendingReference } from '../media/index.js';

const UPLOAD_SESSION_TTL = 3600;

const summary = row => ({
  offer_id: row.id, status: row.status, price_sats: row.amount_sats ?? null, price: row.price ?? null, created_at: row.created_at
});
const attachOffers = rows => rows.map(summary);
const CONTENT_FORMATS = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv', 'video/3gpp': '3gp' };

export function createContentService({ store, cloudinary = null, media = createMedia({ cloudinary }), now = () => Math.floor(Date.now() / 1000) }) {
  const input = (schema, body) => {
    try { validate(schema, body); } catch (error) { throw new HttpError(400, 'VALIDATION_ERROR', error.message); }
  };
  const requireUploads = () => {
    if (!media.uploadProvider) throw new HttpError(501, 'MEDIA_NOT_CONFIGURED',
      'No media provider is configured. Configure Cloudinary (CLOUDINARY_*) or a content service (MEDIA_PROVIDER=content-service).');
    return media.uploadProvider;
  };
  // Owner-only projection. The original is included only where the provider
  // exposes one to the owner; discovery never calls this.
  const owned = (video, offers) => ({
    video,
    preview_url: video.status === 'ready' || !video.media_provider ? media.previewUrl(video) : null,
    thumbnail_url: video.status === 'ready' || !video.media_provider ? media.thumbnailUrl(video) : null,
    original_url: media.ownerOriginalUrl(video),
    offers
  });
  // Content-service videos finish processing after registration; bring their
  // records up to date when the creator looks at them.
  const fresh = async (video) => {
    const updated = await media.refresh(video, now());
    if (!updated) return video;
    await store.updateVideoDocument(updated);
    return updated;
  };

  return {
    // Authorises one direct browser upload: signed Cloudinary parameters, or a
    // resumable session from the content service. Secrets never reach the browser.
    async authorizeUpload({ pubkey, key, digest, body, origin }) {
      const provider = requireUploads();
      const uploadSessionId = randomUUID().replaceAll('-', '');
      const timestamp = now();
      if (provider === CONTENT_SERVICE) {
        input('ResumableUploadRequest', body ?? {});
        return store.idempotent(`${pubkey}:POST:/videos/upload-authorization:${key}`, digest, async tx => {
          const created = await media.contentService.createUpload({
            ownerPubkey: pubkey, filename: body.filename, contentType: body.content_type, sizeBytes: body.size_bytes, origin: origin ?? undefined
          });
          await tx.issueUploadSession({ id: uploadSessionId, owner_public_key: pubkey, expires_at: timestamp + UPLOAD_SESSION_TTL });
          return { status: 201, body: {
            provider: CONTENT_SERVICE, upload_session_id: uploadSessionId, asset_id: created.asset.id,
            upload: { protocol: created.upload.protocol, url: created.upload.url, chunk_bytes: created.upload.chunkBytes, max_bytes: created.upload.maxBytes }
          } };
        });
      }
      return store.idempotent(`${pubkey}:POST:/videos/upload-authorization:${key}`, digest, async tx => {
        await tx.issueUploadSession({ id: uploadSessionId, owner_public_key: pubkey, expires_at: timestamp + UPLOAD_SESSION_TTL });
        return { status: 201, body: media.cloudinary.createUploadAuthorization({ uploadSessionId, timestamp }) };
      });
    },

    async register({ pubkey, body, key, digest }) {
      const provider = requireUploads();
      let video;
      let sessionId;
      if (body && typeof body === 'object' && 'asset_id' in body) {
        if (provider !== CONTENT_SERVICE) throw new HttpError(400, 'VALIDATION_ERROR', 'This server does not accept content-service uploads.');
        input('AssetRegistration', body);
        sessionId = body.upload_session_id;
        if ((await store.listVideosByOwner(pubkey)).some(v => v.public_id === body.asset_id)) {
          throw new HttpError(409, 'ALREADY_REGISTERED', 'This upload is already in your library.');
        }
        // The content service verifies the upload belongs to this creator and arrived whole.
        const asset = await media.contentService.complete(body.asset_id, pubkey);
        const ready = asset.status === 'ready';
        video = {
          id: randomUUID(), owner_public_key: pubkey, title: body.title,
          media_provider: CONTENT_SERVICE, cloud_name: CONTENT_SERVICE, public_id: asset.id, asset_version: 1,
          resource_type: RESOURCE_TYPE, format: CONTENT_FORMATS[asset.contentType] ?? 'mp4',
          status: ready ? 'ready' : asset.status === 'failed' ? 'failed' : 'processing',
          reference_sha256: ready ? asset.sha256 : pendingReference(asset.id),
          original_sha256: ready ? asset.sha256 : null,
          bytes: asset.sizeBytes ?? null, duration_seconds: null, width: asset.width ?? null, height: asset.height ?? null,
          ...(ready && asset.previewUrl ? { preview_url: asset.previewUrl, thumbnail_url: asset.thumbnailUrl } : {}),
          upload_session_id: sessionId, created_at: now(), updated_at: now()
        };
      } else {
        if (provider === CONTENT_SERVICE && !media.cloudinary) throw new HttpError(400, 'VALIDATION_ERROR', 'Register this upload with asset_id.');
        const cloudinary = media.cloudinary;
        input('VideoRegistration', body);
        if (!cloudinary.ownsPublicId(body.public_id)) throw new HttpError(400, 'VALIDATION_ERROR',
          'The asset must be uploaded to the ContentPort folder issued by the upload authorisation.');
        if (!ALLOWED_FORMATS.includes(String(body.format).toLowerCase())) throw new HttpError(400, 'VALIDATION_ERROR',
          'Unsupported media format.');
        sessionId = body.context.split('=')[1];
        video = {
          id: randomUUID(), owner_public_key: pubkey, title: body.title,
          cloud_name: cloudinary.cloudName, public_id: body.public_id, asset_version: body.asset_version,
          resource_type: RESOURCE_TYPE, format: body.format.toLowerCase(), status: body.status,
          reference_sha256: cloudinary.referenceSha256(body.public_id, body.asset_version),
          original_sha256: body.original_sha256, bytes: body.bytes, duration_seconds: body.duration_seconds,
          width: body.width, height: body.height, upload_session_id: sessionId,
          created_at: now(), updated_at: now()
        };
      }
      input('Video', video);
      return store.idempotent(`${pubkey}:POST:/videos:${key}`, digest, async tx => {
        if (!await tx.consumeUploadSession(sessionId, pubkey, now())) {
          throw new HttpError(403, 'FORBIDDEN', 'No valid upload authorisation matches this registration.');
        }
        await tx.insertVideo(video);
        return { status: 201, body: owned(video, []) };
      });
    },

    // Ownership is decided by the database query on the authenticated public
    // key, never by anything the caller sends.
    async listMine({ pubkey }) {
      const videos = await Promise.all((await store.listVideosByOwner(pubkey)).map(fresh));
      const offers = await store.listOffersForOwner(pubkey);
      const byVideo = new Map();
      for (const row of offers) {
        if (!byVideo.has(row.video_id)) byVideo.set(row.video_id, []);
        byVideo.get(row.video_id).push(summary(row));
      }
      return { status: 200, body: { videos: videos.map(video => owned(video, byVideo.get(video.id) || [])) } };
    },
    async getOne({ id, pubkey }) {
      const stored = await store.getOwnedVideo(id, pubkey);
      if (!stored) throw new HttpError(404, 'NOT_FOUND', 'Video not found.');
      const video = await fresh(stored);
      return { status: 200, body: owned(video, attachOffers(await store.listOffersForVideo(id))) };
    },
    async remove({ id, pubkey }) {
      const video = await store.getOwnedVideo(id, pubkey);
      if (!video) throw new HttpError(404, 'NOT_FOUND', 'Video not found.');
      if ((await store.listOffersForVideo(id)).length) {
        throw new HttpError(409, 'VIDEO_IN_USE', 'This video is already referenced by an offer and cannot be deleted.');
      }
      await media.remove(video);
      await store.deleteOwnedVideo(id, pubkey);
      return { status: 200, body: { id, deleted: true } };
    },
    /** Exposed for the offer service: an up-to-date record before an offer is created. */
    fresh
  };
}
