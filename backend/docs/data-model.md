# Day 1: data model

Status: mixed. Core offer schemas are executable in [schemas.js](../src/models/schemas.js); the account/acceptance records below remain proposed. Phase 4 adds the purchase-scoped NIP-57 records described here.

## Conventions

- Internal IDs are opaque strings; event IDs, public keys, and hashes are 64 lowercase hexadecimal characters.
- Dates are integer Unix seconds in UTC. Prices are positive integer satoshis; no floating-point money or implicit KES conversion.
- Required nullable fields use explicit `null`, not an omitted property. Unknown fields are rejected.
- License duration is either `{ "type": "fixed", "days": 30 }` or `{ "type": "perpetual" }`. A day is 86,400 seconds, starting at the accepted payment-evidence timestamp.
- One offer targets one brand and produces at most one license. Multiple brands need separate offers.

## Core records

| Schema | Purpose and relationships |
| :--- | :--- |
| Creator | Internal ID, unique Nostr public key, private wallet connection reference, creation time |
| Terms | Brand name, signed creator Lightning Address, public HTTPS content reference, SHA-256 of the referenced asset bytes, integer price, permitted uses, duration |
| Offer | Creator public key, immutable terms once publication starts, state, signed offer event ID, creation time |
| Acceptance | Exact offer event ID, affirmative acceptance, and licensee's self-declared name |
| Zap purchase | Offer/event ID, creator/address snapshot, amount/network, signed kind 9734 request, receiver key, invoice/payment hash, hashed buyer capability, receipt state and kind 9735 evidence |
| License | Offer and payment references, license dates, independently tracked publication state and event ID |
| Payment evidence | A receiver-key-signed kind 9735 receipt checked against the stored request, invoice, creator, offer and amount; the receipt is not independent proof that funds moved |

These JSON Schemas define field shapes. Database constraints and the cross-record rules below still need implementation. `SignedEvent` validates structure only, not a signature.

## Private persistence records to implement

Store acceptance with `buyer_id`, server-recorded `accepted_at`, `offer_event_id`, and the submitted licensee name. This is an acknowledgement from an account, not proof of authority to represent a brand. Link each payment to that buyer and acceptance; do not expose those private fields in the public offer.

Store wallet connection credentials encrypted outside public records; the creator record holds only a reference. Do not store creator Nostr private keys. Retain verified settlement evidence privately, including provider reference and observation time. Keep the exact signed event bytes in a publication outbox with retry count, next attempt, and relay acknowledgements.

For the database phase: unique creator public key, unique payment hash, unique license offer ID and payment ID, and unique outbox event ID. Foreign keys bind payments and licenses to offers, and acceptances to buyer accounts. Persist idempotency records under authenticated account + method + path + key, with a request digest and saved response.

## State and consistency rules

```text
Offer:       draft → publishing → published → licensing → licensed
Zap purchase: creating → pending → verified (approved receiver-attestation policy)
             creating → failed
Publication: pending → published
```

Offer `event_id` is null in draft and set when a verified signed event enters the outbox. Only mark an offer published after at least one configured relay acknowledges it. Retry the same signed event after relay failure. Published records cannot be silently edited; new terms require a new offer.

Creating a Zap purchase requires a published offer and no other active purchase. A transaction/advisory lock enforces that condition under concurrent requests. Reuse the existing purchase invoice for an idempotent retry; reject conflicting requests. The invoice amount and destination are derived from the signed offer and snapshotted LNURL-pay endpoint, never the buyer's request.

The receiver receipt must match the stored request, invoice, recipient, amount, and offer. If it passes the approved policy, atomically mark the purchase verified, mark the offer as licensing, create one license attestation, and queue its event. This means Anza accepted the creator payment service's signed claim; it does not independently prove Lightning settlement. Missing or delayed receipts remain pending and cannot issue a license. Publication failure leaves the purchase attested and license publication pending.

Late settlement of an expired invoice must be reconciled, not discarded. If a different invoice has already licensed the offer, record the additional settlement and raise a manual duplicate-payment resolution; never create a second license automatically. Cancellation/refund policy is a later product decision.

## Public versus private

Public: signed offer terms, creator public key, designated Anza attestor key, and licensing attestation. A content URL must be an intentional public preview/reference, not a signed private download URL. The hash binds the referenced bytes but does not establish authorship. Public offer reads omit the raw invoice and payment hash.

Private: buyer identity, acceptance audit details, wallet credentials, raw invoices, provider payloads, and payment preimages. Public attestations may include a payment hash and receipt event reference, but those fields alone prove neither payment nor payer identity. The Anza attestor verifies the approved receipt policy and license association; its signature is not independent proof that funds moved.

## Extended Day 1 schemas

See the [media, order, Lightning receipt and download schemas](extended-data-model.md) for the new definitions, validation rules, and remaining persistence/API work.
