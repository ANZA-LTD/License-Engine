"use client";

import type { FiatPrice } from "./price";

/**
 * Optional external checkout providers.
 *
 * The licensing engine settles payments over Lightning on its own. An operator
 * can additionally plug in an external checkout by setting NEXT_PUBLIC_CHECKOUT_PROVIDER_URL to a script that
 * registers `window.ContentPortCheckout`. The provider runs its own payment
 * flow, reports the settled payment to the engine service-to-service, and
 * hands the buyer back a download credential. Without the setting, nothing
 * changes: offers are paid over Lightning only.
 */

export interface CheckoutOffer {
  offerId: string;
  title: string;
  creatorPubkey: string;
  price: FiatPrice | null;
  priceSats: number | null;
  acceptsLightning: boolean;
}

export interface CheckoutOption {
  /** Provider-defined id, passed back to start(). */
  id: string;
  /** Short button label, e.g. "Card". */
  label: string;
  /** One line shown under the label. */
  description?: string;
  /** Display price for this option, e.g. "KES 4,000". */
  priceLabel?: string;
}

export interface CheckoutResult {
  /** 64-hex credential the engine accepts in X-External-Credential. */
  credential: string;
}

export interface CheckoutProvider {
  name: string;
  /** Whether a creator is enrolled with this provider (affects the offer form). */
  isCreatorEnrolled?(creatorPubkey: string): Promise<boolean>;
  /** Payment options this provider offers for an offer; [] when it has none. */
  getOptions(offer: CheckoutOffer): Promise<CheckoutOption[]>;
  /** Runs the provider's payment UI. Rejects with a CheckoutCancelled error if the buyer closes it. */
  start(optionId: string, offer: CheckoutOffer): Promise<CheckoutResult>;
}

declare global {
  interface Window {
    ContentPortCheckout?: CheckoutProvider;
  }
}

const PROVIDER_URL = process.env.NEXT_PUBLIC_CHECKOUT_PROVIDER_URL ?? "";
let loading: Promise<CheckoutProvider | null> | null = null;

function isProvider(value: unknown): value is CheckoutProvider {
  const candidate = value as CheckoutProvider | undefined;
  return Boolean(candidate && typeof candidate.getOptions === "function" && typeof candidate.start === "function");
}

/** Loads the configured provider once. Resolves null when none is configured or it fails to load. */
export function loadCheckoutProvider(timeoutMs = 8000): Promise<CheckoutProvider | null> {
  if (typeof window === "undefined" || !PROVIDER_URL) return Promise.resolve(null);
  if (isProvider(window.ContentPortCheckout)) return Promise.resolve(window.ContentPortCheckout);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(PROVIDER_URL);
      if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("insecure");
    } catch {
      resolve(null);
      return;
    }
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    const script = document.createElement("script");
    script.src = url.href;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timer);
      resolve(isProvider(window.ContentPortCheckout) ? window.ContentPortCheckout : null);
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function isCheckoutCancelled(error: unknown): boolean {
  return error instanceof Error && (error.name === "CheckoutCancelled" || /cancel/i.test(error.message));
}

// The external credential lets the buyer download again later on this device.
const credentialKey = (offerId: string) => `contentport:external-credential:${offerId}`;

export function storeExternalCredential(offerId: string, credential: string) {
  if (!/^[0-9a-f]{64}$/.test(credential)) return;
  try {
    localStorage.setItem(credentialKey(offerId), credential);
  } catch {
    /* Storage can be unavailable (private mode); the current session still works. */
  }
}

export function getStoredExternalCredential(offerId: string): string | null {
  try {
    const value = localStorage.getItem(credentialKey(offerId));
    return value && /^[0-9a-f]{64}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}
