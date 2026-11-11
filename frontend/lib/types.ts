/**
 * Shared types for the whole app.
 *
 * BACKEND TEAM: these shapes are copied directly from the spec
 * (sections 10, 14, 15, 16). If your real API responds with different
 * field names, either update the backend to match this file, or update
 * this file and the two or three call sites in lib/api.ts — nothing else
 * in the UI should need to change, since every component reads these types.
 */

export type LicenseType = "30_DAY_SOCIAL" | "90_DAY_COMMERCIAL" | "PERPETUAL";

export type OfferStatus = "OPEN" | "PAYMENT_PENDING" | "PAYMENT_ATTESTED" | "PAYMENT_SETTLED" | "LICENSED";

/** Full offer record — response shape of GET /api/offers/:offerId */
export interface Offer {
  offerId: string;
  title: string;
  description: string;
  contentUrl: string;
  preview_url?: string;
  thumbnail_url?: string | null;
  brandName: string;
  /** Signed sats price (older offers). Null for fiat-priced offers. */
  priceSats: number | null;
  /** Signed fiat price, e.g. { currency: "KES", amount_minor: 400000 }. */
  price: { currency: string; amount_minor: number } | null;
  creatorLightningAddress?: string;
  licenseType: LicenseType;
  licenseDescription: string;
  status: OfferStatus;
  nostrEventId: string;
  creatorHandle: string;
  creatorPubkey: string;
  /** Only present once status === "LICENSED" */
  licensedAt?: string | number;
  /** Nostr event id of the license/payment confirmation event (kind: license_purchase) */
  licenseNostrEventId?: string;
  /** Unix timestamp from LND once the Lightning invoice settles. */
  paymentSettledAt?: number;
  /** Present once status === "LICENSED" and a purchase was created. */
  purchaseId?: string;
}

/** Body of POST /api/offers */
export interface CreateOfferPayload {
  title: string;
  description: string;
  contentUrl: string;
  brandName: string;
  /** Price in whole Kenyan shillings. */
  priceKes: number;
  /** Optional: only needed to accept Bitcoin Lightning payments. */
  creatorLightningAddress: string;
  licenseType: LicenseType;
  licenseDescription: string;
  /**
   * When set, the backend resolves the canonical media reference and fingerprint
   * from this creator-owned video. `contentUrl` is then ignored and should be
   * left blank — the browser is never the authority for the media reference.
   */
  videoId?: string;
}

/** Response of POST /api/offers */
export interface CreateOfferResponse {
  offerId: string;
  status: OfferStatus;
  nostrEventId: string;
  publicUrl: string;
}

/** Response of POST /api/offers/:offerId/payment */
export interface PaymentRequestResponse {
  offerId: string;
  purchaseId?: string;
  amountSats: number;
  paymentRequest: string; // the raw "lnbc..." Lightning invoice string
}

/** Response of GET /api/offers/:offerId/status — used for polling on the pay page */
export interface OfferStatusResponse {
  offerId: string;
  status: OfferStatus;
  licenseNostrEventId?: string;
  licensedAt?: string;
  paymentSettledAt?: number;
  purchaseId?: string;
  downloadGrantToken?: string;
  downloadGrantExpiresAt?: number;
}

export interface PurchaseStatusResponse {
  purchaseId: string;
  status: "PAYMENT_PENDING" | "PAYMENT_ATTESTED" | "LICENSED" | "EXPIRED";
  receiptState: "awaiting_receipt" | "temporarily_unavailable" | "verified";
  licenseNostrEventId?: string;
  licensedAt?: number;
  /** Raw 64-char hex download grant token issued atomically during license attestation */
  downloadGrantToken?: string;
  /** Unix timestamp when the download grant expires */
  downloadGrantExpiresAt?: number;
}

// ---------------------------------------------------------------------------
// Content layer. The offer stays the licensing entity; a video is the content an
// offer refers to.
// ---------------------------------------------------------------------------

/** Media processing state only. Offer, payment and license states are separate. */
export type VideoStatus = "processing" | "ready" | "failed";

/** A creator-owned video as stored by the backend. */
export interface VideoRecord {
  id: string;
  owner_public_key: string;
  title: string;
  cloud_name: string;
  public_id: string;
  asset_version: number;
  resource_type: "video";
  format: string;
  status: VideoStatus;
  /** Server-derived fingerprint of the Cloudinary asset reference. Authoritative. */
  reference_sha256: string;
  /** Creator-reported fingerprint of the uploaded bytes. The server cannot verify it. */
  original_sha256: string | null;
  bytes: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  upload_session_id: string;
  created_at: number;
  updated_at: number;
}

/** The real offer rows behind a video, so offer state is never inferred from an id. */
export interface OfferSummary {
  offer_id: string;
  status: "draft" | "publishing" | "published" | "licensing" | "licensed";
  price_sats: number | null;
  price: { currency: string; amount_minor: number } | null;
  created_at: number;
}

/** An entry in the authenticated creator's own library. */
export interface OwnedVideo {
  video: VideoRecord;
  preview_url: string;
  thumbnail_url: string;
  /** Owner-only. Discovery never returns this. */
  original_url: string;
  offers: OfferSummary[];
}

/** Server-signed Cloudinary upload parameters. The API secret is never returned. */
export interface UploadAuthorization {
  cloud_name: string;
  api_key: string;
  resource_type: "video";
  folder: string;
  context: string;
  upload_session_id: string;
  timestamp: number;
  signature: string;
  allowed_formats: string[];
}

/**
 * Upload authorisation from a content service: a resumable upload session
 * (the GCS resumable protocol: chunked PUTs with Content-Range, resumable).
 */
export interface ResumableUploadAuthorization {
  provider: "content-service";
  upload_session_id: string;
  asset_id: string;
  upload: { protocol: "gcs-resumable"; url: string; chunk_bytes: number; max_bytes: number };
}

export type AnyUploadAuthorization = UploadAuthorization | ResumableUploadAuthorization;

export const isResumableUpload = (auth: AnyUploadAuthorization): auth is ResumableUploadAuthorization =>
  (auth as ResumableUploadAuthorization).provider === "content-service";

/** Body of POST /api/videos for a content-service upload. */
export interface AssetRegistrationInput {
  title: string;
  upload_session_id: string;
  asset_id: string;
}

/** Metadata Cloudinary returns after a direct browser upload. */
export interface CloudinaryUploadResult {
  public_id: string;
  version: number;
  resource_type: string;
  format: string;
  bytes?: number;
  duration?: number;
  width?: number;
  height?: number;
  /** "ready" | "pending" (still transcoding) | "failed". */
  resource_status?: string;
}

/** Body of POST /api/videos, assembled from a Cloudinary upload result. */
export interface VideoRegistrationInput {
  title: string;
  upload_session_id: string;
  public_id: string;
  asset_version: number;
  resource_type: "video";
  format: string;
  context: string;
  status: VideoStatus;
  original_sha256: string | null;
  bytes: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
}

/**
 * A brand-facing offer card. Carries a watermarked preview and never the
 * unrestricted original, the owner's private metadata or any secret.
 */
export interface DiscoveryListing {
  offer_id: string;
  video_id: string | null;
  title: string | null;
  description: string | null;
  creator_public_key: string;
  preview_url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  license_duration: { type: "fixed"; days: number } | { type: "perpetual" };
  price_sats: number | null;
  price: { currency: string; amount_minor: number } | null;
  status: "published" | "licensing";
  created_at: number;
}
