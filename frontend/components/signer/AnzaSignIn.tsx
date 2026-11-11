"use client";

/**
 * Anza sign-in: create, unlock or connect the creator's Nostr signer.
 *
 * Keep this file identical in ANZA Studio and the Anza app
 * (components/signer/AnzaSignIn.tsx). It only uses Tailwind classes and
 * lucide-react so it renders the same in both.
 */
import { useEffect, useState } from "react";
import { AlertCircle, Check, Fingerprint, KeyRound, Link2, Loader2, Lock, Puzzle } from "lucide-react";
import {
  MIN_PASSWORD_LENGTH,
  PasskeyUnsupportedError,
  addPasskey,
  backUpLockedKey,
  connectExtension,
  connectRemoteSigner,
  createLocalKey,
  exportSecretKey,
  forgetSigner,
  getSignerState,
  importLocalKey,
  lock,
  passkeysAvailable,
  restoreSigner,
  shortNpub,
  subscribeSigner,
  unlockWithPasskey,
  unlockWithPassword,
  type SignerState,
} from "@/lib/signer";

type View = "home" | "password-create" | "password-unlock" | "existing" | "import" | "remote";

const KIND_LABEL = { local: "Anza key on this device", remote: "your signer app", extension: "your browser extension" } as const;

const btn = "inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition disabled:opacity-60";
const primary = `${btn} bg-slate-900 text-white hover:bg-slate-800`;
const secondary = `${btn} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`;
const link = "text-sm font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900";
const input = "w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-slate-500 focus:outline-none";

