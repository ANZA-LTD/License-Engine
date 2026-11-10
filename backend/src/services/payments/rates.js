import { HttpError } from '../../utils/errors.js';

// Fiat-priced offers (for example KES) are paid over Lightning at the live BTC
// price. The price is always fetched server-side, so a buyer can never choose
// the exchange rate. Amounts stay integers: the BTC price is held in the
// currency's minor unit and the conversion rounds up to a whole satoshi, so the
// creator never receives less than the listed price.

const SATS_PER_BTC = 100_000_000n;
const SUPPORTED = new Set(['KES', 'USD', 'EUR', 'GBP', 'NGN', 'ZAR', 'UGX', 'TZS', 'GHS']);
// Currencies whose minor unit is not 1/100 of the major unit.
const MINOR_PER_MAJOR = { UGX: 1 };

export function minorPerMajor(currency) {
  return MINOR_PER_MAJOR[currency] ?? 100;
}

/** Converts a fiat amount in minor units to whole satoshis, rounding up. */
export function fiatMinorToSats(amountMinor, btcPriceMinor) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new TypeError('amountMinor must be a positive integer');
  if (!Number.isSafeInteger(btcPriceMinor) || btcPriceMinor <= 0) throw new TypeError('btcPriceMinor must be a positive integer');
  const numerator = BigInt(amountMinor) * SATS_PER_BTC;
  const denominator = BigInt(btcPriceMinor);
  const sats = (numerator + denominator - 1n) / denominator;
  const result = Number(sats);
  if (!Number.isSafeInteger(result)) throw new TypeError('Converted amount exceeds safe integer precision');
  return result;
}

/**
 * BTC price provider backed by a CoinGecko-compatible endpoint
 * (GET {url}?ids=bitcoin&vs_currencies=kes -> { bitcoin: { kes: 9876543.21 } }).
 * Results are cached per currency for ttlSeconds so a busy offer page does not
 * hit the upstream API on every view.
 */
export function createBtcRateProvider({ url = 'https://api.coingecko.com/api/v3/simple/price', ttlSeconds = 300,
  timeoutMs = 4000, fetch = globalThis.fetch, now = () => Math.floor(Date.now() / 1000) } = {}) {
  const cache = new Map();
  return {
    async getRate(currency) {
      const code = String(currency || '').toUpperCase();
      if (!SUPPORTED.has(code)) throw new HttpError(400, 'CURRENCY_UNSUPPORTED', 'This currency is not supported.');
      const cached = cache.get(code);
      if (cached && now() - cached.fetched_at < ttlSeconds) return cached;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let body;
      try {
        const response = await fetch(`${url}?ids=bitcoin&vs_currencies=${code.toLowerCase()}`, {
          headers: { Accept: 'application/json' }, signal: controller.signal
        });
        if (!response.ok) throw new Error(`rate source returned ${response.status}`);
        body = await response.json();
      } catch {
        // A stale rate is better than no Lightning option at all, but only briefly.
        if (cached && now() - cached.fetched_at < ttlSeconds * 6) return cached;
        throw new HttpError(503, 'RATE_UNAVAILABLE', 'The BTC exchange rate is temporarily unavailable.');
      } finally {
        clearTimeout(timer);
      }
      const major = Number(body?.bitcoin?.[code.toLowerCase()]);
      if (!Number.isFinite(major) || major <= 0) {
        throw new HttpError(503, 'RATE_UNAVAILABLE', 'The BTC exchange rate is temporarily unavailable.');
      }
      const rate = { currency: code, btc_price_minor: Math.round(major * minorPerMajor(code)), fetched_at: now() };
      cache.set(code, rate);
      return rate;
    }
  };
}

/** Resolves the satoshi amount a Lightning buyer pays for an offer's signed terms. */
export async function resolveOfferSats(terms, rateProvider) {
  if (Number.isSafeInteger(terms?.amount_sats) && terms.amount_sats > 0) return { amountSats: terms.amount_sats, rate: null };
  if (!terms?.price) throw new HttpError(409, 'OFFER_PRICE_MISSING', 'This offer has no price.');
  if (!rateProvider) throw new HttpError(503, 'RATE_UNAVAILABLE', 'Lightning pricing is not configured for fiat-priced offers.');
  const rate = await rateProvider.getRate(terms.price.currency);
  return { amountSats: fiatMinorToSats(terms.price.amount_minor, rate.btc_price_minor), rate };
}
