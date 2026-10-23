# API contract

The OpenAPI document is [openapi.json](openapi.json), generated from
[contract.js](../src/contracts/contract.js). The Postman collection is
[postman_collection.json](postman_collection.json); `npm run contracts`
regenerates both files. Interactive Swagger UI is served at `/docs/` and reads
the same OpenAPI document.

The contract describes routes that currently exist. Purchases are account-free
and have a purchase-specific status capability; no brand account is created.

## Access and authentication

| Method and path | Access | Notes |
| :--- | :--- | :--- |
| `GET /health/live` | Public | Process liveness only |
| `GET /health/ready` | Public | Checks database and required schema; returns `503` when unavailable |
| `GET /api/offers` | Public | Published offer discovery; response includes watermarked previews |
| `POST /api/offers` | Creator | Nostr HTTP authorization and `Idempotency-Key` required |
| `GET /api/offers/{id}` | Public or owning creator | Unpublished offers return `404` unless read by their creator |
| `POST /api/offers/{id}/publish` | Creator | Nostr authorization and `Idempotency-Key` required |
| `POST /api/offers/{id}/payment` | Public | Idempotent purchase initiation; requires `Idempotency-Key` and `X-Purchase-Token` |
| `GET /api/purchases/{id}/status` | Purchase capability | Requires the matching `X-Purchase-Token`; polls the NIP-57 receipt and license state |
| `GET /api/offers/{id}/status` | Public | Local Polar/regtest development status only |
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
  "lightning_address": "creator@wallet.example",
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

## Payment environment and trust boundary

Local development uses the existing Polar/regtest LND adapter and its existing
regression tests. Staging and production select the LNURL-pay/NIP-57 adapter
and require Bitcoin mainnet configuration; the application fails startup for
an inconsistent environment/network pair and does not silently fall back to
Polar. Mainnet payment enablement remains an explicit runtime setting.

For mainnet, the creator Lightning Address is included in the creator-signed
offer. Anza resolves it over HTTPS, snapshots the receiver `nostrPubkey` and
endpoint against a purchase, signs a purchase-scoped kind 9734 request, and
validates the returned BOLT11 invoice against network, exact amount, signature,
payment hash, expiry, and request description hash. It polls the relays named
by that Zap request for kind 9735 receipts and checks the receiver signature,
invoice, recipient, amount, request, and offer association. The buyer's wallet
does not need to send Anza a preimage.

A valid kind 9735 receipt signed by the receiver key is treated as the creator
payment service's attestation under the approved policy. The receipt signature
is **not independent proof that funds moved**; a matching preimage, if present,
also does not independently prove settlement. Missing or delayed receipts stay
pending and cannot issue a license. Lightning Address checks in staging and
production are manual-only, exactly 1 sat, and require separate explicit
approval for that environment. Automated tests never pay mainnet invoices.

Creators receive payments directly through their Lightning service. Anza does
not hold creator funds, maintain balances, or operate a payout service.

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
