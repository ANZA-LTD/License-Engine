# ANZA License-Engine Backend API Guide

## Getting Started

### Prerequisites
- Node.js 22+
- npm
- PostgreSQL
- Optional: Docker

### Local Setup
1. `cd backend && npm install`
2. Copy `.env.example` to `.env` and configure:
   - `DATABASE_URL`
   - `NOSTR_OFFER_KIND`
   - `NOSTR_ATTESTOR_PUBKEY`
   - `NOSTR_RELAYS`
   - Optional: `PORT`, `HOST`, `PUBLIC_ORIGIN`, `CORS_ORIGINS`
3. `npm run migrate`
4. `npm start`
5. `npm test`

## System Architecture

Node.js HTTP API + PostgreSQL + Nostr outbox worker.

**Flow:**
1. Client sends signed request.
2. Middleware validates Nostr kind 27235 auth.
3. Services enforce rules and persist.
4. Outbox publishes Nostr events.
5. Payments resolve via LNURL-pay + NIP-57 receipts.

## API Interaction & Authentication

### Authentication
Protected routes require:
```
Authorization: Nostr <base64 kind-27235 event>
```
Event tags:
- `u`: full request URL
- `method`: HTTP method
- POST: `payload` (SHA-256 body), `contentport-idempotency-key`

### Mandatory Headers
- `Idempotency-Key` (POST)
- `X-Purchase-Token` (purchase status/download grant)

### Backend-Only Testing
- Generate Nostr keypair and sign events
- Use fixed idempotency keys
- Use 64-hex purchase tokens

## API Documentation & Testing

### Swagger UI
- Staging: https://anza-staging-172765911669.africa-south1.run.app/docs
- Local: http://localhost:3000/docs
- OpenAPI: `/docs/openapi.json`

### Postman Collection
https://www.postman.com/galactic-escape-972188/anza/collection/g4eqixa/contentport-api

## Endpoints

### Health
- GET /health/live
- GET /health/ready

### Offers
- POST /api/offers
- GET /api/offers
- GET /api/offers/{id}
- POST /api/offers/{id}/publish
- POST /api/offers/{id}/payment
- GET /api/offers/{id}/status
- POST /api/offers/{id}/external-payment-attestation (service-to-service, `LE_ATTESTATION_SECRET`)

### Rates
- GET /api/rates/{currency} (public BTC price for a fiat currency)

### Purchases
- GET /api/purchases/{id}/status
- POST /api/purchases/{id}/download-grant (`X-Purchase-Token` for Lightning purchases, or an offer id with `X-External-Credential`)

### Downloads
- GET /api/downloads/{token}

### Videos (creator)
- POST /api/videos/upload-authorization
- POST /api/videos
- GET /api/videos
- GET /api/videos/{id}
- DELETE /api/videos/{id}

### Webhooks
- POST /api/webhooks/lightning
- POST /api/webhooks/speed/lightning

### Limits
- Per-address rate limits: 600 reads and 120 writes per minute per instance (HTTP 429 with `Retry-After`). Service-to-service routes are exempt.
- Download grants expire after one hour and allow five uses; buyers with a credential can request a fresh grant at any time.

## Rapid Troubleshooting
- Missing env: check required vars (production also requires `SWAGGER_UI_USERNAME`/`SWAGGER_UI_PASSWORD`)
- Auth failures: verify signed event URL/method
- DB errors: run migrations (`npm run migrate`; the deploy runs them as a job before the API)
- Cloudinary errors: verify secret/timestamp
- Payment pending: check receipt on relays
## Architecture

See the [architecture diagram](../README.md#architecture) in the main README.
