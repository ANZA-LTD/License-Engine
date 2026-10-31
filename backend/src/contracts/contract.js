import { schemas } from '../models/schemas.js';

const ref = name => ({ $ref: `#/components/schemas/${name}` });
const json = schema => ({ 'application/json': { schema } });
const response = (description, schema) => ({ description, content: json(ref(schema)) });
const request = (schema, example) => ({ required: true, content: { 'application/json': { schema: ref(schema), example } } });
const auth = [{ nostrAuth: [] }];
const optionalAuth = [{}, ...auth];
const id = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' };
const hex = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const positive = { ...integer, minimum: 1 };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false
});
const pathId = { name: 'id', in: 'path', required: true, schema: id };
const idempotencyKey = { name: 'Idempotency-Key', in: 'header', required: true,
  schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,128}$' } };
const optionalIdempotencyKey = { ...idempotencyKey, required: false,
  description: 'Required only when optional Nostr authorization is supplied.' };
const errors = Object.fromEntries([
  ['400', 'Invalid request'], ['401', 'Authentication required'], ['403', 'Not permitted'],
  ['404', 'Resource not found'], ['409', 'State or idempotency conflict'],
  ['413', 'Request exceeds 64 KiB'], ['415', 'Use application/json'],
  ['501', 'Feature or dependency not configured'], ['502', 'Invalid provider response'],
  ['503', 'Dependency unavailable']
].map(([status, description]) => [status, response(description, 'Error')]));

const paymentProgress = object({
  provider: { type: 'string' }, invoice_id: { type: 'string' }, payment_hash: hex,
  request: { type: 'string' }, amount_sats: positive, status: { type: 'string', enum: ['pending', 'settled', 'attested'] },
  reference: { type: 'string' }, expires_at: { anyOf: [{ type: 'string' }, integer] },
  settled_at: integer
}, ['provider', 'invoice_id', 'payment_hash', 'request', 'amount_sats', 'status', 'reference']);

const offerResponse = object({
  id, creator_pubkey: hex, terms: ref('Terms'),
  status: { type: 'string', enum: ['draft', 'publishing', 'published', 'licensing', 'licensed'] },
  event_id: nullable(hex), created_at: integer, video_id: id, payment: paymentProgress,
  license_event_id: hex, licensed_at: integer
}, ['id', 'creator_pubkey', 'terms', 'status', 'event_id', 'created_at']);
const offerDraft = {
  ...schemas.OfferDraft,
  oneOf: [
    { required: ['content_url', 'content_sha256'], not: { required: ['video_id'] } },
    { required: ['video_id'] }
  ]
};

const paymentRequestResponse = object({
  offerId: id, purchaseId: id, amountSats: positive, paymentRequest: { type: 'string', minLength: 1 }
}, ['offerId', 'amountSats', 'paymentRequest']);
const purchaseStatusResponse = object({
  purchaseId: id,
  status: { type: 'string', enum: ['PAYMENT_PENDING', 'PAYMENT_ATTESTED', 'LICENSED', 'EXPIRED'] },
  receiptState: { type: 'string', enum: ['awaiting_receipt', 'verified'] },
  licenseNostrEventId: hex, licensedAt: integer,
  downloadGrantToken: hex, downloadGrantExpiresAt: integer
}, ['purchaseId', 'status', 'receiptState']);
const paymentStatusResponse = object({
  offerId: id,
  status: { type: 'string', enum: ['OPEN', 'PAYMENT_PENDING', 'PAYMENT_ATTESTED', 'PAYMENT_SETTLED', 'LICENSED'] },
  paymentSettledAt: integer, licensedAt: integer, licenseNostrEventId: hex
}, ['offerId', 'status']);
const webhookResponse = object({
  received: { const: true }, provider: { type: 'string' },
  eventType: { type: 'string' }, offerId: nullable(id)
});
const healthAlive = object({ status: { const: 'alive' } });
const healthReady = object({ status: { const: 'ready' } });
const healthNotReady = object({ status: { const: 'not_ready' }, error: { type: 'string' } });

const createOfferExample = {
  brand: 'Example Brand',
  lightning_address: 'creator@example.org',
  content_url: 'https://example.com/watermarked-preview.mp4',
  content_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  amount_sats: 25000,
  usage_rights: 'Non-exclusive organic social use; no paid advertising.',
  duration: { type: 'fixed', days: 30 }
};
const signedEventExample = {
  id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  pubkey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  created_at: 1700000000, kind: 9998, tags: [['t', 'contentport-offer-v1']],
  content: '{"schema":"contentport.offer.v1","terms":{}}',
  sig: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
};

