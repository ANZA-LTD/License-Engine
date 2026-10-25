import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Usage rights for creator content | ANZA",
  description:
    "Understand usage rights, duration, exclusivity, paid ads, and whitelisting before a brand uses your content.",
  alternates: { canonical: `${siteUrl}/guides/usage-rights` },
  openGraph: {
    title: "Usage rights for creator content | ANZA",
    description:
      "Understand usage rights, duration, exclusivity, paid ads, and whitelisting before a brand uses your content.",
    url: `${siteUrl}/guides/usage-rights`,
    siteName: "ANZA",
  },
  twitter: {
    card: "summary_large_image",
    title: "Usage rights for creator content | ANZA",
    description:
      "Understand usage rights, duration, exclusivity, paid ads, and whitelisting before a brand uses your content.",
  },
};

export default function UsageRightsGuidePage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Usage rights for creator content",
    description:
      "A plain-language guide to usage rights, exclusivity, ad usage, and whitelisting for creator licensing deals.",
    author: { "@type": "Organization", name: "ANZA", url: siteUrl },
    publisher: {
      "@type": "Organization",
      name: "ANZA",
      url: siteUrl,
      logo: `${siteUrl}/images/Dynamic%20ANZA%20Media%20Logo.png`,
    },
    datePublished: "2026-10-25",
    dateModified: "2026-10-25",
    mainEntityOfPage: `${siteUrl}/guides/usage-rights`,
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
          <span aria-current="page">Usage rights</span>
        </nav>

        <article>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">
            Guide
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-900">
            Usage rights for creator content
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            A creator should never assume the brand can use the content in every
            way just because they paid once. Usage rights should be clear before
            any work is created.
          </p>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
            <strong className="font-semibold text-slate-900">
              Quick answer:
            </strong>{" "}
            usage rights define what the brand may do with the content: where it
            is published, for how long, whether the rights are exclusive, and
            what channels can be used.
          </div>

          <h2 className="mt-10 text-2xl font-bold text-slate-900">
            What to define
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-700">
            <li>
              <strong>Duration:</strong> how long the brand may use the content.
            </li>
            <li>
              <strong>Territory:</strong> which countries or regions it can
              appear in.
            </li>
            <li>
              <strong>Platform:</strong> social, web, paid ads, email, print, or
              broadcast.
            </li>
            <li>
              <strong>Exclusivity:</strong> whether the creator can license the
              same content elsewhere.
            </li>
            <li>
              <strong>Paid ads:</strong> whether the brand can run paid
              advertising with the content.
            </li>
            <li>
              <strong>Whitelisting:</strong> whether the brand can use the
              content as a paid media placement or channel-specific asset.
            </li>
          </ul>

          <h2 className="mt-10 text-2xl font-bold text-slate-900">
            Common examples
          </h2>
          <p className="mt-4 text-slate-700">
            A short-term social post license is not the same as a year-long ad
            campaign. A non-exclusive license still allows the creator to
            license that same asset to others. An exclusive license can change
            the value and should be priced separately.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-slate-900">
            Sample language
          </h2>
          <p className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-slate-700">
            “This license permits Brand X to use the referenced video on
            Instagram, YouTube, and paid social campaigns for 90 days in Kenya
            and the UK, non-exclusive, with no whitelisting rights and no right
            to sublicense."
          </p>

          <h2 className="mt-10 text-2xl font-bold text-slate-900">
            How ANZA helps
          </h2>
          <p className="mt-4 text-slate-700">
            ANZA is built around making these terms visible before payment and
            before the content is reused. It keeps the offer public and
            connected to a signed record, so the brand and creator have a common
            reference point.
          </p>

          <div className="mt-10 rounded-2xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-900">
            <p className="font-semibold">Checklist</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Confirm the duration in days or months.</li>
              <li>State where the content can be used.</li>
              <li>Mark whether the license is exclusive or non-exclusive.</li>
              <li>Say whether paid ads or whitelisting are included.</li>
            </ul>
          </div>

          <div className="mt-10 border-t border-slate-200 pt-6 text-sm text-slate-500">
            <p>Author: ANZA</p>
            <p>Last updated: October 25, 2026</p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3 text-sm">
            <Link
              href="/guides/payment-risk"
              className="text-blue-700 hover:text-blue-800"
            >
              Next: Payment risk
            </Link>
            <Link
              href="/creator-profile"
              className="text-blue-700 hover:text-blue-800"
            >
              Open My Videos
            </Link>
          </div>
        </article>
      </main>
    </>
  );
}