export function AnzaSignIn({
  mode,
  onReady,
  createAccountUrl,
}: {
  /** "create": new creators can make an identity (Anza app). "signin": unlock or connect only (Studio). */
  mode: "create" | "signin";
  onReady?: (pubkey: string) => void;
  /** Where "New to Anza?" points in sign-in mode. */
  createAccountUrl?: string;
}) {
  const [state, setState] = useState<SignerState>({ status: "none", extensionAvailable: false });
  const [view, setView] = useState<View>("home");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [bunkerInput, setBunkerInput] = useState("");
  const [canPasskey, setCanPasskey] = useState(false);

  useEffect(() => {
    setCanPasskey(passkeysAvailable());
    void restoreSigner().then(setState);
    return subscribeSigner(setState);
  }, []);

  useEffect(() => {
    if (state.status !== "ready") return;
    onReady?.(state.pubkey);
    // Keep Anza's locked copy current (once per tab), so a backup that failed
    // at sign-up is retried and a newly added passkey reaches other devices.
    if (state.kind !== "local") return;
    const flag = `anza.backup.${state.pubkey}.${state.hasPasskey ? 1 : 0}${state.hasPassword ? 1 : 0}`;
    try {
      if (sessionStorage.getItem(flag)) return;
    } catch {
      return;
    }
    backUpLockedKey()
      .then(() => {
        try {
          sessionStorage.setItem(flag, "1");
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* retried next time */
      });
  }, [state, onReady]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await task();
      setPassword("");
      setConfirm("");
      setSecretInput("");
      setState(getSignerState());
    } catch (e) {
      if (e instanceof PasskeyUnsupportedError) {
        setView("password-create");
        setError(e.message);
      } else if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError")) {
        setError("The fingerprint / face check was cancelled. Try again when you're ready.");
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const backUp = async (locked: Awaited<ReturnType<typeof createLocalKey>>) => {
    try {
      await backUpLockedKey(locked);
    } catch {
      setNotice("Your key is safe on this device, but the backup to Anza didn't go through. We'll try again next time you sign in.");
    }
  };

  const checkPassword = () => {
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (password !== confirm) throw new Error("The two passwords don't match.");
  };

  const label = "Anza creator";

  // ---- Signed in ----------------------------------------------------------
  if (state.status === "ready") {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
          <Check size={16} /> Signed in as <code className="font-mono text-xs text-slate-700">{shortNpub(state.pubkey)}</code>
        </p>
        <p className="text-xs text-slate-500">Signing with {KIND_LABEL[state.kind]}.</p>
        {notice && <p className="text-xs text-amber-700">{notice}</p>}
        {error && <ErrorLine message={error} />}
        {state.kind === "local" && !state.hasPasskey && canPasskey && (
          <button type="button" className={secondary} disabled={busy} onClick={() => run(async () => { await backUp(await addPasskey(label)); })}>
            <Fingerprint size={16} /> Turn on fingerprint / face unlock on this device
          </button>
        )}
        <div className="flex gap-4">
          {state.kind === "local" && (
            <button type="button" className={link} onClick={lock}>Lock</button>
          )}
          {state.kind === "local" && (
            <button
              type="button"
              className={link}
              onClick={() => {
                if (!window.confirm("Your secret key gives full control of your identity. Only copy it into a signer you trust, and never share it. Show it now?")) return;
                window.prompt("Your Nostr secret key (keep it private):", exportSecretKey());
              }}
            >
              Export key
            </button>
          )}
          <button
            type="button"
            className={link}
            onClick={() => {
              if (state.kind !== "local" || window.confirm("Sign out on this device? You can sign back in with your fingerprint / face or recovery password.")) void forgetSigner();
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  // ---- Locked key on this device -------------------------------------------
  if (state.status === "locked" && view !== "password-unlock") {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm text-slate-700">
          <Lock size={16} /> Your Anza key <code className="font-mono text-xs">{shortNpub(state.pubkey)}</code> is locked.
        </p>
        {error && <ErrorLine message={error} />}
        {state.hasPasskey && canPasskey && (
          <button type="button" className={primary} disabled={busy} onClick={() => run(async () => { await unlockWithPasskey(); })}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={16} />} Unlock with fingerprint / face
          </button>
        )}
        {state.hasPassword && (
          <button type="button" className={state.hasPasskey && canPasskey ? secondary : primary} onClick={() => { setError(null); setView("password-unlock"); }}>
            <KeyRound size={16} /> Use recovery password
          </button>
        )}
        <button type="button" className={link} onClick={() => void forgetSigner()}>Use a different identity</button>
      </div>
    );
  }

  // ---- Password unlock (this device or a new one) ----------------------------
  if (view === "password-unlock") {
    const needsEmail = state.status !== "locked";
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => { await unlockWithPassword(password, needsEmail ? email : undefined); });
        }}
      >
        <p className="text-sm text-slate-700">Enter the recovery password you chose when you joined Anza.</p>
        {needsEmail && <input className={input} type="email" autoComplete="email" placeholder="Email on your Anza profile" value={email} onChange={(e) => setEmail(e.target.value)} required />}
        <input className={input} type="password" autoComplete="current-password" placeholder="Recovery password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <ErrorLine message={error} />}
        <button type="submit" className={primary} disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} {busy ? "Unlocking… (this takes a few seconds)" : "Unlock"}
        </button>
        <button type="button" className={link} onClick={() => { setError(null); setView("home"); }}>Back</button>
      </form>
    );
  }

  // ---- Create with password (no passkey on this device, or by choice) ---------
  if (view === "password-create") {
    const importing = Boolean(secretInput);
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            checkPassword();
            const options = { usePasskey: false, password, label };
            await backUp(importing ? await importLocalKey(secretInput, options) : await createLocalKey(options));
          });
        }}
      >
        <p className="text-sm text-slate-700">
          {importing ? "Your key will be locked with this password. " : ""}Choose a recovery password. It locks your key on this device, and lets you sign in on another phone or computer.
          Anza can't see it or reset it, so keep it somewhere safe.
        </p>
        <input className={input} type="password" autoComplete="new-password" placeholder={`Recovery password (${MIN_PASSWORD_LENGTH}+ characters)`} value={password} onChange={(e) => setPassword(e.target.value)} required />
        <input className={input} type="password" autoComplete="new-password" placeholder="Type it again" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {error && <ErrorLine message={error} />}
        <button type="submit" className={primary} disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} {busy ? "Securing your key…" : "Create my identity"}
        </button>
        <button type="button" className={link} onClick={() => { setError(null); setSecretInput(""); setView("home"); }}>Back</button>
      </form>
    );
  }

  // ---- Bring an existing key -------------------------------------------------
  if (view === "existing") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-700">How do you sign with your Nostr identity today?</p>
        {error && <ErrorLine message={error} />}
        <button type="button" className={secondary} onClick={() => { setError(null); setView("remote"); }}>
          <Link2 size={16} /> A signer app (Amber, nsec.app…)
        </button>
        {state.extensionAvailable && (
          <button type="button" className={secondary} disabled={busy} onClick={() => run(async () => { await connectExtension(); })}>
            <Puzzle size={16} /> My browser extension
          </button>
        )}
        <button type="button" className={secondary} onClick={() => { setError(null); setView("import"); }}>
          <KeyRound size={16} /> Paste my secret key (nsec)
        </button>
        <button type="button" className={link} onClick={() => { setError(null); setView("home"); }}>Back</button>
      </div>
    );
  }

  if (view === "remote") {
    return (
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => { await connectRemoteSigner(bunkerInput); }); }}>
        <p className="text-sm text-slate-700">
          In your signer app, create a connection and copy its <strong>bunker://</strong> link, then paste it here.
          Each signature request will appear in your signer app for you to approve. Your key stays in that app.
        </p>
        <input className={input} placeholder="bunker://…" value={bunkerInput} onChange={(e) => setBunkerInput(e.target.value)} required autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        {error && <ErrorLine message={error} />}
        <button type="submit" className={primary} disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />} {busy ? "Waiting for your signer app…" : "Connect"}
        </button>
        <button type="button" className={link} onClick={() => { setError(null); setView("existing"); }}>Back</button>
      </form>
    );
  }

  if (view === "import") {
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canPasskey) {
            setView("password-create");
            return;
          }
          void run(async () => {
            await backUp(await importLocalKey(secretInput, { usePasskey: true, label }));
          });
        }}
      >
        <p className="text-sm text-slate-700">
          Paste your secret key. It is locked on this device with your fingerprint / face and is never sent to Anza unlocked.
        </p>
        <input className={input} type="password" placeholder="nsec1…" value={secretInput} onChange={(e) => setSecretInput(e.target.value)} required autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        {error && <ErrorLine message={error} />}
        <button type="submit" className={primary} disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={16} />} Lock it with fingerprint / face
        </button>
        <button type="button" className={link} onClick={() => { if (secretInput) { setError(null); setView("password-create"); } }}>Use a password instead</button>
        <button type="button" className={link} onClick={() => { setError(null); setView("existing"); }}>Back</button>
      </form>
    );
  }

  // ---- Home ------------------------------------------------------------------
  return (
    <div className="space-y-3">
      {error && <ErrorLine message={error} />}
      {mode === "create" && (
        <>
          <button
            type="button"
            className={primary}
            disabled={busy}
            onClick={() => run(async () => {
              if (!canPasskey) {
                setView("password-create");
                return;
              }
              await backUp(await createLocalKey({ usePasskey: true, label }));
            })}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={16} />} Create my Anza identity
          </button>
          <p className="text-xs text-slate-500">
            Your identity is created on this phone and locked with your fingerprint or face. No extension or extra app needed.
          </p>
          <button type="button" className={link} onClick={() => { setError(null); setView("password-create"); }}>Use a password instead</button>
          <div className="my-2 border-t border-slate-200" />
        </>
      )}
      <p className="text-sm font-medium text-slate-700">{mode === "create" ? "Already have an identity?" : "Sign in to Anza"}</p>
      {canPasskey && (
        <button type="button" className={mode === "create" ? secondary : primary} disabled={busy} onClick={() => run(async () => { await unlockWithPasskey(); })}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={16} />} Sign in with fingerprint / face
        </button>
      )}
      <button type="button" className={secondary} onClick={() => { setError(null); setView("password-unlock"); }}>
        <KeyRound size={16} /> Sign in with recovery password
      </button>
      <button type="button" className={secondary} onClick={() => { setError(null); setView("existing"); }}>
        <Link2 size={16} /> Use my own Nostr signer or key
      </button>
      {mode === "signin" && createAccountUrl && (
        <p className="pt-1 text-xs text-slate-500">
          New to Anza? <a className="font-medium underline" href={createAccountUrl}>Create your account</a>
        </p>
      )}
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-2 text-sm text-red-700" role="alert">
      <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{message}</span>
    </p>
  );
}
