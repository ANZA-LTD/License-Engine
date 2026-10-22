# Day 2: offer API and Nostr publication

## Implemented flow

1. Creator signs HTTP authorization with their Nostr signer.
2. `POST /api/offers` validates Terms and stores a draft in PostgreSQL. Creator identity comes from the verified authorization key.
3. Creator builds and signs the offer using the configured kind and attestor key, matching the saved terms and `contentport-offer-v1` tag.
4. `POST /api/offers/{id}/publish` verifies the signature, event ID, ownership, terms, and timestamp. A database transaction queues the exact event and changes the offer to `publishing`.
5. The worker sends the event to configured relays. After one matching positive acknowledgement, it marks the offer `published`. Failure leaves it queued with exponential retry delay, capped at five minutes.
6. `GET /api/offers/{id}` returns the offer. Draft/publishing offers require owner authentication; published offers are public.

POST retries use a persistent idempotency record. Reusing a key with different raw JSON returns `409`; replaying the same request returns its original response. Poll GET for current status. Different publish keys cannot attach a second event to the same offer. The database and outbox survive server restarts.

## Local setup

Use Node.js 22 or newer and install the versions in the lockfile:

```bash
cd backend
npm ci
cp .env.example .env
```

Start the local PostgreSQL database with `docker compose up -d --wait postgres` from the repository root; see the [local database guide](local-database.md). The example `DATABASE_URL` matches that local service. The Nostr offer kind, attestor public key, and relay in `.env.example` are local placeholders; choose development values before using the API. Never use those sample values for production.

```bash
npm run migrate
npm start
```

`npm run migrate` records applied SQL migration checksums and is safe to run again without reapplying unchanged migrations. The server loads `.env` only if present, defaults to loopback locally, and uses the hosting platform's `PORT` and all-interface bind on Cloud Run. Set `PUBLIC_ORIGIN` to the externally visible API origin so signed request URLs match exactly. Configure `CORS_ORIGINS` with exact HTTPS frontend origins when cross-origin browser access is needed; localhost HTTP origins are allowed for development.

`GET /health/live` checks process liveness; `GET /health/ready` checks database connectivity and required tables. In production, configure `SWAGGER_UI_USERNAME` and `SWAGGER_UI_PASSWORD` from a secret manager; `/docs/` uses HTTP Basic authentication and only permits read operations.

## Authentication for frontend integration

Day 2 replaces the provisional bearer-session design with signed Nostr HTTP authorization. For every protected request, build an event with kind `27235`, current Unix time, empty content, and these tags:

```text
["u", "http://localhost:3000/api/offers"]
["method", "POST"]
["payload", "<SHA-256 of the exact UTF-8 request body bytes>"]
["contentport-idempotency-key", "<same value as Idempotency-Key header>"]
```

Sign with the creator's signer and send `Authorization: Nostr <base64 of the signed event JSON>`. POST also requires `Content-Type: application/json` and a 16–128 character `Idempotency-Key` containing letters, numbers, underscores, or hyphens. The custom idempotency tag binds that header to the signature so intercepted authorization cannot create extra drafts by changing the key. This tag is a ContentPort extension, not a NIP-98 standard field.

GET authorization needs only `u` and `method`. Authorization events must be within 60 seconds of server time. Sign a fresh authorization event for later retries while retaining the same body and idempotency key. No private key is sent to the API.

Offer event templates can be built using `buildOfferEvent` from `src/services/nostr/events.js`. Sign the returned template client-side and send the full event as the publish request body. Its initial submission must be within five minutes of server time. Retried queued events retain their original timestamp and signature.

## Current validation and limits

Unit tests cover creation, private reads, idempotency, signature-verifier rejection, ownership, offer immutability, request binding, and positive/negative/timeout relay acknowledgements using test doubles. PostgreSQL integration tests require an explicitly provided disposable `TEST_DATABASE_URL`; they create and remove a unique schema, so never point that variable at production.

The current singular `/api/offers/{id}/payment` and `/status` routes exercise the local LND development adapter only; they are not the approved creator Lightning Address production flow. The Speed webhook aliases are unavailable because a webhook secret is not wired through runtime configuration. No live production payment or deployment is performed by this guide. Settlement-proof PoC, account-free buyer recovery, and production rollout remain gated by the implementation plan.

Protocol references: [NIP-01 event and relay protocol](https://github.com/nostr-protocol/nips/blob/master/01.md), [NIP-98 HTTP authorization](https://github.com/nostr-protocol/nips/blob/master/98.md), and [nostr-tools](https://github.com/nbd-wtf/nostr-tools).
