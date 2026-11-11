/**
 * Anza signer: the "built-in extension".
 *
 * Keep this file identical in ANZA Studio (License-Engine/frontend/lib/signer.ts)
 * and the Anza app (anza-user-interface/client/lib/signer.ts).
 *
 * A creator signs with one of three things:
 *
 *   local      A Nostr key created (or imported) on this device. It is stored
 *              only in locked form: under a passkey (fingerprint / face) and/or
 *              a recovery password. The unlocked key exists only in this tab's
 *              memory, and is never sent anywhere. Anza's servers receive the
 *              locked copy, which they cannot open, so the creator can sign in
 *              on another device.
 *   remote     The creator's own signer app (NIP-46, e.g. Amber or nsec.app).
 *              The key never touches Anza at all.
 *   extension  A NIP-07 browser extension (Alby, nos2x...).
 *
 * Whatever is used, Anza's servers only ever see the public key and signed
 * events, exactly as with an extension.
 */
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import * as nip49 from "nostr-tools/nip49";
import { BunkerSigner, parseBunkerInput, type BunkerPointer } from "nostr-tools/nip46";

export interface SignedEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}
export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  pubkey?: string;
}
export type SignerKind = "local" | "remote" | "extension";

export interface PasskeyBackup {
  credentialId: string;
  rpId: string;
  ciphertext: string;
}
/** The locked key as stored on this device and (for recovery) on Anza's servers. */
export interface LockedKey {
  pubkey: string;
  passkey?: PasskeyBackup;
  password?: string; // NIP-49 ncryptsec
}

export type SignerState =
  | { status: "none"; extensionAvailable: boolean }
  | { status: "locked"; kind: "local"; pubkey: string; hasPasskey: boolean; hasPassword: boolean; extensionAvailable: boolean }
  | { status: "ready"; kind: SignerKind; pubkey: string; hasPasskey: boolean; hasPassword: boolean; extensionAvailable: boolean };

interface NostrExtension {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<SignedEvent>;
}
declare global {
  interface Window {
    nostr?: NostrExtension;
  }
}

const STORE_KEY = "anza.signer.v1";
const PRF_SALT = new TextEncoder().encode("anza:nostr-key:prf:v1");
const HKDF_INFO = new TextEncoder().encode("anza:nostr-key:aes-gcm:v1");
const IDLE_LOCK_MS = 30 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 12;
const HEX64 = /^[0-9a-f]{64}$/;

export const CPBE_URL = (process.env.NEXT_PUBLIC_CPBE_URL || "https://creator-platform-be-172765911669.africa-south1.run.app").replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function b64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(value: string): Uint8Array {
  const s = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}
function ab(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function readStore(): { kind?: SignerKind; local?: LockedKey; remote?: { clientSecret: string; bunker: BunkerPointer; pubkey: string } } {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  } catch {
    return {};
  }
}
function writeStore(value: ReturnType<typeof readStore>) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    /* storage blocked: the creator signs in again next time */
  }
}

/** Accepts nsec1… or 64-char hex. Returns the 32-byte secret key or throws. */
export function parseSecretKey(input: string): Uint8Array {
  const value = input.trim();
  if (HEX64.test(value.toLowerCase())) return hexToBytes(value.toLowerCase());
  try {
    const decoded = nip19.decode(value);
    if (decoded.type === "nsec") return decoded.data as Uint8Array;
  } catch {
    /* fall through */
  }
  throw new Error("That doesn't look like a Nostr secret key. It should start with nsec1.");
}

export function encodeNpub(pubkey: string): string {
  return nip19.npubEncode(pubkey);
}
export function shortNpub(pubkey: string): string {
  const npub = encodeNpub(pubkey);
  return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
}

// ---------------------------------------------------------------------------
// Passkey (WebAuthn + PRF): turns a fingerprint / face check into a secret
// that only the creator's authenticator can produce.
// ---------------------------------------------------------------------------

