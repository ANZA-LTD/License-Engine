/**
 * Nostr signing for ANZA Studio.
 *
 * Signs with a configured signer provider (lib/signerProvider.ts) when one is
 * set, otherwise with a NIP-07 browser extension. Private keys never reach
 * this app or the backend: only public keys and signed events do.
 */
import { loadSignerProvider, type ProviderSignerState, type SignedEvent, type SignerProvider, type UnsignedEvent } from "./signerProvider";

export type NostrEvent = SignedEvent;

interface NostrExtension {
  getPublicKey(): Promise<string>;
  signEvent(event: UnsignedEvent): Promise<NostrEvent>;
}

declare global {
  interface Window {
    nostr?: NostrExtension;
  }
}

/**
 * - "missing"   no signer available (or nobody signed in to the provider)
 * - "locked"    a signer is present but not ready (locked extension or key)
 * - "connected" ready to sign as pubkey
 */
export type SignerProbe =
  | { status: "missing" }
  | { status: "locked" }
  | { status: "connected"; pubkey: string };

const HEX64 = /^[0-9a-f]{64}$/;
const SIGNER_PROBE_TIMEOUT_MS = 2500;

export function toProbe(state: ProviderSignerState | null | undefined): SignerProbe {
  if (state?.status === "ready" && state.pubkey && HEX64.test(state.pubkey)) return { status: "connected", pubkey: state.pubkey };
  if (state?.status === "locked") return { status: "locked" };
  return { status: "missing" };
}

async function providerState(provider: SignerProvider): Promise<ProviderSignerState> {
  if (provider.restore) return provider.restore();
  if (provider.getState) return provider.getState();
  try {
    return { status: "ready", pubkey: await provider.getPublicKey() };
  } catch {
    return { status: "none" };
  }
}

/** Probes the NIP-07 extension; a locked one may never answer, so this is time-limited. */
async function probeExtension(timeoutMs: number): Promise<SignerProbe> {
  if (typeof window === "undefined" || !window.nostr) return { status: "missing" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = Symbol("timeout");
  const timeout = new Promise<typeof expired>((resolve) => {
    timer = setTimeout(() => resolve(expired), timeoutMs);
  });
  const query = window.nostr.getPublicKey().then((pubkey) => ({ pubkey })).catch(() => ({ pubkey: null as string | null }));
  try {
    const result = await Promise.race([query, timeout]);
    if (result === expired) return { status: "locked" };
    const pubkey = (result as { pubkey: string | null }).pubkey;
    return typeof pubkey === "string" && HEX64.test(pubkey) ? { status: "connected", pubkey } : { status: "locked" };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeSigner(timeoutMs: number = SIGNER_PROBE_TIMEOUT_MS): Promise<SignerProbe> {
  if (typeof window === "undefined") return { status: "missing" };
  const provider = await loadSignerProvider();
  if (provider) return toProbe(await providerState(provider));
  return probeExtension(timeoutMs);
}

/** Notifies on sign-in / sign-out when the provider supports it. */
export function subscribeSigner(listener: (probe: SignerProbe) => void): () => void {
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;
  void loadSignerProvider().then((provider) => {
    if (cancelled || !provider?.subscribe) return;
    unsubscribe = provider.subscribe((state) => listener(toProbe(state)));
  });
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

async function sign(template: Omit<UnsignedEvent, "pubkey">): Promise<NostrEvent> {
  const provider = await loadSignerProvider();
  if (provider) {
    const state = await providerState(provider);
    if (state.status === "ready") return provider.signEvent(template);
  }
  if (typeof window !== "undefined" && window.nostr) {
    return window.nostr.signEvent({ ...template, pubkey: await window.nostr.getPublicKey() });
  }
  throw new Error(provider ? "Sign in to continue." : "A NIP-07 Nostr signer is required. Install and unlock a Nostr browser extension, then try again.");
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

/** Signs a request to the License Engine (NIP-98 style). */
export async function signHttpAuthorization({
  method,
  url,
  body = "",
  idempotencyKey,
}: {
  method: "GET" | "POST" | "DELETE";
  url: string;
  body?: string;
  idempotencyKey?: string;
}): Promise<string> {
  const tags: string[][] = [["u", url], ["method", method]];
  if (method === "POST") {
    if (!idempotencyKey) throw new Error("An idempotency key is required for POST requests.");
    tags.push(["payload", await sha256Hex(body)]);
    tags.push(["contentport-idempotency-key", idempotencyKey]);
  }
  const event = await sign({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags, content: "" });
  return `Nostr ${base64(JSON.stringify(event))}`;
}

export async function signOfferEvent({
  kind,
  terms,
  attestorPubkey,
}: {
  kind: number;
  terms: Record<string, unknown>;
  attestorPubkey: string;
}): Promise<NostrEvent> {
  if (!HEX64.test(attestorPubkey)) {
    throw new Error("NEXT_PUBLIC_NOSTR_ATTESTOR_PUBKEY must be the backend attestor's 64-character lowercase hexadecimal public key.");
  }
  return sign({
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["t", "contentport-offer-v1"]],
    content: JSON.stringify({
      schema: "contentport.offer.v1",
      terms,
      attestor_pubkey: attestorPubkey,
    }),
  });
}
