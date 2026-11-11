"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Smartphone, Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Offer } from "@/lib/types";
import { formatPrice } from "@/lib/price";
import {
  CheckoutOffer,
  CheckoutOption,
  CheckoutProvider,
  isCheckoutCancelled,
  loadCheckoutProvider,
  storeExternalCredential,
} from "@/lib/checkout";
import { issueExternalDownloadGrant, persistDownloadGrant } from "@/lib/api";

type Choice =
  | { kind: "lightning" }
  | { kind: "provider"; option: CheckoutOption };

/**
 * Purchase control for the public offer page. Lists every way this offer can be
 * paid: the configured external checkout's options
 * and Bitcoin Lightning when the offer carries a Lightning Address. External
 * checkouts run in place on this page; Lightning keeps its own invoice page.
 */
export function PurchaseOptions({ offer, resume = false }: { offer: Offer; resume?: boolean }) {
  const router = useRouter();
  const [provider, setProvider] = useState<CheckoutProvider | null>(null);
  const [options, setOptions] = useState<CheckoutOption[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const acceptsLightning = Boolean(offer.creatorLightningAddress);
  const checkoutOffer: CheckoutOffer = {
    offerId: offer.offerId,
    title: offer.title,
    creatorPubkey: offer.creatorPubkey,
    price: offer.price,
    priceSats: offer.priceSats,
    acceptsLightning,
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadCheckoutProvider();
      if (cancelled) return;
      setProvider(loaded);
      if (!loaded) {
        setOptions([]);
        return;
      }
      try {
        const found = await loaded.getOptions(checkoutOffer);
        if (!cancelled) setOptions(found);
      } catch {
        if (!cancelled) setOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.offerId]);

  async function choose(choice: Choice) {
    setError(null);
    if (choice.kind === "lightning") {
      router.push(`/offers/${offer.offerId}/pay`);
      return;
    }
    if (!provider) return;
    setBusy(choice.option.id);
    try {
      const { credential } = await provider.start(choice.option.id, checkoutOffer);
      storeExternalCredential(offer.offerId, credential);
      const grant = await issueExternalDownloadGrant(offer.offerId, credential);
      persistDownloadGrant(offer.offerId, grant.grantToken, grant.expiresAt);
      // Same page, now in its licensed state with the download ready.
      window.location.href = `/offers/${offer.offerId}?grantToken=${grant.grantToken}`;
    } catch (cause) {
      if (!isCheckoutCancelled(cause)) {
        setError(cause instanceof Error ? cause.message : "The payment could not be completed. Please try again.");
      }
      setBusy(null);
    }
  }

  if (options === null) {
    return (
      <div className="mt-6 flex items-center justify-center gap-2 text-sm text-text-secondary">
        <Loader2 size={16} className="animate-spin" /> Loading payment options…
      </div>
    );
  }

  const choices: { key: string; choice: Choice; label: string; description: string; icon: React.ReactNode }[] = [
    ...options.map((option) => ({
      key: `provider:${option.id}`,
      choice: { kind: "provider", option } as Choice,
      label: option.label,
      description: option.description ?? "",
      icon: <Smartphone size={18} />,
    })),
    ...(acceptsLightning
      ? [{
          key: "lightning",
          choice: { kind: "lightning" } as Choice,
          label: resume ? "Resume Bitcoin Lightning payment" : "Bitcoin (Lightning)",
          description: offer.price ? "Pay the live sats equivalent from any Lightning wallet." : "Pay from any Lightning wallet.",
          icon: <Zap size={18} />,
        }]
      : []),
  ];

  if (choices.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Payments for this offer are temporarily unavailable. Please try again later.
      </div>
    );
  }

  // A single Lightning option keeps the original one-button experience.
  if (choices.length === 1 && choices[0].choice.kind === "lightning") {
    return (
      <Button fullWidth className="mt-6" variant={resume ? "secondary" : undefined} onClick={() => choose(choices[0].choice)}>
        {resume ? "Resume payment" : "Purchase License"}
      </Button>
    );
  }

  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-text-primary">Choose how to pay</p>
        <p className="text-sm font-bold text-text-primary">{formatPrice(offer.price, offer.priceSats)}</p>
      </div>
      <div className="mt-3 space-y-3">
        {choices.map(({ key, choice, label, description, icon }) => (
          <button
            key={key}
            type="button"
            disabled={busy !== null}
            onClick={() => choose(choice)}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-white px-4 py-3 text-left transition hover:border-brand hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-brand">{icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-text-primary">{label}</span>
              {description && <span className="block text-xs text-text-secondary">{description}</span>}
            </span>
            {busy !== null && choice.kind === "provider" && busy === choice.option.id && (
              <Loader2 size={16} className="animate-spin text-text-secondary" />
            )}
          </button>
        ))}
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
