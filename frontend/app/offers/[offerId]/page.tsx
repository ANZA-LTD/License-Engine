"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle, ExternalLink, Calendar, Download } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ContentPreview } from "@/components/offer/ContentPreview";
import { VerificationCard } from "@/components/offer/VerificationCard";
import { LicenseDetails } from "@/components/offer/LicenseDetails";
import { getMyOffer, getOffer, issueDownloadGrant, consumeDownloadGrant, getStoredPurchaseId } from "@/lib/api";
import { Offer } from "@/lib/types";

/**
 * Screen 3 (Public Offer Page) AND Screen 5 (Licensed Confirmation) share
 * this one route, per spec section 20: "There does not need to be a
 * separate route for Screen 5. The offer page should conditionally render
 * based on the offer status."
 *
 * Data comes from GET /api/offers/:offerId (lib/api.getOffer). We render:
 *   - status OPEN / PAYMENT_PENDING -> public offer view with Purchase CTA
 *   - status LICENSED               -> licensed confirmation view
 */
export default function OfferPage({ params }: { params: { offerId: string } }) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The public read is the fast path and covers every published offer, so
        // brands never wait on a signer probe. It only fails for an offer the
        // licensing engine has not published yet, which is exactly the draft a
        // creator opened from their own library, so retry that with a signature.
        let data: Offer;
        try {
          data = await getOffer(params.offerId);
        } catch {
          data = await getMyOffer(params.offerId);
        }
        if (!cancelled) setOffer(data);
      } catch {
        if (!cancelled) setError("not-found");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.offerId]);

  if (error) {
    return (
      <main>
        <Navbar backHref="/" />
        <div className="mx-auto max-w-xl px-6 py-16 text-center">
          <h1 className="text-lg font-semibold text-text-primary">
            Unable to load this offer.
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            The offer may no longer exist or the service may be temporarily
            unavailable.
          </p>
        </div>
      </main>
    );
  }

  if (!offer) {
    // BACKEND TEAM: replace with a skeleton component once real network
    // latency is in play — a plain loading line is enough for the mock.
    return (
      <main>
        <Navbar backHref="/" />
        <div className="mx-auto max-w-3xl px-6 py-16 text-center text-sm text-text-secondary">
          Loading offer…
        </div>
      </main>
    );
  }

  if (offer.status === "LICENSED") return <LicensedView offer={offer} />;
  if (offer.status === "PAYMENT_ATTESTED" || offer.status === "PAYMENT_SETTLED") return <PaymentConfirmedView offer={offer} />;
  return <PublicOfferView offer={offer} />;
}

/** Screen 3 — Brand-facing offer detail. Also used for a creator's own draft. */
const PENDING_EVENT = "Pending relay acknowledgement";
function PublicOfferView({ offer }: { offer: Offer }) {
  return (
    <main>
      <Navbar backHref="/" verified />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
          <ContentPreview url={offer.contentUrl} title={offer.title} />
          <div>
            <h1 className="text-2xl font-bold text-text-primary">{offer.title}</h1>
            <p className="mt-1 text-sm text-text-secondary">
              Created by {offer.creatorHandle}
            </p>
          </div>
        </div>

        <Card className="mt-8">
          <LicenseDetails offer={offer} brandLabel="Offered To" />

          <div className="mt-6 flex items-center justify-between border-t border-border pt-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Status
              </p>
              <div className="mt-1">
                <StatusBadge status={offer.status} />
              </div>
            </div>
          </div>

          {/* An offer with no event id yet is still a draft. Only its creator can
              reach this page, and the licensing engine will not issue an invoice
              for an unpublished offer, so there is nothing to purchase. */}
          {offer.nostrEventId === PENDING_EVENT && (
            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              This offer is still a draft. Publish it from your library before a
              brand can license it.
            </div>
          )}
          {offer.status === "OPEN" && offer.nostrEventId !== PENDING_EVENT && (
            <Link href={`/offers/${offer.offerId}/pay`} className="mt-6 block">
              <Button fullWidth>Purchase License</Button>
            </Link>
          )}
          {offer.status === "PAYMENT_PENDING" && (
            <Link href={`/offers/${offer.offerId}/pay`} className="mt-6 block">
              <Button fullWidth variant="secondary">
                Resume payment
              </Button>
            </Link>
          )}
        </Card>

        {offer.nostrEventId !== PENDING_EVENT && (
          <div className="mt-6">
            <VerificationCard eventId={offer.nostrEventId} />
          </div>
        )}
      </div>
    </main>
  );
}

