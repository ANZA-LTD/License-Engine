// Client for an external content service that stores videos and produces
// watermarked previews (an alternative to Cloudinary). The service is internal:
// only this engine calls it. Contract (JSON):
//
//   POST   /v1/uploads                  { ownerPubkey, filename, contentType, sizeBytes, origin }
//                                        -> { asset, upload: { protocol: 'gcs-resumable', url, chunkBytes, maxBytes } }
//   POST   /v1/assets/:id/complete      { ownerPubkey } -> asset
//   GET    /v1/assets/:id[?owner=hex]   -> asset
//   POST   /v1/assets/:id/download-url  { ttlSeconds, filename } -> { url, expiresAt }
//   DELETE /v1/assets/:id?owner=hex     -> { id, deleted }
//
// asset = { id, status: uploading|processing|ready|failed, sha256, format,
//           durationSeconds, width, height, sizeBytes, previewUrl, thumbnailUrl, failureReason }
//
// Authentication: a Google-signed ID token for the service URL (Cloud Run
// service-to-service), or locally an HMAC over timestamp, method, path and body.
import { createHash, createHmac } from 'node:crypto';
import { HttpError } from '../../utils/errors.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function metadataIdToken(audience) {
  const response = await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`, {
    headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error('Could not obtain an identity token.');
  return response.text();
}

export function createContentServiceClient({ baseUrl, auth, hmacSecret }, { fetchImpl = fetch, idToken = metadataIdToken, now = () => Math.floor(Date.now() / 1000) } = {}) {
  async function call(method, path, payload) {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const headers = { 'Content-Type': 'application/json' };
    if (auth === 'google') {
      headers.Authorization = `Bearer ${await idToken(baseUrl)}`;
    } else {
      const ts = String(now());
      headers['x-cs-timestamp'] = ts;
      headers['x-cs-signature'] = createHmac('sha256', hmacSecret).update(`${ts}.${method}.${path}.${sha256(body)}`).digest('hex');
    }
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, { method, headers, body: body || undefined, signal: AbortSignal.timeout(20000) });
    } catch {
      throw new HttpError(503, 'MEDIA_UNAVAILABLE', 'The media service is unavailable. Please try again.');
    }
    let json = null;
    try { json = await response.json(); } catch { /* empty body */ }
    if (!response.ok) {
      // Client errors carry a message safe to show the creator; server errors do not.
      if (response.status >= 400 && response.status < 500) {
        throw new HttpError(response.status === 401 ? 503 : response.status, json?.error?.code || 'MEDIA_ERROR', json?.error?.message || 'The media request was rejected.');
      }
      throw new HttpError(503, 'MEDIA_UNAVAILABLE', 'The media service is unavailable. Please try again.');
    }
    return json;
  }
  const id = (assetId) => encodeURIComponent(assetId);
  return {
    name: 'content-service',
    createUpload: (input) => call('POST', '/v1/uploads', input),
    complete: (assetId, ownerPubkey) => call('POST', `/v1/assets/${id(assetId)}/complete`, { ownerPubkey }),
    get: (assetId, ownerPubkey) => call('GET', `/v1/assets/${id(assetId)}${ownerPubkey ? `?owner=${ownerPubkey}` : ''}`),
    downloadUrl: (assetId, { ttlSeconds, filename }) => call('POST', `/v1/assets/${id(assetId)}/download-url`, { ttlSeconds, filename }),
    remove: (assetId, ownerPubkey) => call('DELETE', `/v1/assets/${id(assetId)}?owner=${ownerPubkey}`)
  };
}
