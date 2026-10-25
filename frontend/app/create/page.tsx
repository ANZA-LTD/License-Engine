import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { OfferForm } from "@/components/offer/OfferForm";
import { siteUrl } from "@/lib/site";
import { canCreateOfferFromUploadedVideo } from "@/lib/offerAccess";

// Offer-creation SEO: this page is a high-intent creator entry point and needs
// a clear title, description, and canonical URL for discoverability.
export const metadata: Metadata = {
  title: "Create a licensing offer",
  description:
    "Create a plain-language licensing offer for your content with usage rights, pricing, and payment terms.",
  alternates: { canonical: `${siteUrl}/create` },
  openGraph: {
    title: "Create a licensing offer",
    description:
      "Create a plain-language licensing offer for your content with usage rights, pricing, and payment terms.",
    url: `${siteUrl}/create`,
    siteName: "ANZA",
  },
  twitter: {
    card: "summary_large_image",
    title: "Create a licensing offer",
    description:
      "Create a plain-language licensing offer for your content with usage rights, pricing, and payment terms.",
  },
};

/**
 * Screen 2 — Creator Offer Form.
 *
 * The form reads `?videoId=` when the creator arrives from one of their own
 * video cards. `useSearchParams` requires a Suspense boundary during static
 * rendering, so the form is wrapped here rather than inside the form itself.
 */
export default function CreateOfferPage({
  searchParams,
}: {
  searchParams?: { videoId?: string };
}) {
  const videoId = searchParams?.videoId ?? "";

  if (!canCreateOfferFromUploadedVideo(videoId)) {
    return (
      <main>
        <Navbar backHref="/creator-profile" />
        <div className="mx-auto max-w-xl px-6 py-16">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            <p className="text-base font-semibold">
              Offers must be created from an uploaded video.
            </p>
            <p className="mt-2">
              A direct URL entry is not allowed. Upload a video in your library,
              then create the offer from that uploaded asset.
            </p>
            <Link
              href="/creator-profile"
              className="mt-4 inline-flex items-center rounded-xl bg-amber-700 px-4 py-2 font-semibold text-white hover:bg-amber-800"
            >
              Go to My Videos
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main>
      <Navbar backHref="/creator-profile" />
      <div className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-2xl font-bold text-text-primary">
          Create Licensing Offer
        </h1>
        <p className="mt-1 mb-8 text-sm text-text-secondary">
          Define how your content can be licensed.
        </p>
        <Suspense
          fallback={
            <p className="py-12 text-center text-sm text-text-secondary">
              Loading the offer form…
            </p>
          }
        >
          <OfferForm />
        </Suspense>
      </div>
    </main>
  );
}
