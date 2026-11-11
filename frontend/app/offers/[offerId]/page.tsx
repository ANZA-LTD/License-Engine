"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle, ExternalLink, Calendar, Download } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ContentPreview } from "@/components/offer/ContentPreview";
import { VerificationCard } from "@/components/offer/VerificationCard";
import { LicenseDetails } from "@/components/offer/LicenseDetails";
import { getMyOffer, getOffer, issueDownloadGrant, issueExternalDownloadGrant, consumeDownloadGrant, getStoredPurchaseId, getStoredDownloadGrant } from "@/lib/api";
import { Offer } from "@/lib/types";
import { PurchaseOptions } from "@/components/payment/PurchaseOptions";
import { getStoredExternalCredential, storeExternalCredential } from "@/lib/checkout";
import { formatPrice } from "@/lib/price";

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
export default function OfferPage() {
  // Route parameters via the hook (Next 15 passes page params asynchronously).
  const params = useParams<{ offerId: string }>();
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
          <ContentPreview url={offer.preview_url ?? offer.contentUrl} title={offer.title} />
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
          {(offer.status === "OPEN" || offer.status === "PAYMENT_PENDING") && offer.nostrEventId !== PENDING_EVENT && (
            <PurchaseOptions offer={offer} resume={offer.status === "PAYMENT_PENDING"} />
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
            ? `The creator's Lightning service signed a receipt for ${formatPrice(offer.price, offer.priceSats)}. This is the service's attestation, not independent proof that funds moved.`
            : `${formatPrice(offer.price, offer.priceSats)} settled to the local Lightning node.`}
        </p>

        <Card className="mt-8 text-left">
          <div className="flex items-center gap-4">
            <ContentPreview url={offer.preview_url ?? offer.contentUrl} title={offer.title} size="small" />
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
              <p className="mt-1 text-lg font-bold text-text-primary">{formatPrice(offer.price, offer.priceSats)}</p>
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

/**
 * The download code a buyer receives with the purchase is the credential: a
 * 64-character secret only the buyer holds. Spaces and dashes are ignored so
 * a code copied in groups still works.
 */
function normaliseDownloadCode(input: string): string | null {
  const code = input.replace(/[\s-]/g, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(code) ? code : null;
}

/** iPhone/iPad: Safari can't save a video to Photos from a link, but the share sheet can ("Save Video"). */
function prefersShareSheet(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

function toDate(value: string | number | undefined): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : /^\d+$/.test(value) ? Number(value) : NaN;
  // The license time is recorded in seconds; JavaScript dates use milliseconds.
  const date = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Screen 5 — spec section 18/19 */
function LicensedView({ offer }: { offer: Offer }) {
  type Phase = "idle" | "preparing" | "ready" | "done" | "error";
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{ url: string; file: File | null } | null>(null);
  const [credential, setCredential] = useState<string | null>(null);
  const [initialGrant, setInitialGrant] = useState<string | null>(null);
  const [hasLightningAccess, setHasLightningAccess] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const autoAttempted = useRef(false);

  // The buyer proves the purchase with a secret: the download code (from the
  // checkout on this device, or from a ?code=... link the provider sent), a
  // fresh grant from the checkout redirect, or a Lightning purchase token.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromLink = normaliseDownloadCode(params.get("code") ?? "");
    if (fromLink) {
      storeExternalCredential(offer.offerId, fromLink);
      params.delete("code");
      const rest = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
    }
    setCredential(getStoredExternalCredential(offer.offerId));
    const grant = params.get("grantToken");
    setInitialGrant(grant && /^[0-9a-f]{64}$/.test(grant) ? grant : getStoredDownloadGrant(offer.offerId)?.grantToken ?? null);
    setHasLightningAccess(Boolean(offer.purchaseId || getStoredPurchaseId(offer.offerId)));
    setLoaded(true);
  }, [offer.offerId, offer.purchaseId]);

  const hasDownloadAccess = Boolean(credential || initialGrant || hasLightningAccess);
  const licensedAt = toDate(offer.licensedAt);
  const licensedDate = licensedAt
    ? licensedAt.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })
    : "—";

  // Each download uses a fresh short-lived grant, so tapping Download again
  // never runs into an used-up or expired one.
  const freshGrant = async (code: string | null): Promise<string> => {
    if (code) return (await issueExternalDownloadGrant(offer.offerId, code)).grantToken;
    if (initialGrant) return initialGrant;
    const purchaseId = offer.purchaseId || getStoredPurchaseId(offer.offerId);
    if (purchaseId) return (await issueDownloadGrant(purchaseId, offer.offerId)).grantToken;
    throw new Error("Enter the download code you received with your purchase to download.");
  };

  const prepareDownload = async (code: string | null = credential) => {
    setPhase("preparing");
    setError(null);
    setPrepared(null);
    try {
      let url: string;
      try {
        url = (await consumeDownloadGrant(await freshGrant(code))).url;
      } catch (first) {
        // A grant from the checkout redirect may be used up or expired; a
        // stored code can always mint a new one.
        if (!code || !/expired|not found|revoked/i.test(first instanceof Error ? first.message : "")) throw first;
        url = (await consumeDownloadGrant((await issueExternalDownloadGrant(offer.offerId, code)).grantToken)).url;
      }

      if (prefersShareSheet()) {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error("fetch failed");
          const blob = await response.blob();
          const extension = (blob.type.split("/")[1] || "mp4").split(";")[0].replace("quicktime", "mov");
          const name = `${(offer.title || "anza-video").replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "_").slice(0, 60) || "anza-video"}.${extension}`;
          const file = new File([blob], name, { type: blob.type || "video/mp4" });
          if (navigator.canShare({ files: [file] })) {
            setPrepared({ url, file });
            setPhase("ready");
            return;
          }
        } catch {
          /* fall back to a regular download */
        }
      }

      // Desktop and Android: the link is sent as an attachment, so it downloads.
      const link = document.createElement("a");
      link.href = url;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setPrepared({ url, file: null });
      // The browser handles the download itself, so this confirms it started.
      setDoneMessage("Your download has started. Find the video in your Downloads folder or your browser's downloads list.");
      setPhase("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The download could not be prepared. Please try again.");
      setPhase("error");
    }
  };

  const saveWithShareSheet = async () => {
    if (!prepared?.file) return;
    try {
      // Must run straight from the tap: iOS only opens the share sheet for a user gesture.
      await navigator.share({ files: [prepared.file], title: offer.title });
      // share() resolves once the person finishes in the menu (for example Save Video).
      setDoneMessage("Saved. Find the video in Photos or Files, wherever you chose to save it.");
      setPhase("done");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return; // closed the sheet
      setError("The share menu couldn't open. Use \"Download file\" below instead.");
    }
  };

  const unlockWithCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = normaliseDownloadCode(codeInput);
    if (!code) {
      setError("That doesn't look like a download code. It's the 64-character code you received with your purchase.");
      return;
    }
    setPhase("preparing");
    setError(null);
    try {
      await issueExternalDownloadGrant(offer.offerId, code); // checks the code against this offer
    } catch {
      setPhase("error");
      setError("That code doesn't match this license. Check the code for this offer and try again.");
      return;
    }
    storeExternalCredential(offer.offerId, code);
    setCredential(code);
    setCodeInput("");
    await prepareDownload(code);
  };

  // Start preparing as soon as the buyer lands here with access.
  useEffect(() => {
    if (!loaded || autoAttempted.current || !hasDownloadAccess) return;
    autoAttempted.current = true;
    void prepareDownload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, hasDownloadAccess]);

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
            <ContentPreview url={offer.preview_url ?? offer.contentUrl} title={offer.title} size="small" />
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
            {hasDownloadAccess && phase === "done" ? (
              <div className="rounded-lg border border-success bg-success-bg px-4 py-4" role="status" aria-live="polite">
                <p className="flex items-center gap-2 text-sm font-semibold text-success">
                  <CheckCircle size={18} /> {prepared?.file ? "Video saved" : "Download started"}
                </p>
                <p className="mt-1 text-sm text-text-secondary">{doneMessage}</p>
                {!prepared?.file && prepared?.url && (
                  <p className="mt-1 text-xs text-text-secondary">
                    Nothing happened?{" "}
                    <a href={prepared.url} className="font-medium text-brand underline" rel="noopener">
                      Download it here
                    </a>
                    .
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => (prepared?.file ? void saveWithShareSheet() : void prepareDownload())}
                  className="mt-3 text-sm font-medium text-brand underline underline-offset-2"
                >
                  {prepared?.file ? "Save it again" : "Download again"}
                </button>
              </div>
            ) : hasDownloadAccess ? (
              <>
                {phase === "ready" && prepared?.file ? (
                  <>
                    <Button fullWidth onClick={saveWithShareSheet}>
                      <Download size={16} className="mr-2" /> Save video
                    </Button>
                    <p className="mt-2 text-center text-xs text-text-secondary">
                      Choose <strong>Save Video</strong> to add it to Photos, or <strong>Save to Files</strong>.
                    </p>
                  </>
                ) : (
                  <Button fullWidth onClick={() => void prepareDownload()} disabled={phase === "preparing"}>
                    <Download size={16} className="mr-2" />
                    {phase === "preparing" ? "Preparing your video…" : phase === "ready" ? "Download again" : "Download Original (Unwatermarked)"}
                  </Button>
                )}
                {phase === "ready" && prepared && (
                  <p className="mt-2 text-center text-xs text-text-secondary">
                    {prepared.file ? "Prefer a file? " : "Your download should start automatically. If it didn't, "}
                    <a href={prepared.url} className="font-medium text-brand underline" rel="noopener">
                      {prepared.file ? "Download file" : "download it here"}
                    </a>
                    .
                  </p>
                )}
              </>
            ) : (
              <form onSubmit={unlockWithCode} className="space-y-3">
                <p className="text-sm font-semibold text-text-primary">Bought this license?</p>
                <p className="text-xs text-text-secondary">
                  Enter the download code you received with your purchase.
                </p>
                <input
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  placeholder="Download code"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-border px-3 py-2.5 font-mono text-sm text-text-primary focus:border-brand focus:outline-none"
                />
                <Button type="submit" fullWidth disabled={phase === "preparing" || !codeInput.trim()}>
                  <Download size={16} className="mr-2" />
                  {phase === "preparing" ? "Checking…" : "Unlock download"}
                </Button>
              </form>
            )}
            {error && (
              <p className="mt-2 text-sm text-red-600" role="alert">
                {error}
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
