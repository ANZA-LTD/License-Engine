import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "How creators find brand gigs | ANZA",
  description:
    "Learn how creators can package their work, show rights clearly, and make it easy for brands to hire them without endless back-and-forth.",
  alternates: { canonical: `${siteUrl}/guides/brand-gigs` },
  openGraph: {
    title: "How creators find brand gigs | ANZA",
    description:
      "Learn how creators can package their work, show rights clearly, and make it easy for brands to hire them without endless back-and-forth.",
    url: `${siteUrl}/guides/brand-gigs`,
    siteName: "ANZA",
  },
  twitter: {
    card: "summary_large_image",
    title: "How creators find brand gigs | ANZA",
    description:
      "Learn how creators can package their work, show rights clearly, and make it easy for brands to hire them without endless back-and-forth.",
  },
};

export default function BrandGigsGuidePage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "How creators find brand gigs",
    description:
      "A practical guide to helping creators show their work clearly, explain rights, and get more straightforward brand inquiries.",
    author: {
      "@type": "Organization",
      name: "ANZA",
      url: siteUrl,
    },
    publisher: {
      "@type": "Organization",
      name: "ANZA",
      url: siteUrl,
      logo: `${siteUrl}/images/Dynamic%20ANZA%20Media%20Logo.png`,
    },
    datePublished: "2026-10-25",
    dateModified: "2026-10-25",
    mainEntityOfPage: `${siteUrl}/guides/brand-gigs`,
  };

  return (
    <>
      <JsonLd data={jsonLd} />
      <main className="mx-auto max-w-3xl px-4 py-12 text-slate-800 sm:px-6">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-slate-500">
          <Link href="/" className="hover:text-slate-700">
            Home
          </Link>
          <span className="mx-2">/</span>
          <Link href="/guides" className="hover:text-slate-700">
            Guides
          </Link>
          <span className="mx-2">/</span>
          <span aria-current="page">Brand gigs</span>
        </nav>

        <article>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">
            Guide
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-900">
            How creators find brand gigs
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            Brand gigs happen when a creator makes it easy to understand what
            they can license, for how long, and at what price — without a long
            back-and-forth.
          </p>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
            <strong className="font-semibold text-slate-900">
              Quick answer:
            </strong>{" "}
            the easiest way to get found is to share a clear offer that explains
            the content, the usage rights, the price, and the verification
            trail. Brands want fewer unknowns and less guesswork.
          </div>

          <h2 className="mt-10 text-2xl font-bold text-slate-900">
            What brands look for
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-700">
            <li>What the creator actually owns or controls.</li>
            <li>
              What the license includes: duration, geography, channels, and
              exclusivity.
            </li>
            <li>What the brand pays and when.</li>
            <li>Whether the offer is tied to a verifiable record.</li>
          </ul>

          <h2 className="mt-10 text-2xl font-bold text-slate-900">
            How to make a better offer
          </h2>
          <ol className="mt-4 list-decimal space-y-3 pl-6 text-slate-700">
            <li>Use a clear title and short description of the asset.</li>
            <li>Show the relevant usage terms up front, not hidden in a DM.</li>
            <li>State the price in a simple way, like a fixed license fee.</li>
            <li>
              Link to a public record or proof that the offer was published.
            </li>
          </ol>

          <h2 className="mt-10 text-2xl font-bold text-slate-900">
            Sample clause
          </h2>
          <p className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-slate-700">
            “This license grants Brand X the right to use the referenced video
            in paid social media ads for 90 days in the United States, excluding
            any exclusive rights, with a fee of 5000 sats payable before public
            distribution."
          </p>

          <h2 className="mt-10 text-2xl font-bold text-slate-900">
            How ANZA helps
          </h2>
          <p className="mt-4 text-slate-700">
            ANZA gives creators a public licensing offer with pricing and terms
            in one place. That makes it easier to share a direct link with a
            brand, rather than sending a message and hoping the details are
            remembered later.
          </p>

          <div className="mt-10 rounded-2xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-900">
            <p className="font-semibold">Checklist</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Clear title and short description.</li>
              <li>Usage rights spelled out.</li>
              <li>Price and payment terms visible.</li>
              <li>Public proof of the offer or record.</li>
            </ul>
          </div>

          <div className="mt-10 border-t border-slate-200 pt-6 text-sm text-slate-500">
            <p>Author: ANZA</p>
            <p>Last updated: October 25, 2026</p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3 text-sm">
            <Link
              href="/guides/usage-rights"
              className="text-blue-700 hover:text-blue-800"
            >
              Next: Usage rights
            </Link>
            <Link href="/create" className="text-blue-700 hover:text-blue-800">
              Create an offer
            </Link>
          </div>
        </article>
      </main>
    </>
  );
}
