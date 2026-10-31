# Day 1: Nostr event design

Status: Phase 4 implementation in progress. These are application-specific experimental payloads, not a standardized licensing NIP. Builders return unsigned templates; they perform no network calls. No mainnet payment or staging deployment has been performed.

## Envelope and kind choice

Use the Nostr event fields `pubkey`, `created_at`, `kind`, `tags`, and string `content`; signing adds `id` and `sig`. Cross-event references use `e` tags and creator references use `p` tags. The design follows [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md).

Both kinds must be separately configured from the regular-event range 1000–9999 after checking the current kind registry for collisions. There is deliberately no production default. Test fixtures use arbitrary kind numbers only. ContentPort clients must check the configured kind AND payload schema AND signature; a hashtag alone is not authentication.

We avoid replaceable application storage for this record chain: [NIP-78](https://github.com/nostr-protocol/nips/blob/master/78.md) uses kind 30078, where later data can replace an earlier version. Regular events fit the intended historical record better, but relay retention is still not guaranteed.

## Offer: creator signed

`buildOfferEvent` accepts creator key, designated attestor key, Terms, kind, and Unix creation time. It returns tags `[["t", "contentport-offer-v1"]]` and JSON-stringified content:

```text
{
  schema: "contentport.offer.v1",
  terms: <Terms from the shared schema>,
  attestor_pubkey: <Anza license attestor public key>
}
```

The creator signs the complete template using their own signer. The backend validates the signature and exact terms before queuing it. New offers include the creator's Lightning Address in `terms`; the signature makes that destination immutable for the offer. It does not prove who controls the receiving wallet. Address ownership must be checked during the separately approved manual staging test.

## License: service attestation

For a mainnet purchase, Anza creates a purchase-scoped ephemeral Nostr identity and signs a NIP-57 kind `9734` Zap request for the creator receiver key, exact amount, offer event, and configured relays. The Lightning Address/LNURL-pay service returns a BOLT11 invoice whose description hash commits to that request. The invoice is a request for payment, not evidence of settlement. After payment, the receiver may publish a NIP-57 kind `9735` receipt to relays.

Anza retrieves candidate receipts from the relays named in the Zap request and validates the signature against the receiver key advertised by the HTTPS-discovered LNURL-pay endpoint. It also validates the embedded Zap request, creator recipient, offer event, exact amount, invoice, and purchase association. If present, a preimage is checked against the invoice payment hash, but its presence alone is not proof that payment occurred.

**Trust boundary:** under the approved policy, a valid kind `9735` receipt signed by the expected receiver key is accepted as the creator payment service's attestation. It is not independent proof that funds moved. NIP-57 does not guarantee every Lightning Address provider issues receipts, and relays only provide event discovery/transport; they do not prove the receipt's payment claim.

Only after that policy accepts a receipt does Anza sign and queue one license event. Content includes `schema: "contentport.license.v1"`, `offer_event_id`, `payment_hash`, `amount_sats`, `starts_at`, `ends_at`, `purchase_id`, `zap_receipt_event_id`, `receiver_pubkey`, `payment_network`, and `evidence_type: "contentport-nip57-provider-attestation"`. Fixed terms start at the receipt timestamp; perpetual terms have no end. The Anza attestor signature means Anza applied its verification policy and issued the license; it is **not independent proof that funds moved**.

## Verification and publication requirements

The API verifies creator event signatures, configured kinds, payload versions, and timestamps. The receiver receipt is independently signature-checked and purchase-bound before license issuance. Builders deliberately accept no private keys; signing happens in the service. Store each finished signed event once and retry those same bytes and ID. The database transaction ties the verified purchase, offer license state, and outbox event together.

The public license record omits the invoice, preimage, buyer contact details, and wallet connection secrets. It carries payment and receipt event references so an independent reader can inspect the signed claims. A signed timestamp is author-supplied; neither timestamp nor relay acknowledgement guarantees permanent storage, real-world identity, or brand acceptance. A public offer read omits the raw purchase invoice and payment hash.

Wallet of Satoshi's ability to receive Anza Zap requests and publish discoverable receipts remains unverified; it is optional, and no creator wallet change is required without evidence. Any real staging or production compatibility test is manual, exactly 1 sat, and requires separate explicit approval for that environment. Automated tests never send mainnet payments.

Protocol sources checked on 2026-09-27. Final kind selection and relay interoperability remain implementation prerequisites.
