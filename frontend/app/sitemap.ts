import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

// Public sitemap for SEO indexing. These routes cover the landing page, creator
// flow, and higher-value informational guides relevant to search discovery.
const routes = [
  "",
  "/sign-in",
  "/create",
  "/brand-profile",
  "/guides",
  "/guides/brand-gigs",
  "/guides/usage-rights",
  "/guides/payment-risk",
  "/guides/proof-of-work",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route.startsWith("/guides") ? "weekly" : "monthly",
    priority: route === "" ? 1 : route.startsWith("/guides") ? 0.8 : 0.7,
  }));
}
