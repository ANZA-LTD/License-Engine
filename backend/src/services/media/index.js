import { createHash } from 'node:crypto';
import { mediaRef, previewUrl, thumbnailUrl, originalUrl } from './cloudinary.js';

// The media layer: one place that knows how each video's links are built.
// A video records the provider it was uploaded with (`media_provider`; absent
// means Cloudinary, for records created before providers existed), so
// switching providers never changes links already signed into offers.

export const CONTENT_SERVICE = 'content-service';

const isContentService = (video) => video?.media_provider === CONTENT_SERVICE;

/** Placeholder fingerprint while a content-service video is processing; replaced by the file's real SHA-256 when ready. */
export const pendingReference = (assetId) => createHash('sha256').update(`contentport.pending\u0000${assetId}`).digest('hex');

const STATUS = { uploading: 'processing', processing: 'processing', ready: 'ready', failed: 'failed', deleted: 'failed' };
const EXTENSIONS = { mov: 'mov', mp4: 'mp4', webm: 'webm', matroska: 'mkv', '3gp': '3gp', m4a: 'mp4', '3g2': '3gp', mj2: 'mp4' };

export function createMedia({ cloudinary = null, contentService = null, provider = 'cloudinary' } = {}) {
  const watermarkFor = (video) => {
    if (!cloudinary) return null;
    if (!video?.width || !video?.height) return cloudinary.watermarkLandscape || null;
    return video.height > video.width
      ? (cloudinary.watermarkPortrait || cloudinary.watermarkLandscape || null)
      : (cloudinary.watermarkLandscape || cloudinary.watermarkPortrait || null);
  };

  return {
    cloudinary,
    contentService,
    /** Provider for new uploads, or null when none is configured. */
    uploadProvider: provider === CONTENT_SERVICE ? (contentService ? CONTENT_SERVICE : null) : (cloudinary ? 'cloudinary' : null),

    /** Watermarked preview a brand may watch. */
    previewUrl(video) {
      if (isContentService(video)) return video.preview_url ?? null;
      // Built from the video's own record; the client only supplies watermark ids.
      return previewUrl(mediaRef(video), undefined, watermarkFor(video));
    },
    thumbnailUrl(video) {
      if (isContentService(video)) return video.thumbnail_url ?? null;
      return thumbnailUrl(mediaRef(video), undefined, watermarkFor(video));
    },
    /** The reference signed into an offer's terms (content_url). Unchanged for Cloudinary videos. */
    offerContentUrl(video) {
      if (isContentService(video)) return video.preview_url ?? null;
      return previewUrl(mediaRef(video));
    },
    /** Owner-only reference to the original (Cloudinary only; content-service originals are reachable only through signed links). */
    ownerOriginalUrl(video) {
      if (isContentService(video)) return null;
      return cloudinary ? originalUrl(mediaRef(video)) : null;
    },
    /** Short-lived link that downloads the licensed original as a file. */
    async signedOriginalUrl(video, expiresAt, { filename } = {}) {
      if (isContentService(video)) {
        if (!contentService) return null;
        const ttlSeconds = Math.max(60, Math.min(3600, expiresAt - Math.floor(Date.now() / 1000)));
        return (await contentService.downloadUrl(video.public_id, { ttlSeconds, filename })).url;
      }
      return cloudinary ? cloudinary.signedOriginalUrl({ publicId: video.public_id, format: video.format }, expiresAt, { filename }) : null;
    },

    /**
     * Brings a content-service video's record up to date (processing -> ready
     * with the real file hash, dimensions and links). Returns the updated
     * record, or null when nothing changed or the provider is unreachable.
     */
    async refresh(video, now) {
      if (!isContentService(video) || video.status !== 'processing' || !contentService) return null;
      let asset;
      try { asset = await contentService.get(video.public_id, video.owner_public_key); } catch { return null; }
      const status = STATUS[asset.status] ?? 'processing';
      if (status === video.status) return null;
      if (status === 'failed') return { ...video, status, updated_at: now };
      return {
        ...video,
        status,
        format: EXTENSIONS[asset.format] ?? video.format,
        reference_sha256: asset.sha256,
        // The service hashed the actual bytes, so this is now a verified fingerprint.
        original_sha256: asset.sha256,
        bytes: asset.sizeBytes ?? video.bytes,
        duration_seconds: asset.durationSeconds === null || asset.durationSeconds === undefined ? null : Math.round(asset.durationSeconds),
        width: asset.width ?? null,
        height: asset.height ?? null,
        preview_url: asset.previewUrl,
        thumbnail_url: asset.thumbnailUrl,
        updated_at: now
      };
    },

    /** Removes a content-service asset when its video is deleted. Cloudinary assets are left as they were. */
    async remove(video) {
      if (isContentService(video) && contentService) await contentService.remove(video.public_id, video.owner_public_key);
    }
  };
}