/** The site a passkey belongs to. Set NEXT_PUBLIC_PASSKEY_RP_ID to share one passkey across Anza sites. */
export function passkeyRpId(): string {
  return process.env.NEXT_PUBLIC_PASSKEY_RP_ID || (typeof location !== "undefined" ? location.hostname : "");
}

export function passkeysAvailable(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && typeof window.PublicKeyCredential === "function";
}

export class PasskeyUnsupportedError extends Error {
  constructor() {
    super("This phone or browser can't lock your key with a passkey. Use a recovery password instead.");
  }
}

async function createPasskey(pubkey: string, label: string): Promise<{ credentialId: string; prf: Uint8Array | null }> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { id: passkeyRpId(), name: "Anza" },
      // The user handle is the Nostr public key, so signing in later tells us
      // which locked key to open without asking for a username.
      user: { id: ab(hexToBytes(pubkey)), name: label, displayName: label },
      challenge: ab(randomBytes(32)),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
      extensions: { prf: { eval: { first: ab(PRF_SALT) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("The passkey was not created.");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prf = (credential.getClientExtensionResults() as any).prf;
  if (!prf?.enabled && !prf?.results?.first) throw new PasskeyUnsupportedError();
  return {
    credentialId: b64url(new Uint8Array(credential.rawId)),
    prf: prf?.results?.first ? new Uint8Array(prf.results.first) : null,
  };
}

async function passkeyAssertion(credentialId?: string): Promise<{ credentialId: string; pubkey: string | null; prf: Uint8Array }> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: ab(randomBytes(32)),
      rpId: passkeyRpId(),
      userVerification: "required",
      allowCredentials: credentialId ? [{ type: "public-key", id: ab(fromB64url(credentialId)) }] : [],
      extensions: { prf: { eval: { first: ab(PRF_SALT) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("The passkey check was cancelled.");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prf = (assertion.getClientExtensionResults() as any).prf?.results?.first;
  if (!prf) throw new PasskeyUnsupportedError();
  const handle = (assertion.response as AuthenticatorAssertionResponse).userHandle;
  const pubkey = handle && handle.byteLength === 32 ? bytesToHex(new Uint8Array(handle)) : null;
  return { credentialId: b64url(new Uint8Array(assertion.rawId)), pubkey, prf: new Uint8Array(prf) };
}

async function aesKey(prf: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", ab(prf), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: ab(HKDF_INFO) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function lockWithPrf(secret: Uint8Array, pubkey: string, prf: Uint8Array): Promise<string> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: ab(iv), additionalData: ab(hexToBytes(pubkey)) }, await aesKey(prf), ab(secret));
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

export async function unlockWithPrf(ciphertext: string, pubkey: string, prf: Uint8Array): Promise<Uint8Array> {
  const [version, iv, ct] = ciphertext.split(".");
  if (version !== "v1" || !iv || !ct) throw new Error("Unrecognised key backup.");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ab(fromB64url(iv)), additionalData: ab(hexToBytes(pubkey)) },
    await aesKey(prf),
    ab(fromB64url(ct)),
  );
  return new Uint8Array(plain);
}

// ---------------------------------------------------------------------------
// The active signer
// ---------------------------------------------------------------------------

let unlocked: { pubkey: string; secret: Uint8Array } | null = null;
let remote: BunkerSigner | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(state: SignerState) => void>();

function extensionAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.nostr);
}

export function getSignerState(): SignerState {
  const ext = extensionAvailable();
  if (typeof window === "undefined") return { status: "none", extensionAvailable: false };
  const store = readStore();
  if (store.kind === "local" && store.local) {
    const flags = { hasPasskey: Boolean(store.local.passkey), hasPassword: Boolean(store.local.password), extensionAvailable: ext };
    return unlocked && unlocked.pubkey === store.local.pubkey
      ? { status: "ready", kind: "local", pubkey: store.local.pubkey, ...flags }
      : { status: "locked", kind: "local", pubkey: store.local.pubkey, ...flags };
  }
  if (store.kind === "remote" && store.remote) {
    return { status: "ready", kind: "remote", pubkey: store.remote.pubkey, hasPasskey: false, hasPassword: false, extensionAvailable: ext };
  }
  if (store.kind === "extension" && ext && extensionPubkey) {
    return { status: "ready", kind: "extension", pubkey: extensionPubkey, hasPasskey: false, hasPassword: false, extensionAvailable: ext };
  }
  return { status: "none", extensionAvailable: ext };
}

function emit() {
  const state = getSignerState();
  listeners.forEach((listener) => listener(state));
}

export function subscribeSigner(listener: (state: SignerState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function touch() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(lock, IDLE_LOCK_MS);
  // Outside a browser (tests, server rendering) don't keep the process alive.
  (idleTimer as unknown as { unref?: () => void }).unref?.();
}

function setUnlocked(pubkey: string, secret: Uint8Array) {
  if (getPublicKey(secret) !== pubkey) throw new Error("This key does not match your Anza identity.");
  unlocked = { pubkey, secret };
  touch();
}

/** Forgets the unlocked key in this tab. The locked copy stays on the device. */
export function lock() {
  if (unlocked) unlocked.secret.fill(0);
  unlocked = null;
  emit();
}

/** Signs out completely on this device: removes the locked copy and any signer connection. */
export async function forgetSigner() {
  lock();
  try {
    await remote?.close();
  } catch {
    /* already closed */
  }
  remote = null;
  extensionPubkey = null;
  writeStore({});
  emit();
}

// --- Create or import a key (local) ----------------------------------------

/**
 * Locks a key on this device with a passkey and/or a recovery password, and
 * makes it the active signer. Returns the locked copy to back up.
 */
async function adoptLocalKey(secret: Uint8Array, { usePasskey: withPasskey, password, label }: { usePasskey: boolean; password?: string; label: string }): Promise<LockedKey> {
  const pubkey = getPublicKey(secret);
  const locked: LockedKey = { pubkey };
  if (password !== undefined) {
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for your recovery password.`);
    locked.password = nip49.encrypt(secret, password, 16);
  }
  if (withPasskey) {
    if (!passkeysAvailable()) throw new PasskeyUnsupportedError();
    const created = await createPasskey(pubkey, label);
    // Some authenticators only evaluate PRF on sign-in, not at creation.
    const prf = created.prf ?? (await passkeyAssertion(created.credentialId)).prf;
    locked.passkey = { credentialId: created.credentialId, rpId: passkeyRpId(), ciphertext: await lockWithPrf(secret, pubkey, prf) };
  }
  if (!locked.passkey && !locked.password) throw new Error("Choose a passkey or a recovery password to protect your key.");
  writeStore({ kind: "local", local: locked });
  setUnlocked(pubkey, secret);
  emit();
  return locked;
}

/** Creates a brand-new Nostr identity on this device. */
export function createLocalKey(options: { usePasskey: boolean; password?: string; label: string }): Promise<LockedKey> {
  return adoptLocalKey(generateSecretKey(), options);
}

/** Brings an existing Nostr secret key (nsec) into Anza, locked the same way. */
export async function importLocalKey(nsec: string, options: { usePasskey: boolean; password?: string; label: string }): Promise<LockedKey> {
  return adoptLocalKey(parseSecretKey(nsec), options);
}

/** Adds a passkey (for example on a new device) to the unlocked key. */
export async function addPasskey(label: string): Promise<LockedKey> {
  const store = readStore();
  if (!unlocked || !store.local) throw new Error("Unlock your key first.");
  const created = await createPasskey(unlocked.pubkey, label);
  const prf = created.prf ?? (await passkeyAssertion(created.credentialId)).prf;
  store.local.passkey = { credentialId: created.credentialId, rpId: passkeyRpId(), ciphertext: await lockWithPrf(unlocked.secret, unlocked.pubkey, prf) };
  writeStore(store);
  emit();
  return store.local;
}

/** Adds or replaces the recovery password on the unlocked key. */
export function addPassword(password: string): LockedKey {
  const store = readStore();
  if (!unlocked || !store.local) throw new Error("Unlock your key first.");
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for your recovery password.`);
  store.local.password = nip49.encrypt(unlocked.secret, password, 16);
  writeStore(store);
  emit();
  return store.local;
}

// --- Unlock ------------------------------------------------------------------

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${CPBE_URL}${path}`, { ...init, headers: { "Content-Type": "application/json" } });
  if (!response.ok) {
    let message = "Anza could not be reached. Please try again.";
    try {
      message = (await response.json())?.error?.message ?? message;
    } catch {
      /* unparseable */
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

/**
 * Unlocks with fingerprint / face. Works on a new device too: the passkey
 * tells us the public key, and the locked copy is fetched from Anza.
 */
export async function unlockWithPasskey(): Promise<string> {
  if (!passkeysAvailable()) throw new PasskeyUnsupportedError();
  const store = readStore();
  const known = store.kind === "local" ? store.local?.passkey?.credentialId : undefined;
  const result = await passkeyAssertion(known);
  let local = store.kind === "local" && store.local?.passkey?.credentialId === result.credentialId ? store.local : undefined;
  if (!local) {
    if (!result.pubkey) throw new Error("This passkey isn't linked to an Anza identity.");
    const backup = await fetchJson<{ passkey: PasskeyBackup | null; hasPassword: boolean }>(`/api/creators/key-backup/${result.pubkey}`);
    if (!backup.passkey || backup.passkey.credentialId !== result.credentialId) throw new Error("This passkey isn't linked to an Anza identity.");
    local = { pubkey: result.pubkey, passkey: backup.passkey };
  }
  const secret = await unlockWithPrf(local.passkey!.ciphertext, local.pubkey, result.prf);
  writeStore({ kind: "local", local: { ...(store.local?.pubkey === local.pubkey ? store.local : {}), ...local } });
  setUnlocked(local.pubkey, secret);
  emit();
  return local.pubkey;
}

/**
 * Unlocks with the recovery password. On a new device the locked copy is
 * looked up by the email on the creator's Anza profile.
 */
export async function unlockWithPassword(password: string, email?: string): Promise<string> {
  const store = readStore();
  let local = store.kind === "local" && store.local?.password ? store.local : undefined;
  if (!local) {
    if (!email) throw new Error("Enter the email on your Anza profile.");
    const found = await fetchJson<{ pubkey: string; password: string }>("/api/creators/key-backup/recover", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    local = { pubkey: found.pubkey, password: found.password };
  }
  let secret: Uint8Array;
  try {
    secret = nip49.decrypt(local.password!, password);
  } catch {
    throw new Error("That recovery password is not correct.");
  }
  writeStore({ kind: "local", local: { ...(store.local?.pubkey === local.pubkey ? store.local : {}), ...local } });
  setUnlocked(local.pubkey, secret);
  emit();
  return local.pubkey;
}

/** Saves the locked copy to Anza so the creator can sign in on other devices. */
export async function backUpLockedKey(locked?: LockedKey): Promise<void> {
  const local = locked ?? readStore().local;
  if (!local) throw new Error("There is no Anza key on this device.");
  const backup: { passkey?: PasskeyBackup; password?: string } = {};
  if (local.passkey) backup.passkey = local.passkey;
  if (local.password) backup.password = local.password;
  const { challenge } = await fetchJson<{ challenge: string }>("/api/creators/challenge", { method: "POST" });
  const raw = JSON.stringify(backup);
  const proof = await signEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["u", "anza:key-backup"], ["challenge", challenge], ["payload", await sha256Hex(raw)]],
    content: "",
  });
  await fetchJson("/api/creators/key-backup", { method: "POST", body: `{"backup":${raw},"proof":${JSON.stringify(proof)}}` });
}

/** Lets the creator take their key elsewhere. Requires the key to be unlocked. */
export function exportSecretKey(): string {
  if (!unlocked) throw new Error("Unlock your key first.");
  touch();
  return nip19.nsecEncode(unlocked.secret);
}

// --- Remote signer (NIP-46) and extension -------------------------------------

/** Connects the creator's own signer app from a bunker:// link (or name@domain). */
export async function connectRemoteSigner(input: string): Promise<string> {
  const pointer = await parseBunkerInput(input.trim());
  if (!pointer) throw new Error("That isn't a signer link. It should start with bunker://");
  const clientSecret = generateSecretKey();
  const signer = BunkerSigner.fromBunker(clientSecret, pointer, {
    onauth: (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
  });
  await signer.connect({ name: "Anza", url: location.origin });
  const pubkey = await signer.getPublicKey();
  lock();
  remote = signer;
  writeStore({ kind: "remote", remote: { clientSecret: bytesToHex(clientSecret), bunker: pointer, pubkey } });
  emit();
  return pubkey;
}

function remoteSigner(): BunkerSigner {
  if (remote) return remote;
  const saved = readStore().remote;
  if (!saved) throw new Error("Connect your signer app first.");
  remote = BunkerSigner.fromBunker(hexToBytes(saved.clientSecret), saved.bunker, {
    onauth: (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
  });
  return remote;
}

let extensionPubkey: string | null = null;

/** Uses the NIP-07 browser extension, waiting at most a few seconds (a locked extension may never answer). */
export async function connectExtension(timeoutMs = 4000): Promise<string> {
  if (!extensionAvailable()) throw new Error("No Nostr browser extension was found.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Your Nostr extension didn't answer. Unlock it and try again.")), timeoutMs);
  });
  try {
    const pubkey = await Promise.race([window.nostr!.getPublicKey(), timeout]);
    if (!HEX64.test(pubkey)) throw new Error("Your Nostr extension returned an invalid key.");
    lock();
    extensionPubkey = pubkey;
    writeStore({ kind: "extension" });
    emit();
    return pubkey;
  } finally {
    clearTimeout(timer);
  }
}

/** Restores the extension connection after a reload, without prompting. */
export async function restoreSigner(): Promise<SignerState> {
  const store = readStore();
  if (store.kind === "extension" && extensionAvailable() && !extensionPubkey) {
    try {
      await connectExtension(2500);
    } catch {
      /* stays "none" until the creator connects */
    }
  }
  return getSignerState();
}

// --- Signing -----------------------------------------------------------------

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export function activePubkey(): string | null {
  const state = getSignerState();
  return state.status === "ready" ? state.pubkey : null;
}

/** Signs with whichever signer is active. Throws a readable error if none is. */
export async function signEvent(template: EventTemplate): Promise<SignedEvent> {
  const store = readStore();
  if (store.kind === "local") {
    if (!unlocked) throw new Error("Unlock your Anza key to continue.");
    touch();
    const { pubkey: _ignored, ...rest } = template;
    void _ignored;
    return finalizeEvent(rest, unlocked.secret) as SignedEvent;
  }
  if (store.kind === "remote") {
    const { pubkey: _ignored, ...rest } = template;
    void _ignored;
    return (await remoteSigner().signEvent(rest)) as SignedEvent;
  }
  if (store.kind === "extension" && extensionAvailable()) {
    const pubkey = extensionPubkey ?? (await window.nostr!.getPublicKey());
    return window.nostr!.signEvent({ ...template, pubkey });
  }
  throw new Error("Sign in to Anza to continue.");
}

/**
 * Asks the creator to confirm with fingerprint / face before a signature that
 * matters (publishing an offer). For remote signers and extensions, their own
 * approval screen does this job.
 */
export async function confirmWithPasskey(): Promise<void> {
  const local = readStore().local;
  if (readStore().kind !== "local" || !local?.passkey || !passkeysAvailable()) return;
  await passkeyAssertion(local.passkey.credentialId);
  touch();
}
