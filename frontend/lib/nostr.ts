/**
 * Nostr signing for ANZA Studio.
 *
 * Signing goes through the configured signer or a NIP-07 browser extension.
 * Either way the backend only receives the public key and signed events.
 */
import { confirmSigning, getSignerState, restoreSigner, sha256Hex, signEvent, type SignedEvent, type SignerState } from "./signer";

export type NostrEvent = SignedEvent;
export { sha256Hex };

/**
 * - "missing"   no identity on this device yet (sign in or create one)
 * - "locked"    the signer needs unlocking
 * - "connected" ready to sign
 */
export type SignerProbe =
  | { status: "missing" }
  | { status: "locked" }
  | { status: "connected"; pubkey: string };

export function toProbe(state: SignerState): SignerProbe {
  if (state.status === "ready") return { status: "connected", pubkey: state.pubkey };
  if (state.status === "locked") return { status: "locked" };
  return { status: "missing" };
}

export async function probeSigner(): Promise<SignerProbe> {
  if (typeof window === "undefined") return { status: "missing" };
  await restoreSigner();
  return toProbe(getSignerState());
}

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

/** Signs a request to the License Engine (NIP-98 style). Silent while the key is unlocked. */
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
  const event = await signEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags, content: "" });
  return `Nostr ${base64(JSON.stringify(event))}`;
}

/**
 * Signs the offer itself.
 */
export async function signOfferEvent({
  kind,
  terms,
  attestorPubkey,
}: {
  kind: number;
  terms: Record<string, unknown>;
  attestorPubkey: string;
}): Promise<NostrEvent> {
  if (!/^[0-9a-f]{64}$/.test(attestorPubkey)) {
    throw new Error("NEXT_PUBLIC_NOSTR_ATTESTOR_PUBKEY must be the backend attestor's 64-character lowercase hexadecimal public key.");
  }
  await confirmSigning();
  return signEvent({
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