/** Payment evidence view — its wording follows the selected verification policy. */
function PaymentConfirmedView({ offer }: { offer: Offer }) {
  const zapReceiptVerified = offer.status === "PAYMENT_ATTESTED";
  const settledDate = offer.paymentSettledAt
    ? new Date(offer.paymentSettledAt * 1000).toLocaleString("en-US", {
        day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit"
      })
    : zapReceiptVerified ? "Receipt timestamp unavailable" : "Confirmed by Lightning node";

  return (
    <main>
      <Navbar backHref="/" verified />
      <div className="mx-auto max-w-2xl px-6 py-12 text-center">
        <CheckCircle size={56} className="mx-auto text-success" />
        <p className="mt-4 text-sm font-semibold uppercase tracking-[0.18em] text-success">
          {zapReceiptVerified ? "Creator receipt verified" : "Lightning settlement verified"}
        </p>
        <h1 className="mt-2 text-3xl font-bold text-text-primary">
          {zapReceiptVerified ? "Creator payment attested" : "Payment Confirmed"}
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          {zapReceiptVerified
            ? `The creator's Lightning service signed a receipt for ${offer.priceSats.toLocaleString()} sats. This is the service's attestation, not independent proof that funds moved.`
            : `${offer.priceSats.toLocaleString()} sats settled to the local Lightning node.`}
        </p>

        <Card className="mt-8 text-left">
          <div className="flex items-center gap-4">
            <ContentPreview url={offer.contentUrl} title={offer.title} size="small" />
            <div>
              <p className="font-semibold text-text-primary">{offer.title}</p>
              <p className="mt-1 text-sm text-text-secondary">License payment receipt</p>
            </div>
          </div>

          <div className="mt-6 border-t border-border pt-6">
            <LicenseDetails offer={offer} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 border-t border-border pt-6 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                {zapReceiptVerified ? "Offer amount" : "Amount settled"}
              </p>
              <p className="mt-1 text-lg font-bold text-text-primary">{offer.priceSats.toLocaleString()} sats</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                {zapReceiptVerified ? "Receipt timestamp" : "Settlement time"}
              </p>
              <p className="mt-1 text-sm font-medium text-text-primary">{settledDate}</p>
            </div>
          </div>
        </Card>

        <div className="mt-6 text-left">
          <VerificationCard eventId={offer.nostrEventId} label="Original offer verified on Nostr" />
        </div>

        <div className="mt-6 rounded-xl border border-border bg-surface p-5 text-left">
          <p className="text-sm font-semibold text-text-primary">License record</p>
          <p className="mt-1 text-sm text-text-secondary">
            {zapReceiptVerified
              ? "The creator service's signed receipt was accepted under ANZA's payment policy. The linked license attestation will appear here after relay publication."
              : "The local Lightning node reported settlement. The linked Nostr license attestation will appear here when it is signed and published."}
          </p>
        </div>
      </div>
    </main>
  );
}

