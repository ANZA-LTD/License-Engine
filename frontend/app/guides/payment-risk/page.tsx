import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "How to avoid brands not paying | ANZA",
  description:
    "Learn how creators reduce payment risk with clear terms, timelines, and verifiable evidence before sending files or approving work.",
  alternates: { canonical: `${siteUrl}/guides/payment-risk` },
  openGraph: {
    title: "How to avoid brands not paying | ANZA",
    description:
      "Learn how creators reduce payment risk with clear terms, timelines, and verifiable evidence before sending files or approving work.",
    url: `${siteUrl}/guides/payment-risk`,
    siteName: "ANZA",
  },
  twitter: {
    card: "summary_large_image",
    title: "How to avoid brands not paying | ANZA",
    description:
      "Learn how creators reduce payment risk with clear terms, timelines, and verifiable evidence before sending files or approving work.",
  },
};

export default function PaymentRiskGuidePage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "How to avoid brands not paying",
    description:
      "A practical guide to reducing payment risk for creators working with brands and licensing assets.",
    author: { "@type": "Organization", name: "ANZA", url: siteUrl },
    publisher: {
      "@type": "Organization",
      name: "ANZA",
      url: siteUrl,
      logo: `${siteUrl}/images/Dynamic%20ANZA%20Media%20Logo.png`,
    },
    datePublished: "2026-10-25",
    dateModified: "2026-10-25",
    mainEntityOfPage: `${siteUrl}/guides/payment-risk`,
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
          <span aria-current="page">Payment risk</span>
        </nav>

        <article>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">
            Guide
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-900">
            How to avoid brands not paying
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            The simplest way to reduce payment risk is to make the terms and
            timing visible before a brand receives files or begins publishing.
          </p>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
            <strong className="font-semibold text-slate-900">
              Quick answer:
            </strong>{" "}
            do not treat “I’ll pay later” as an agreement. Create a written
            record, set a payment timeline, and make sure the offer clearly
            states the rights and fee.
          </div>

          <h2 className="mt-10 text-2xl font-bold text-slate-900">
            A safer workflow
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-700">
            <li>
              Confirm scope and deliverables in writing before production
              begins.
            </li>
            <li>State the due date and payment method clearly.</li>
            <li>
              Agree on whether there is a deposit, milestone, or full payment
              before launch.
            </li>
            <li>
              Keep a record of the offer and any approvals or handoff dates.
            </li>
          </ul>

          <h2 className="mt-10 text-2xl font-bold text-slate-900">
            Sample timeline
          </h2>
          <ol className="mt-4 list-decimal space-y-3 pl-6 text-slate-700">
            <li>
              Brand reviews the offer and confirms the asset, rights, and price.
            </li>
            <li>
              Payment is made or confirmed before final publish and distribution
              begins.
            </li>
            <li>
              Creator shares final proof of work or final approved version.
            </li>
            <li>
              Both parties retain a reference to the signed terms and timeline.
            </li>
          </ol>

          <h2 className="mt-10 text-2xl font-bold text-slate-900">
            Sample clause
          </h2>
          <p className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-slate-700">
            “Payment of 5000 sats is due before the content is published or
            distributed. The Brand may not use or share the final files before
            payment is confirmed. The creator may retain the original files
            until payment is complete.”
          </p>

          <h2 className="mt-10 text-2xl font-bold text-slate-900">
            How ANZA helps
          </h2>
          <p className="mt-4 text-slate-700">
            ANZA makes the value exchange explicit: the creator can share a
            clear public offer with price and terms, and the brand can review it
            before committing. That reduces the confusion that leads to late or
            missing payment.
          </p>

          <div className="mt-10 rounded-2xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-900">
            <p className="font-semibold">Checklist</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Make the price and terms public.</li>
              <li>Set a payment deadline before publishing.</li>
              <li>Keep a record of approvals and version changes.</li>
              <li>Do not send final files before payment is confirmed.</li>
            </ul>
          </div>

          <div className="mt-10 border-t border-slate-200 pt-6 text-sm text-slate-500">
            <p>Author: ANZA</p>
            <p>Last updated: October 25, 2026</p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3 text-sm">
            <Link
              href="/guides/proof-of-work"
              className="text-blue-700 hover:text-blue-800"
            >
              Next: Proof of work
            </Link>
            <Link
              href="/guides/usage-rights"
              className="text-blue-700 hover:text-blue-800"
            >
              Previous: Usage rights
            </Link>
          </div>
        </article>
      </main>
    </>
  );
}