export const contract = {
  openapi: '3.1.0',
  info: {
    title: 'ContentPort API',
    version: '0.4.0',
    description: 'Implements creator offers, local Polar/regtest payments in development, and purchase-scoped LNURL-pay/NIP-57 receipts in staging and production. A receiver-signed Zap receipt is the creator payment service’s attestation, not independent proof that funds moved.'
  },
  servers: [{ url: '/', description: 'Same origin as the API server; paths include /api where applicable.' }],
  components: {
    schemas: {
      Error: schemas.Error,
      Terms: schemas.Terms,
      OfferDraft: offerDraft,
      Offer: offerResponse,
      SignedEvent: schemas.SignedEvent,
      EmptyObject: object({}),
      Discovery: schemas.Discovery,
      VideoRegistration: schemas.VideoRegistration,
      OwnedVideo: schemas.OwnedVideo,
      OwnedVideoLibrary: schemas.OwnedVideoLibrary,
      UploadAuthorization: schemas.UploadAuthorization,
      DeletedVideo: schemas.DeletedVideo,
      PaymentRequest: paymentRequestResponse,
      PaymentStatus: paymentStatusResponse,
      PurchaseStatus: purchaseStatusResponse,
      WebhookReceipt: webhookResponse,
      HealthAlive: healthAlive,
      HealthReady: healthReady,
      HealthNotReady: healthNotReady
    },
    securitySchemes: {
      nostrAuth: {
        type: 'apiKey', in: 'header', name: 'Authorization',
        description: 'Nostr <base64 signed NIP-98 event>. Protected POST requests also require Idempotency-Key and bind the raw body hash and key in the signed event.'
      },
      speedWebhookSignature: {
        type: 'apiKey', in: 'header', name: 'webhook-signature',
        description: 'Speed webhook HMAC signature. The server currently does not load a Speed webhook secret, so these routes reject callbacks until that integration is configured.'
      }
    }
  },
  paths: {
    '/health/live': {
      get: {
        tags: ['Health'], operationId: 'getLiveness', summary: 'Check that the process responds',
        responses: { '200': response('Process is alive', 'HealthAlive') }
      }
    },
    '/health/ready': {
      get: {
        tags: ['Health'], operationId: 'getReadiness', summary: 'Check required database tables and connectivity',
        responses: {
          '200': response('Database and required schema are available', 'HealthReady'),
          '503': response('Database or required schema is unavailable', 'HealthNotReady')
        }
      }
    },
    '/api/offers': {
      get: {
        tags: ['Offers'], operationId: 'discoverOffers', summary: 'List published offers for brand discovery',
        security: optionalAuth, responses: { ...errors, '200': response('Discoverable offers with watermarked previews', 'Discovery') }
      },
      post: {
        tags: ['Offers'], operationId: 'createOffer', summary: 'Create a creator-owned draft offer',
        description: 'Requires creator Nostr HTTP authorization. Without video_id, provide content_url and content_sha256. With video_id, the video must be owned and ready; the server resolves the canonical media reference and ignores client-supplied content_url or content_sha256.',
        security: auth, parameters: [idempotencyKey], requestBody: request('OfferDraft', createOfferExample),
        responses: { ...errors, '201': response('Draft created', 'Offer') }
      }
    },
    '/api/offers/{id}': {
      parameters: [pathId],
      get: {
        tags: ['Offers'], operationId: 'getOffer', summary: 'Read an offer; private drafts require creator authorization',
        security: optionalAuth, responses: { ...errors, '200': response('Offer details', 'Offer') }
      }
    },
    '/api/offers/{id}/publish': {
      parameters: [pathId],
      post: {
        tags: ['Offers'], operationId: 'publishOffer', summary: 'Validate and queue the exact creator-signed offer',
        security: auth, parameters: [idempotencyKey], requestBody: request('SignedEvent', signedEventExample),
        responses: { ...errors, '202': response('Publication queued', 'Offer') }
      }
    },
    '/api/offers/{id}/payment': {
      parameters: [pathId],
      post: {
        tags: ['Payments'], operationId: 'createPaymentRequest',
        summary: 'Create a purchase-specific Lightning invoice for a published offer',
        description: 'Uses Polar/LND only for local development. Staging and production resolve the Lightning Address signed into the offer, construct a NIP-57 kind 9734 Zap request, and request an invoice directly from the creator’s LNURL-pay service. A receiver-signed kind 9735 receipt is the creator payment service’s attestation, not independent proof that funds moved. Brands do not need Anza accounts.',
        security: [],
        parameters: [
          idempotencyKey,
          { name: 'X-Purchase-Token', in: 'header', required: true, schema: hex,
            description: 'Random purchase capability. Keep it private and send it to the matching purchase status endpoint.' }
        ],
        requestBody: request('EmptyObject', {}),
        responses: {
          ...errors,
          '200': response('Existing idempotent purchase invoice returned', 'PaymentRequest'),
          '201': response('Purchase and Lightning invoice created', 'PaymentRequest')
        }
      }
    },
    '/api/offers/{id}/status': {
      parameters: [pathId],
      get: {
        tags: ['Development payment'], operationId: 'getDevelopmentPaymentStatus',
        summary: 'Read current offer and local LND payment status',
        description: 'Local Polar/regtest legacy status endpoint. Staging and production use the purchase-specific NIP-57 status endpoint.',
        'x-availability': 'development-only',
        security: optionalAuth, responses: { ...errors, '200': response('Current payment and license publication summary', 'PaymentStatus') }
      }
    },
    '/api/purchases/{id}/status': {
      parameters: [pathId, {
        name: 'X-Purchase-Token', in: 'header', required: true, schema: hex,
        description: 'The purchase capability returned by the browser session when the invoice was created.'
      }],
      get: {
        tags: ['Payments'], operationId: 'getPurchaseStatus',
        summary: 'Poll the purchase-specific NIP-57 receipt and license state',
        description: 'The server retrieves kind 9735 receipts from the relays listed in the stored Zap request and validates them against the signed offer, creator receiver key, exact amount, invoice, and purchase. A matching receiver-signed receipt is an attestation from that creator payment service, not independent proof that funds moved. Missing or delayed receipts remain pending.',
        security: [], responses: { ...errors, '200': response('Purchase receipt and license state', 'PurchaseStatus') }
      }
    },
    '/api/webhooks/lightning': {
      post: {
        tags: ['Webhooks'], operationId: 'receiveLegacyLightningWebhook',
        summary: 'Legacy Speed webhook alias (unavailable until secret configuration is implemented)',
        description: 'The route validates Speed HMAC headers, but the current runtime does not load a webhook secret; callbacks cannot authenticate and must not be treated as settlement evidence.',
        'x-availability': 'unavailable',
        security: [{ speedWebhookSignature: [] }],
        parameters: [
          { name: 'webhook-id', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'webhook-timestamp', in: 'header', required: true, schema: { type: 'string' } }
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
        responses: { ...errors, '200': response('Webhook receipt recorded', 'WebhookReceipt') }
      }
    },
    '/api/webhooks/speed/lightning': {
      post: {
        tags: ['Webhooks'], operationId: 'receiveSpeedLightningWebhook',
        summary: 'Legacy Speed webhook (unavailable until secret configuration is implemented)',
        description: 'Alias of POST /api/webhooks/lightning. The current runtime does not load a webhook secret, so callbacks cannot authenticate.',
        'x-availability': 'unavailable',
        security: [{ speedWebhookSignature: [] }],
        parameters: [
          { name: 'webhook-id', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'webhook-timestamp', in: 'header', required: true, schema: { type: 'string' } }
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
        responses: { ...errors, '200': response('Webhook receipt recorded', 'WebhookReceipt') }
      }
    },
    '/api/videos': {
      get: {
        tags: ['Creator videos'], operationId: 'listMyVideos', summary: 'List the authenticated creator’s videos and offer relationships',
        security: auth, responses: { ...errors, '200': response('Creator video library', 'OwnedVideoLibrary') }
      },
      post: {
        tags: ['Creator videos'], operationId: 'registerVideo', summary: 'Register a Cloudinary upload',
        description: 'Ownership comes from the authenticated Nostr public key. The upload must use a valid server-issued upload session.',
        security: auth, parameters: [idempotencyKey], requestBody: request('VideoRegistration', {
          title: 'Example video', upload_session_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          public_id: 'contentport/videos/example', asset_version: 1, resource_type: 'video',
          format: 'mp4', context: 'contentport_session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          status: 'ready', original_sha256: null, bytes: 4096,
          duration_seconds: 30, width: 1920, height: 1080
        }),
        responses: { ...errors, '201': response('Video registered', 'OwnedVideo') }
      }
    },
    '/api/videos/upload-authorization': {
      post: {
        tags: ['Creator videos'], operationId: 'authorizeVideoUpload',
        summary: 'Sign Cloudinary parameters for one direct browser upload',
        security: auth, parameters: [idempotencyKey],
        responses: { ...errors, '201': response('Signed upload parameters; the API secret is not returned', 'UploadAuthorization') }
      }
    },
    '/api/videos/{id}': {
      parameters: [pathId],
      get: {
        tags: ['Creator videos'], operationId: 'getMyVideo', summary: 'Read one video owned by the authenticated creator',
        security: auth, responses: { ...errors, '200': response('Owned video and related offers', 'OwnedVideo') }
      },
      delete: {
        tags: ['Creator videos'], operationId: 'deleteMyVideo', summary: 'Delete an owned video that no offer references',
        security: auth, responses: { ...errors, '200': response('Video deleted', 'DeletedVideo') }
      }
    }
  }
};
