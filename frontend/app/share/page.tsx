"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";

/**
 * Web Share Target receiving route.
 *
 * Web Share Target API (Android/Chrome PWA) delivers shared data via query
 * params. This route validates the incoming payload and routes the creator
 * into the appropriate workflow. The first version only handles shared URLs;
 * receiving a URL is not the same as importing the underlying media, so we
 * guide the creator to upload the original content.
 */
function ShareReceiver() {
  const params = useSearchParams();
  const title = params.get("title") ?? "";
  const text = params.get("text") ?? "";
  const url = params.get("url") ?? "";

  const validUrl = (() => {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      return parsed.toString();
    } catch {
      return null;
    }
  })();

  if (!validUrl) {
    return (
      <main>
        <Navbar backHref="/" />
        <div className="mx-auto max-w-xl px-6 py-16">
          <h1 className="text-2xl font-bold text-text-primary">Shared content</h1>
          <p className="mt-2 text-sm text-text-secondary">
            The shared content reference was missing or invalid. No action was
            taken.
          </p>
          <Link
            href="/creator-profile"
            className="mt-4 inline-flex items-center rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
          >
            Go to My Videos
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main>
      <Navbar backHref="/" />
      <div className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-2xl font-bold text-text-primary">Shared link received</h1>
        <p className="mt-2 text-sm text-text-secondary">
          {title ? `${title} — ` : ""}
          A shared URL was received. Importing the underlying video is not
          automatic: some platforms restrict access to media files. Upload the
          original content to Anza to continue.
        </p>
        <a
          href={validUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block break-all text-sm text-blue-600 underline"
        >
          {validUrl}
        </a>
        {text ? (
          <p className="mt-2 text-xs text-text-secondary">{text}</p>
        ) : null}
        <div className="mt-6 flex gap-3">
          <Link
            href="/creator-profile"
            className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
          >
            Upload to Anza
          </Link>
          <Link
            href="/"
            className="inline-flex items-center rounded-xl border border-gray-300 px-4 py-2 font-semibold text-text-primary hover:bg-gray-50"
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function SharePage() {
  return (
    <Suspense fallback={<div className="p-8">Loading shared content…</div>}>
      <ShareReceiver />
    </Suspense>
  );
}
