import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Proof of work without giving away files | ANZA",
  description:
    "Learn how creators share proof of work, previews, and verifiable records without handing over the original files before payment and approval.",
  alternates: { canonical: `${siteUrl}/guides/proof-of-work` },
  openGraph: {
    title: "Proof of work without giving away files | ANZA",
    description:
      "Learn how creators share proof of work, previews, and verifiable records without handing over the original files before payment and approval.",
    url: `${siteUrl}/guides/proof-of-work`,
    siteName: "ANZA",
  },
  twitter: {
    card: "summary_large_image",
    title: "Proof of work without giving away files | ANZA",
    description:
      "Learn how creators share proof of work, previews, and verifiable records without handing over the original files before payment and approval.",
  },
};

export default function ProofOfWorkGuidePage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Proof of work without giving away files",
    description:
      "A practical guide to delivering previews, licensing records, and evidence of work without handing over original assets for free.",
    author: { "@type": "Organization", name: "ANZA", url: siteUrl },
    publisher: {
      "@type": "Organization",
      name: "ANZA",
      url: siteUrl,
      logo: `${siteUrl}/images/Dynamic%20ANZA%20Media%20Logo.png`,
    },
    datePublished: "2026-10-25",
    dateModified: "2026-10-25",
    mainEntityOfPage: `${siteUrl}/guides/proof-of-work`,
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
          <span aria-current="page">Proof of work</span>
        </nav>

        <article>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">
            Guide
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-900">
            Proof of work without giving away files
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            Creators do not need to hand over their full file in exchange for a
            “maybe.” They can show proof of work with previews, records, and
            clear approval terms.
          </p>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
            <strong className="font-semibold text-slate-900">
              Quick answer:
            </strong>{" "}
            provide a shareable preview or reference, set the approval terms,
            and only release the final file after payment or written
            confirmation.
          </div>

          <h2 className="mt-10 text-2xl font-bold text-slate-900">
            What counts as proof of work
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-700">
            <li>Watermarked preview with the final framing.</li>
            <li>Public reference to the licensed asset and rights.</li>
            <li>Signed record showing the offer and terms.</li>
            <li>Clear approval timeline for revisions and final handoff.</li>
          </ul>

          <h2 className="mt-10 text-2xl font-bold text-slate-900">
            What to avoid
          </h2>
          <p className="mt-4 text-slate-700">
            Avoid sending raw files before there is a clear payment path or
            written approval. A brand may request a “quick draft” or “sample,”
            but a creator should keep the final unapproved file separate from
            the paid delivery.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-slate-900">
            Sample terms
          </h2>
          <p className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-slate-700">
            “The Brand may review the watermarked preview and approve the
            format. Final files will be delivered only after payment is
            confirmed and the asset is approved in writing. The creator retains
            ownership of the original file until license terms are complete.”
          </p>

          <h2 className="mt-10 text-2xl font-bold text-slate-900">
            How ANZA helps
          </h2>
          <p className="mt-4 text-slate-700">
            ANZA supports this model by letting creators publish a public
            license offer with terms, payment, and references in one place. That
            makes it easier to show proof of work without handing over a full
            asset before the deal is real.
          </p>

          <div className="mt-10 rounded-2xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-900">
            <p className="font-semibold">Checklist</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Share a preview, not the raw final file.</li>
              <li>Keep a written record of approvals and versions.</li>
              <li>Define when the final files are released.</li>
              <li>Use a verifiable license record when possible.</li>
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
              Previous: Payment risk
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