/** Screen 5 — spec section 18/19 */
function LicensedView({ offer }: { offer: Offer }) {
  const [downloadStatus, setDownloadStatus] = useState<"idle" | "downloading" | "success" | "error">("idle");
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const autoAttempted = useRef(false);
  const licensedDate = offer.licensedAt
    ? new Date(offer.licensedAt).toLocaleDateString("en-US", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

  const triggerFileDownload = async (grantToken: string): Promise<void> => {
    const result = await consumeDownloadGrant(grantToken);
    const link = document.createElement("a");
    link.href = result.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const initiateDownload = async (allowExpiryRetry: boolean) => {
    const purchaseIdForDownload = offer.purchaseId ?? getStoredPurchaseId(offer.offerId);
    if (!purchaseIdForDownload) {
      setDownloadError("Purchase details not available for download.");
      setDownloadStatus("error");
      return;
    }
    setDownloadStatus("downloading");
    setDownloadError(null);
    try {
      const grant = await issueDownloadGrant(purchaseIdForDownload, offer.offerId);
      await triggerFileDownload(grant.grantToken);
      setDownloadStatus("success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Download failed";
      const isExpiredOrMissing = /expired|not found|revoked/i.test(message);
      if (allowExpiryRetry && isExpiredOrMissing) {
        try {
          const grant = await issueDownloadGrant(purchaseIdForDownload, offer.offerId);
          await triggerFileDownload(grant.grantToken);
          setDownloadStatus("success");
          return;
        } catch (retryError) {
          setDownloadError(retryError instanceof Error ? retryError.message : "Download failed");
          setDownloadStatus("error");
          return;
        }
      }
      setDownloadError(message);
      setDownloadStatus("error");
    }
  };

  // Automatically start the download once the license is granted and this view mounts.
  // A manual button below remains as a fallback if the browser blocks the automatic download.
  useEffect(() => {
    if (autoAttempted.current) return;
    autoAttempted.current = true;
    initiateDownload(true);
  }, [offer.purchaseId, offer.offerId]);

  return (
    <main>
      <Navbar backHref="/" />
      <div className="mx-auto max-w-2xl px-6 py-12 text-center">
        <CheckCircle size={56} className="mx-auto text-success" />
        <h1 className="mt-4 text-2xl font-bold text-success">LICENSED</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Your license has been confirmed.
        </p>

        <Card className="mt-8 text-left">
          <div className="flex items-center gap-4">
            <ContentPreview url={offer.contentUrl} title={offer.title} size="small" />
            <p className="font-semibold text-text-primary">{offer.title}</p>
          </div>

          <div className="mt-6 border-t border-border pt-6">
            <LicenseDetails offer={offer} />
            <div className="mt-4 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              <Calendar size={14} /> Licensed
            </div>
            <p className="mt-1 text-sm font-medium text-text-primary">{licensedDate}</p>
          </div>

          <div className="mt-6 border-t border-border pt-6">
            <Button fullWidth onClick={() => initiateDownload(false)} disabled={downloadStatus === "downloading" || !(offer.purchaseId || getStoredPurchaseId(offer.offerId))}>
              <Download size={16} className="mr-2" />
              {downloadStatus === "downloading" ? "Preparing download…"
                : downloadStatus === "success" ? "Download complete"
                : "Download Original (Unwatermarked)"}
            </Button>
            {downloadError && (
              <p className="mt-2 text-sm text-red-600" role="alert">
                {downloadError}. Use the button above to retry.
              </p>
            )}
            {downloadStatus === "success" && (
              <p className="mt-2 text-xs text-text-secondary text-center">
                Your download should start automatically. Use the button above to retry if it does not.
              </p>
            )}
            {offer.purchaseId && downloadStatus === "idle" && (
              <p className="mt-2 text-xs text-text-secondary text-center">
                Downloads the original, unwatermarked file.
              </p>
            )}
          </div>

          <div className="mt-6 border-t border-border pt-6">
            <p className="mb-3 text-sm font-semibold text-text-primary">
              Public Verification
            </p>
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle size={14} /> Payment confirmed
              </p>
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle size={14} /> License recorded on Nostr
              </p>
            </div>

            {offer.licenseNostrEventId && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-surface px-3.5 py-2.5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    Nostr Event
                  </p>
                  <code className="text-xs text-text-secondary">
                    {offer.licenseNostrEventId.slice(0, 20)}...
                  </code>
                </div>
                <a
                  href={`https://njump.me/${offer.licenseNostrEventId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                >
                  View Event <ExternalLink size={12} />
                </a>
              </div>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
