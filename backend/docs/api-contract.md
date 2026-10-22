# API contract

The OpenAPI document is [openapi.json](openapi.json), generated from
[contract.js](../src/contracts/contract.js). The Postman collection is
[postman_collection.json](postman_collection.json); `npm run contracts`
regenerates both files. Interactive Swagger UI is served at `/docs/` and reads
the same OpenAPI document.

The contract describes routes that currently exist. It does not claim the
planned plural `/api/offers/{id}/payments` or `/api/payments/{id}` routes exist.
The singular offer payment/status routes are a local LND development path,
not the selected production Lightning Address model.

## Access and authentication

| Method and path | Access | Notes |
| :--- | :--- | :--- |
| `GET /health/live` | Public | Process liveness only |
| `GET /health/ready` | Public | Checks database and required schema; returns `503` when unavailable |
| `GET /api/offers` | Public | Published offer discovery; response includes watermarked previews |
| `POST /api/offers` | Creator | Nostr HTTP authorization and `Idempotency-Key` required |
| `GET /api/offers/{id}` | Public or owning creator | Unpublished offers return `404` unless read by their creator |
| `POST /api/offers/{id}/publish` | Creator | Nostr authorization and `Idempotency-Key` required |
| `POST /api/offers/{id}/payment` | Public | Development-only local LND invoice route; do not use for production |
| `GET /api/offers/{id}/status` | Public | Development-only status polling; client output is not independent payment proof |
| `POST /api/webhooks/lightning` | Signed provider callback | Currently unavailable: the runtime does not load a Speed webhook secret |
| `POST /api/webhooks/speed/lightning` | Signed provider callback | Legacy alias; currently unavailable for the same missing-secret configuration |
| `GET /api/videos` | Creator | Returns only the authenticated creator's library |
| `POST /api/videos` | Creator | Registers a Cloudinary upload; requires `Idempotency-Key` |
| `POST /api/videos/upload-authorization` | Creator | Signs one upload; requires `Idempotency-Key` |
| `GET /api/videos/{id}` | Owning creator | Returns the owner-only video projection |
| `DELETE /api/videos/{id}` | Owning creator | Refuses deletion while an offer references the video |

Creator requests use `Authorization: Nostr <base64 signed event>`. The signed
NIP-98 event binds the exact URL and HTTP method; protected POST requests also
bind the SHA-256 digest of the exact UTF-8 request body and the
`contentport-idempotency-key` tag to the matching header. POST requests that
require creator authentication need `Content-Type: application/json` when a
body is sent and an `Idempotency-Key` of 16–128 letters, numbers, underscores,
or hyphens. Public routes remain account-free; if a caller voluntarily sends
Nostr authorization, it must be valid.

The Speed webhook routes expect `webhook-id`, `webhook-timestamp`, and
`webhook-signature`, but the current production configuration has no Speed
secret setting, so they reject callbacks. Even after configuration is added,
webhook receipt alone is not proof of settlement.

In `NODE_ENV=production`, `/docs/`, its assets, and `/docs/openapi.json` require
HTTP Basic authentication using `SWAGGER_UI_USERNAME` and
`SWAGGER_UI_PASSWORD`. Supply those values from a secret manager over HTTPS.
Production Swagger UI disables write operations; this does not change the
public API's own access rules. In development, docs are open unless those
credentials are configured.

## Offer creation

For a direct media reference, include `content_url` and `content_sha256`:

```json
{
  "brand": "Example Brand",
  "content_url": "https://example.com/watermarked-preview.mp4",
  "content_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "amount_sats": 25000,
  "usage_rights": "Non-exclusive organic social use; no paid advertising.",
  "duration": { "type": "fixed", "days": 30 }
}
```

Alternatively, provide an owned, ready `video_id`. The server resolves the
canonical preview reference and fingerprint from the creator's video record;
client-supplied media reference fields are ignored for video-backed offers.
The creator signs the resulting offer before submitting it to the publish
route.

## Current development payment limitation

The current singular `/payment` route requests an invoice from the single
configured local LND node; `/status` polls that same node. Neither route
resolves a creator Lightning Address, binds an independent recipient account,
nor accepts buyer preimage evidence. A public status response or Anza
attestor signature must not be described as independent proof that funds moved.
The intended LNURL-pay production flow remains gated on the settlement and
wallet-compatibility proof of concept.

## Errors

Errors use the following JSON shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request." } }
```

Relevant statuses include `400` validation, `401` authentication,
`403` authorization, `404` missing/private resource, `409` state or
idempotency conflict, `413` request larger than 64 KiB, `415` unsupported
content type, `501` unavailable feature, `502` invalid provider response, and
`503` dependency outage.
