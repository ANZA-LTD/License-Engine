import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Footer } from "@/components/layout/Footer";
import { JsonLd } from "@/components/seo/JsonLd";
import { siteUrl } from "@/lib/site";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const siteDescription =
  "ANZA helps creators publish licensing offers, explain usage rights, get paid, and keep proof of work without giving files away for free.";

// Shared SEO foundation for the app: default page titles, canonical URLs,
// Open Graph/Twitter preview cards, and organization schema used across pages.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "ANZA — License creator content, prove the agreement",
    template: "%s | ANZA",
  },
  description: siteDescription,
  applicationName: "ANZA",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "ANZA — License creator content, prove the agreement",
    description: siteDescription,
    url: siteUrl,
    siteName: "ANZA",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/images/landing.png",
        width: 1536,
        height: 1024,
        alt: "ANZA — creators licensing and proof of work workflow",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ANZA — License creator content, prove the agreement",
    description: siteDescription,
    images: ["/images/landing.png"],
  },
  icons: {
    icon: "/images/Dynamic%20ANZA%20Media%20Logo.png",
    shortcut: "/images/Dynamic%20ANZA%20Media%20Logo.png",
    apple: "/images/Dynamic%20ANZA%20Media%20Logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "ANZA",
    url: siteUrl,
    logo: `${siteUrl}/images/Dynamic%20ANZA%20Media%20Logo.png`,
    description:
      "ANZA helps creators publish licensing offers, explain usage rights, get paid, and keep proof of work without giving files away for free.",
    sameAs: ["https://github.com/ANZA-LTD/License-Engine"],
  };

  return (
    <html lang="en" className={inter.variable}>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <JsonLd data={organizationSchema} />
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
