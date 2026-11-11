"use client";

/**
 * Sign-in prompt. Shows the configured signer provider's own sign-in UI when
 * it has one; otherwise explains how to use a NIP-07 browser extension.
 */
import { useEffect, useRef, useState } from "react";
import { loadSignerProvider, type SignerProvider } from "@/lib/signerProvider";
import { SIGNUP_URL } from "@/lib/site";

export function SignInPanel({ onRetry, retrying = false, locked = false }: { onRetry?: () => void; retrying?: boolean; locked?: boolean }) {
  const [provider, setProvider] = useState<SignerProvider | null | undefined>(undefined);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadSignerProvider().then(setProvider);
  }, []);

  useEffect(() => {
    if (!provider?.mount || !host.current) return;
    return provider.mount(host.current, { mode: "signin", createAccountUrl: SIGNUP_URL || undefined });
  }, [provider]);

  if (provider === undefined) return <p className="text-sm text-text-secondary">Loading sign-in…</p>;
  if (provider?.mount) return <div ref={host} />;

  return (
    <div className="text-sm text-amber-800">
      <p className="font-medium">
        {locked ? "Your Nostr extension is installed but not ready yet." : "A Nostr signer is required."}
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-amber-700">
        <li>
          Install a NIP-07 Nostr extension such as{" "}
          <a href="https://getalby.com" target="_blank" rel="noopener noreferrer" className="font-medium underline">Alby</a>,{" "}
          <a href="https://getflamingo.org" target="_blank" rel="noopener noreferrer" className="font-medium underline">Flamingo</a> or nos2x.
        </li>
        <li>Create or import an account in it, then unlock it.</li>
        <li>Allow it to access this site.</li>
      </ol>
      <p className="mt-2 text-amber-700">Your key never reaches this app. Signing happens inside the extension.</p>
      {SIGNUP_URL && (
        <p className="mt-2 text-amber-700">
          New here? <a href={SIGNUP_URL} className="font-medium underline">Create an account</a>
        </p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-3 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
        >
          {retrying ? "Checking…" : "Retry"}
        </button>
      )}
    </div>
  );
}
