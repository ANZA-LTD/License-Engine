import type { Metadata } from "next";
import { BrandProfileClient } from "./BrandProfileClient";
import { siteUrl } from "@/lib/site";

// Public browse page SEO: keep this route server-rendered so the metadata stays
// crawlable and valid while the interactive listing logic remains in the client component.
export const metadata: Metadata = {
  title: "Browse creator offers",
  description:
    "Browse creator licensing offers, review usage rights, and compare content licenses before buying a license.",
  alternates: { canonical: `${siteUrl}/brand-profile` },
  openGraph: {
    title: "Browse creator offers",
    description:
      "Browse creator licensing offers, review usage rights, and compare content licenses before buying a license.",
    url: `${siteUrl}/brand-profile`,
    siteName: "ANZA",
  },
  twitter: {
    card: "summary_large_image",
    title: "Browse creator offers",
    description:
      "Browse creator licensing offers, review usage rights, and compare content licenses before buying a license.",
  },
};

export default function BrandProfilePage() {
  return <BrandProfileClient />;
}
