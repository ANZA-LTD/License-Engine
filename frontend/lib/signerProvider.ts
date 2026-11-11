"use client";

/**
 * Optional signer providers.
 *
 * Studio signs with a standard NIP-07 browser extension. An operator can
 * additionally plug in a signer by setting NEXT_PUBLIC_SIGNER_PROVIDER_URL to a
 * script that registers `window.ContentPortSigner`. The provider exposes the
 * same two calls as NIP-07 (getPublicKey, signEvent) plus optional hooks for
 * its own sign-in UI. Without the setting, Studio uses NIP-07 only.
 *
 * Whatever signs, the backend only ever receives public keys and signed
 * events, and verifies every signature itself.
 */

export interface UnsignedEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  pubkey?: string;
}
export interface SignedEvent extends UnsignedEvent {
  id: string;
  pubkey: string;
  sig: string;
}

export type ProviderSignerState = { status: "none" | "locked" | "ready"; pubkey?: string };

export interface SignerProvider {
  name: string;
  /** Resolves the public key, or rejects when nobody is signed in. */
  getPublicKey(): Promise<string>;
  signEvent(event: UnsignedEvent): Promise<SignedEvent>;
  /** Current state without prompting. */
  getState?(): ProviderSignerState;
  /** Called on every state change; returns an unsubscribe function. */
  subscribe?(listener: (state: ProviderSignerState) => void): () => void;
  /** Restores a previous session (no prompts). */
  restore?(): Promise<ProviderSignerState>;
  /** Renders the provider's own sign-in UI into the element; returns an unmount function. */
  mount?(element: HTMLElement, options: { mode: "signin"; createAccountUrl?: string }): () => void;
}

declare global {
  interface Window {
    ContentPortSigner?: SignerProvider;
  }
}

const PROVIDER_URL = process.env.NEXT_PUBLIC_SIGNER_PROVIDER_URL ?? "";
let loading: Promise<SignerProvider | null> | null = null;

function isProvider(value: unknown): value is SignerProvider {
  const candidate = value as SignerProvider | undefined;
  return Boolean(candidate && typeof candidate.getPublicKey === "function" && typeof candidate.signEvent === "function");
}

export function signerProviderConfigured(): boolean {
  return Boolean(PROVIDER_URL);
}

/** Loads the configured provider once. Resolves null when none is configured or it fails to load. */
export function loadSignerProvider(timeoutMs = 8000): Promise<SignerProvider | null> {
  if (typeof window === "undefined" || !PROVIDER_URL) return Promise.resolve(null);
  if (isProvider(window.ContentPortSigner)) return Promise.resolve(window.ContentPortSigner);
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
      resolve(isProvider(window.ContentPortSigner) ? window.ContentPortSigner : null);
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return loading;
}
