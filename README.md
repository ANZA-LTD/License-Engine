<div align="center">

# ANZA

### Creator-owned licensing offers, verifiable on Nostr and payable over Lightning.

[![MVP](https://img.shields.io/badge/status-MVP-16A34A?style=for-the-badge)](#what-works-today)
[![Nostr](https://img.shields.io/badge/Nostr-signed%20offers-7C3AED?style=for-the-badge)](#verifiable-offers)
[![Lightning](https://img.shields.io/badge/Lightning-regtest%20payments-F59E0B?style=for-the-badge)](#lightning-demo)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](#local-development)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](#architecture)

**Your content. Your terms. A record that does not live only in a chat thread.**

</div>

> [!IMPORTANT]
> ANZA is an open-source MVP built for creators who need a clearer way to offer branded content, set licensing terms, and keep independently verifiable evidence of what they offered.

## The problem

UGC creators in Kenya often agree to brand work through WhatsApp, Instagram DMs, or verbal conversations. The price, usage rights, duration, and payment expectation are fragmented across private messages. If a brand goes silent or an intermediary withholds payment, the creator may have no durable record of the original offer.

Creators also spend too much time waiting to be discovered. ANZA gives them a way to make a specific, priced licensing offer first and share it directly with the intended brand.

## The solution

ANZA turns a creator's offer into a shareable, signed record:

1. A creator uploads a video, then enters the target brand, price (in sats, or in a local currency such as KES with a live sats equivalent), rights, and duration.
2. The creator signs the offer in their browser with a NIP-07 Nostr signer, or with an optional signer provider plugged in by the operator.
3. ANZA verifies the signature, stores workflow state in PostgreSQL, and publishes the signed offer to configured Nostr relays.
4. The creator shares the public offer link with a brand.
5. The brand starts an account-free purchase. For staging and production, ANZA resolves the Lightning Address fixed in the creator-signed offer, sends a NIP-57 Zap request, and returns an invoice from the creator's Lightning service.
6. The creator receives payment directly through that service. ANZA looks up the matching NIP-57 receipt on relays and issues a license only after the receipt passes the configured verification policy.

```mermaid
flowchart LR
    C[Creator] -->|Sets price & license terms| F[ANZA offer form]
    F -->|Creator signature| A[Node.js API]
    A -->|Persist workflow state| P[(PostgreSQL)]
    A -->|Offer and Zap receipt events| N[Nostr relays]
    F -->|Share link| B[Brand]
    B -->|Pay invoice| L[Creator LNURL-pay service]
    L -->|Creator receives funds| W[Creator Lightning wallet]
    L -->|Signed kind 9735 receipt| N
    N -->|Receipt lookup and validation| A
    A -->|Purchase and license state| O[Buyer status]

    style C fill:#ede9fe,stroke:#7c3aed,color:#111827
    style F fill:#dbeafe,stroke:#2563eb,color:#111827
    style A fill:#dcfce7,stroke:#16a34a,color:#111827
    style P fill:#e0f2fe,stroke:#0284c7,color:#111827
    style N fill:#f3e8ff,stroke:#9333ea,color:#111827
    style B fill:#ffedd5,stroke:#ea580c,color:#111827
    style L fill:#fef3c7,stroke:#d97706,color:#111827
    style W fill:#fef3c7,stroke:#d97706,color:#111827
    style O fill:#dcfce7,stroke:#16a34a,color:#111827
```

## What works today

| Capability | Status | What it does |
| --- | :---: | --- |
| Creator offer form | ✅ | Captures title, description, the uploaded video, brand, price (sats or a fiat currency such as KES, shown with a live sats estimate), rights, and duration. |
| Video upload | ✅ | Direct browser-to-Cloudinary upload with server-signed parameters; large files are sent in chunks. Brands see a watermarked preview only. |
| Protected original download | ✅ | After a license, the buyer gets short-lived, limited-use download grants. Files arrive as downloads (on iPhone, a share-sheet "Save video"), and a buyer can return on another device with their download code. |
| Browser-based Nostr signing | ✅ | NIP-07 browser signers, or an optional signer provider (`NEXT_PUBLIC_SIGNER_PROVIDER_URL`) exposing the same calls. Private keys stay out of the engine. |
| Signed API authentication | ✅ | Binds authenticated creator requests to method, URL, body, and idempotency key. |
| Nostr offer publication | ✅ | Verifies an offer event, queues it durably, and retries relay publication until acknowledged. |
| Public offer link | ✅ | Lets a brand review the exact content reference, terms, price, and Nostr event ID. |
| PostgreSQL workflow storage | ✅ | Stores offers, idempotent requests, and the Nostr outbox locally through Docker Compose. |
| Local Lightning regression path | ✅ | Existing tests retain Polar/LND invoice creation and settlement lookup for local regtest development only. |
| Creator Lightning Address flow | ⚠️ | LNURL-pay/NIP-57 integration is implemented, but staging/production remain payment-disabled until the separately approved manual 1-sat compatibility test. |
| Zap receipt validation | ⚠️ | A valid kind 9735 receipt from the receiver key advertised by LNURL is treated as the creator service's signed attestation, not independent proof that funds moved. |
| Payment QR and status UI | ✅ | Shows the price, Lightning QR/invoice, pending state, and confirmed payment state. |
| Signed Nostr license event after payment | ⚠️ | A receipt accepted by the configured trust policy can trigger one linked license event through the existing outbox. This policy and provider compatibility still require real-endpoint staging validation. |
| Optional checkout provider | ✅ | An operator can add other payment methods through a checkout provider script (`NEXT_PUBLIC_CHECKOUT_PROVIDER_URL`). Its payment service reports settled payments to the engine service-to-service, and the engine signs the license. |
| Optional signer provider | ✅ | An operator can add a signer (`NEXT_PUBLIC_SIGNER_PROVIDER_URL`) exposing NIP-07-style calls and its own sign-in UI. Without it, Studio uses NIP-07 extensions. |

## Why this matters

| For creators | For brands |
| --- | --- |
| Set the price and usage rights before sharing work. | Review a single offer with clear rights, duration, and price. |
| Share a direct link instead of relying on a long DM history. | Pay the exact stated amount using Lightning. |
| Retain a signed, portable offer record. | Reference the offer event and payment state later. |
| Receive the license fee directly to the Creator Lightning node. | Avoid ambiguity about the asset and license being purchased. |

## Verifiable offers

ANZA uses a configured experimental regular Nostr event kind for the current MVP. The offer event includes:

- Creator public key and cryptographic signature
- Content reference and SHA-256 fingerprint
- Brand, price in sats, usage rights, and duration
- ANZA settlement-attestor public key
- Versioned event schema: `ANZA.offer.v1`

The backend verifies the signed event before publication. It does not manufacture a creator signature or accept a changed offer after an event ID has been assigned.

> [!NOTE]
> Nostr proves that a key signed a specific event. It does not by itself prove a real-world identity, brand authority, legal enforceability, or permanent relay retention. ANZA presents verifiable technical evidence; parties should still use terms appropriate to their agreement.

## Lightning demo

The repository supports a safe, local Lightning demonstration with [Polar](https://lightningpolar.com/) and two LND nodes in the **same Polar network**:

- **Creator** receives the invoice payment.
- **Buyer** funds and pays the invoice.

1. Fund **Buyer** with regtest sats in Polar.
2. Open and confirm a Lightning channel from **Buyer** to **Creator**.
3. Create and publish a ANZA offer.
4. Open its public link and select **Purchase License**.
5. Copy the `lnbcrt...` invoice or scan its QR code from Buyer.
6. Pay it from **Buyer → Payments**.
7. The payment page polls the backend; the backend checks Creator LND and shows **Payment received** only after settlement.

> [!WARNING]
> Polar uses private **regtest** Bitcoin. `lnbcrt...` invoices are demo invoices and cannot be paid from a normal wallet or a public testnet wallet. No real funds move in this setup.

### Staging and production payments

Staging and production use Bitcoin mainnet and the creator Lightning Address bound into the signed offer; Polar is restricted to local development. Payment remains disabled unless explicitly enabled for the relevant environment, and startup rejects inconsistent environment/network settings.

Any real Lightning Address compatibility test is manual, exactly **1 sat**, and requires separate explicit approval before payment for staging or production. Automated tests never send mainnet payments. Wallet of Satoshi is not assumed to support the full NIP-57 receipt flow, and creators are not asked to switch providers without evidence. Missing or delayed receipts remain pending and cannot issue a license. ANZA does not hold or forward creator funds.

The NIP-57 kind 9734 request, BOLT11 invoice, actual Lightning settlement, and kind 9735 receipt are distinct. The accepted policy trusts the receiver key advertised by the creator's HTTPS LNURL-pay service. A receiver-signed receipt is that service's attestation, **not independent proof that funds moved**.

The creator-signed offer binds the entered Lightning Address, but that signature alone does not prove who controls the receiving wallet. The manually approved endpoint test must confirm that the intended creator receives the payment.

## Core Lightning flow

```text
┌──────────────────────────────────────────────────────────────────────┐
│                         Next.js frontend :3001                        │
│  Create offer • on-device signing • Public offer • QR payment screen│
└──────────────────────────────┬───────────────────────────────────────┘
                               │ HTTP / JSON
┌──────────────────────────────▼───────────────────────────────────────┐
│                          Node.js backend :3000                        │
│  Auth • offer API • purchase records • Nostr receipt verification    │
└──────────────┬───────────────────────────────┬───────────────────────┘
               │                               │
      ┌────────▼────────┐             ┌────────▼─────────┐
      │ PostgreSQL :5432│             │ Nostr relays      │
      │ Offers + outbox │             │ Offers + receipts│
      └─────────────────┘             └──────────────────┘
               │
      ┌────────▼────────────────────┐    ┌────────────────────────┐
      │ Creator LNURL-pay service   │───▶│ Creator Lightning wallet│
      │ Mainnet invoice + Zap receipt│    │ Receives funds directly│
      └─────────────────────────────┘    └────────────────────────┘
```

Local development substitutes the creator service with the existing Polar
LND/regtest adapter; it cannot send real mainnet payments.

### Technology stack

| Layer | Technology | Role |
| --- | --- | --- |
| Frontend | Next.js 15, React 18, TypeScript | Creator flow, public offers, payment interface |
| UI | Tailwind CSS, Lucide, `qrcode.react` | Responsive screens, icons, Lightning QR code |
| Backend | Node.js 22, native HTTP modules | Validation, API, workflow coordination |
| Database | PostgreSQL 17 via Docker Compose | Offers, idempotency records, relay outbox |
| Nostr | `nostr-tools`, NIP-07 signer (or a pluggable signer provider) | Event signing and verification |
| Payments | Polar/LND locally; LNURL-pay and NIP-57 on mainnet | Local regression plus direct creator payments and signed receipt verification |
| Testing | Node test runner | Contract, validation, Nostr, LND, and persistence tests |

## API at a glance

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/offers` | Create a signed creator-owned offer draft. |
| `GET` | `/api/offers/:offerId` | Read a public published offer. |
| `POST` | `/api/offers/:offerId/publish` | Validate and queue the signed Nostr offer event. |
| `POST` | `/api/offers/:offerId/payment` | Start an idempotent purchase and create/reuse its invoice; include the purchase capability headers. |
| `GET` | `/api/purchases/:purchaseId/status` | Use `X-Purchase-Token` to poll the purchase-specific Zap receipt and license state. |
| `GET` | `/api/offers/:offerId/status` | Local Polar/regtest legacy payment status only. |
| `POST` | `/api/videos/upload-authorization` · `/api/videos` | Sign one direct Cloudinary upload, then register the uploaded video (creator). |
| `POST` | `/api/purchases/:id/download-grant` | Issue a short-lived download grant to the buyer: a Lightning purchase id with `X-Purchase-Token`, or an offer id with `X-External-Credential`. |
| `GET` | `/api/downloads/:grantToken` | Exchange a grant for a signed download link to the original. |
| `GET` | `/api/rates/:currency` | Public BTC rate for a fiat currency (sats estimates). |
| `POST` | `/api/offers/:offerId/external-payment-attestation` | Service-to-service: an external payment service reports a settled payment; the engine signs the license. |

Requests are rate limited per address (reads and writes separately); service-to-service calls are exempt and authenticated with `LE_ATTESTATION_SECRET`.

Full backend contracts live in [`backend/docs/openapi.json`](backend/docs/openapi.json) and [`backend/docs/api-contract.md`](backend/docs/api-contract.md).

## Local development

### Prerequisites

- Node.js **22+**
- Docker and Docker Compose
- A Nostr NIP-07 signer extension, such as nos2x, for creating offers (or a configured signer provider)
- Polar with a Creator LND node for the Lightning demo

### 1. Start PostgreSQL

```bash
docker compose up -d --wait postgres
```

### 2. Configure backend environment

Create `backend/.env`. Never commit it.

```env
HOST=127.0.0.1
PORT=3000
PUBLIC_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://ANZA:change-me@localhost:5432/ANZA

# Development event configuration
NOSTR_OFFER_KIND=9998
NOSTR_ATTESTOR_PUBKEY=<your-npub-or-64-character-hex-public-key>
NOSTR_RELAYS=<comma-separated-wss-relay-urls>

# Polar Creator node only — keep this local and private
LND_REST_URL=https://127.0.0.1:<creator-rest-port>
LND_MACAROON=<creator-admin-macaroon-in-hex>
```

### 3. Configure frontend environment

```bash
cp frontend/.env.example frontend/.env
```

Set `NEXT_PUBLIC_NOSTR_ATTESTOR_PUBKEY` to the same **public** attestor key configured for the backend. Never put a Nostr private key or LND macaroon in the frontend environment.

Optional operator settings (all empty by default): `NEXT_PUBLIC_CHECKOUT_PROVIDER_URL` and `NEXT_PUBLIC_SIGNER_PROVIDER_URL` (provider scripts, see `frontend/lib/checkout.ts` and `frontend/lib/signerProvider.ts`), `NEXT_PUBLIC_SIGNUP_URL` and `NEXT_PUBLIC_ONBOARD_URL` (links shown to creators), and `NEXT_PUBLIC_SITE_URL`.

### 4. Install and run

In separate terminals:

```bash
cd backend
npm install
npm start
```

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

### Verify the build

```bash
cd backend && npm test
cd ../frontend && npm run build
```

## Repository layout

```text
ANZA/
├── frontend/                 # Next.js creator and brand experience
│   ├── app/                  # Create offer, public offer, and payment pages
│   ├── components/           # UI, offer, layout, and payment components
│   └── lib/                  # API client, Nostr signing, provider interfaces (checkout, signer), shared types
├── backend/                  # Node.js API and business rules
│   ├── src/
│   │   ├── services/nostr/   # Event builders and relay publisher
│   │   ├── services/payments/# Polar/LND and LNURL-pay/NIP-57 adapters
│   │   ├── services/offers/  # Offer and payment workflow
│   │   ├── repositories/     # PostgreSQL persistence
│   │   └── database/         # SQL migrations
│   ├── test/                 # Unit and integration coverage
│   └── docs/                 # API, data model, and protocol notes
├── .github/workflows/        # Deploys: staging branch -> staging, production branch -> production
├── compose.yaml              # Local PostgreSQL service
└── README.md                 # Project overview
```

## Deployment

GitHub Actions deploy the `staging` branch to staging and the `production` branch
to production on Google Cloud Run. Each deploy builds the backend and frontend
images, runs the database migrations as a job **before** the new API goes live,
then deploys. Production authenticates to Google Cloud through OIDC limited to the
`production` branch, and every secret (database URL, attestor key, Cloudinary and
service-to-service secrets) comes from the platform's secret manager, never from
the repository or plain environment settings.

Production startup refuses unsafe settings: it requires mainnet, public `wss://`
relays, an HTTPS `PUBLIC_ORIGIN`, an unlocked attestor key, a service-to-service
secret of at least 16 characters, and a username and password for the API docs
(`SWAGGER_UI_USERNAME` / `SWAGGER_UI_PASSWORD`).
DEV VS PRODUCTION NOTES
strfry.conf + the strfry service in compose.yaml are local development only. Production points NOSTR_RELAYS at third-party wss:// relays.

## Security and privacy principles

- **Private keys stay in the signer.** The frontend requests NIP-07-style signatures from a browser extension or a configured signer provider; it does not collect or transmit a creator's private key, and the backend verifies every signature.
- **Secrets stay local.** `.env` files, LND macaroons, database credentials, and tunnel tokens must never be committed.
- **Terms are validated before storage or publication.** Invalid prices, missing fields, contradictory durations, and unsafe content URLs are rejected.
- **Offer publication is durable.** A PostgreSQL outbox retries relays and does not report success until a relay acknowledges the exact event ID.
- **Payment status comes from LND.** The UI does not mark an invoice paid merely because a buyer clicked a button.
- **Download secrets are never stored in plain form.** Buyer credentials and download grants are stored as SHA-256 hashes; grants expire after an hour and allow a limited number of uses.
- **Abuse protection.** Per-address rate limits on the API; pages are served with security headers (no framing, `nosniff`, HSTS, strict referrer policy).

## Roadmap

- [x] Add protected original-file delivery with limited-use download access.
- [ ] Support public testnet/mainnet Lightning with production-grade TLS, wallet permissions, and operational controls.
- [ ] Add buyer acceptance and brand identity workflows.
- [ ] Add creator offer history and license management.
- [ ] Publish contribution guidelines and select an open-source license.

## Contributing

This is a hackathon MVP moving toward an open-source project. Useful contributions include protocol review, Lightning reliability, UX/accessibility improvements, creator research, tests, and documentation.

Before opening a pull request:

```bash
cd backend && npm test
cd ../frontend && npm run build
```

Please do not commit `.env` files, macaroons, private keys, access tokens, or generated local binaries.

---

<div align="center">

Built for creators who should be able to say: **this is my work, these are my terms, and this is the record.**

</div>

## Architecture

```mermaid
flowchart LR
  subgraph FE["License Engine frontend · frontend"]
    CreatorScreens["Creator profile, upload content, create and publish offers"]
    BrandScreens["Offer page, Lightning payment, license and download"]
    LEApi["lib/api.ts · Nostr-signed API requests"]
    CreatorScreens --> LEApi
    BrandScreens --> LEApi
  end

  subgraph BE["License Engine backend · backend"]
    OfferAPI["POST /api/offers · GET /api/offers/:id · POST /api/offers/:id/publish"]
    VideoAPI["POST /api/videos/upload-authorization · POST /api/videos"]
    ZapAPI["POST /api/offers/:id/payment · GET /api/purchases/:id/status"]
    GrantAPI["download grants · GET /api/downloads/:token"]
    ExternalAttest["POST /api/offers/:id/external-payment-attestation (service-to-service)"]
    Store[("PostgreSQL · offers, purchases, grants, outbox")]
  end

  subgraph External["External services"]
    Cloudinary["Cloudinary · direct browser upload and protected media"]
    Nostr["Nostr signer and relays · signed offer, Zap receipt, license event"]
    Lightning["Creator LNURL-pay / NIP-57 Zap; local Polar/LND in development"]
  end

  subgraph Optional["Optional, operator-supplied"]
    Signer["Signer provider script · window.ContentPortSigner"]
    Checkout["Checkout provider script · window.ContentPortCheckout"]
    PaySvc["External payment service"]
  end

  LEApi --> OfferAPI
  LEApi --> VideoAPI
  LEApi --> ZapAPI
  LEApi --> GrantAPI
  LEApi --> Nostr
  LEApi -->|"signed upload parameters, then direct browser upload"| Cloudinary
  OfferAPI --> Store
  ZapAPI --> Store
  GrantAPI --> Store
  ZapAPI --> Lightning
  Lightning --> Nostr
  Nostr -->|"verified receipt can trigger license"| ZapAPI
  GrantAPI -->|"only after a valid purchase"| Cloudinary
  CreatorScreens -.-> Signer
  BrandScreens -.-> Checkout
  Checkout -.-> PaySvc
  PaySvc -.->|"settled payment"| ExternalAttest
  ExternalAttest --> Store
  ExternalAttest -->|"publish license event"| Nostr
```

The engine runs on its own with NIP-07 signing and Lightning payments. An
operator can add a signer provider, a checkout provider and an external payment
service through the documented interfaces (`frontend/lib/signerProvider.ts`,
`frontend/lib/checkout.ts`, and the attestation endpoint); none are required.
