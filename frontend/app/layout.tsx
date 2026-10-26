import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Footer } from "@/components/layout/Footer";
import { JsonLd } from "@/components/seo/JsonLd";
import { siteUrl } from "@/lib/site";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const siteDescription =
  "ANZA helps creators publish licensing offers, explain usage rights, get paid, and keep proof of work without giving files away for free.";

// PWA Configuration: Manifest, icons, theme colors, and display mode for installability
// Enables standalone app experience on mobile/desktop when installed
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "ANZA — License creator content, prove the agreement",
    template: "%s | ANZA",
  },
  description: siteDescription,
  applicationName: "ANZA",
  manifest: "/manifest.webmanifest", // Web app manifest for PWA installation
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
    icon: [
      { url: "/images/Dynamic%20ANZA%20Media%20Logo.png", sizes: "any" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/images/Dynamic%20ANZA%20Media%20Logo.png",
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ANZA",
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    "mobile-web-app-capable": "yes", // Android/Chrome support
  },
};

// PWA viewport configuration: theme color for address bar, responsive scaling
export const viewport: Viewport = {
  themeColor: "#2563eb",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
        {/* PWA: Register service worker for offline caching and updates */}
        <ServiceWorkerRegister />
        {/* PWA: Show install prompt for supported browsers */}
        <InstallPrompt />
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
