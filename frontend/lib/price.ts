"use client";

import { useEffect, useState } from "react";

/** A fiat price in the currency's minor unit (KES cents). */
export interface FiatPrice {
  currency: string;
  amount_minor: number;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api";

/** Human price for an offer: the fiat price when set, otherwise sats. */
export function formatPrice(price: FiatPrice | null | undefined, sats: number | null | undefined): string {
  if (price) return formatFiat(price);
  if (typeof sats === "number") return `${sats.toLocaleString()} sats`;
  return "—";
}

export function formatFiat(price: FiatPrice): string {
  const major = price.amount_minor / 100;
  return `${price.currency} ${major.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
}

/** Whole sats for a fiat amount at a BTC price (both in minor units), rounded up like the server. */
export function fiatMinorToSats(amountMinor: number, btcPriceMinor: number): number {
  if (!(amountMinor > 0) || !(btcPriceMinor > 0)) return 0;
  return Math.ceil((amountMinor * 100_000_000) / btcPriceMinor);
}

export interface BtcRate {
  currency: string;
  btc_price_minor: number;
  fetched_at: number;
}

/**
 * Live BTC price for a currency from the licensing engine. Used only to show
 * an estimate; the server quotes the real sats amount when an invoice is made.
 */
export function useBtcRate(currency: string): BtcRate | null {
  const [rate, setRate] = useState<BtcRate | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL.replace(/\/$/, "")}/rates/${encodeURIComponent(currency)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled && body && typeof body.btc_price_minor === "number") setRate(body as BtcRate);
      })
      .catch(() => {
        /* The estimate is optional; the form works without it. */
      });
    return () => {
      cancelled = true;
    };
  }, [currency]);
  return rate;
}
