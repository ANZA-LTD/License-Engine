# ContentPort frontend

The creator form uses the live ContentPort backend and a NIP-07 Nostr browser signer. Copy `.env.example` to `.env`, configure it, then run `npm run dev`.

## ANZA application floorplan

```mermaid
flowchart LR
  subgraph AUI["ANZA User Interface · anza-user-interface/client"]
    AUIRoutes["Home, onboarding, Nostr identity, profile, offer and checkout pages"]
    Proxy["Next.js API proxy: /api/proxy/*"]
    AUIRoutes --> Proxy
  end

  subgraph CPBE["Creator Platform Backend · creator-platform-be"]
    Identity["POST /api/creators/nostr-identity"]
    Profile["POST, GET /api/creators/profile"]
    PurchaseRoute["POST /api/purchase/route"]
    OfferProxy["GET /api/offers/:id"]
    PayoutContact["GET /internal/creators/:id/payout · HMAC"]
    CreatorDB[("Creator accounts, Nostr identities, payout contacts")]
  end

  subgraph LEFE["License Engine frontend · License-Engine/frontend"]
    CreatorScreens["Sign in, creator profile, create offer, upload content"]
    BrandScreens["Offer details, share, Lightning payment, payment status"]
    LEApi["lib/api.ts · Nostr-signed API requests"]
    CreatorScreens --> LEApi
    BrandScreens --> LEApi
  end

  subgraph LE["License Engine backend · License-Engine/backend"]
    OfferAPI["POST /api/offers · GET /api/offers/:id · POST /api/offers/:id/publish"]
    VideoAPI["POST /api/videos/upload-authorization · POST /api/videos"]
    ZapAPI["POST /api/offers/:id/payment · GET /api/purchases/:id/status"]
    GrantAPI["POST /api/purchases/:id/download-grant · GET /api/downloads/:token"]
    ExternalAttest["POST /api/offers/:id/external-payment-attestation"]
    LEStore[("PostgreSQL · offers, purchases, grants, outbox")]
  end

  subgraph PM["Payment Microservice · payment-microservice"]
    Initiate["POST /payments/initiate/:offerId"]
    Verify["POST /webhooks/paystack · GET /payments/:reference"]
    Fulfill["POST /payments/:reference/fulfill"]
    Orchestrate["orchestrator.js · verify payment, payout, attest license"]
    Payout["Daraja payout adapter"]
    PMStore[("PostgreSQL · payments, payouts, audit")]
  end

  subgraph External["External services"]
    Cloudinary["Cloudinary · direct browser upload and protected media"]
    Nostr["Nostr signer and relays · signed offer, Zap receipt, license event"]
    Lightning["Creator LNURL-pay / NIP-57 Zap; local Polar/LND in development"]
    Paystack["Paystack checkout and signed webhook"]
    DarajaSvc["Safaricom Daraja"]
  end

  Proxy --> Identity
  Proxy --> Profile
  Identity --> CreatorDB
  Profile --> CreatorDB
  LEApi --> OfferAPI
  LEApi --> VideoAPI
  LEApi --> ZapAPI
  LEApi --> GrantAPI
  LEApi --> Nostr
  LEApi -->|"signed upload parameters, then direct browser upload"| Cloudinary
  OfferAPI --> LEStore
  ZapAPI --> LEStore
  GrantAPI --> LEStore
  ZapAPI --> Lightning
  Lightning --> Nostr
  Nostr -->|"verified receipt can trigger license"| ZapAPI
  PurchaseRoute -->|"fetch authoritative offer"| OfferProxy
  OfferProxy --> OfferAPI
  PurchaseRoute --> CreatorDB
  AUIRoutes -->|"Paystack checkout via lib/payment.ts"| Initiate
  Initiate --> Paystack
  Paystack -->|"signed callback"| Verify
  Verify --> Orchestrate
  Orchestrate --> PMStore
  Orchestrate --> PayoutContact
  Orchestrate --> Payout
  Payout --> DarajaSvc
  Orchestrate -->|"after required payment and payout checks"| ExternalAttest
  ExternalAttest --> LEStore
  ExternalAttest -->|"publish license event"| Nostr
  GrantAPI -->|"only after valid purchase/license grant"| Cloudinary

  Identity -.->|"shared public Nostr key; no profile-sync API"| LEApi
```
