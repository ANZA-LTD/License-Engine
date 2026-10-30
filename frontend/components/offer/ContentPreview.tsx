/**
 * ContentPreview
 * Renders the creator's content for production pages. Detects image vs
 * video by extension and renders a plain  or <video>. This file is
 * server-component safe (does not use React hooks) so it can be used in
 * Next.js server-rendered pages.
 */
/**
 * Renders the creator's content (spec section 22 — Content Hosting: just an
 * image/video URL, no upload infrastructure). We guess image vs. video from
 * the file extension — good enough for the MVP's Cloudinary-hosted samples.
 *
 * Brand-safe previews are watermarked so brands can evaluate content without
 * receiving the unrestricted original. Cloudinary-hosted URLs are rewritten to
 * include a watermark overlay (`l_<watermark>`), controlled by
 * `NEXT_PUBLIC_WATERMARK_PUBLIC_ID_LANDSCAPE` /
 * `NEXT_PUBLIC_WATERMARK_PUBLIC_ID_PORTRAIT`. The preview picks the watermark
 * matching the creator video's aspect ratio. Non-Cloudinary URLs (or when no
 * watermark is configured) are passed through unchanged so previews never
 * regress, and downloads always serve the unwatermarked original.
 *
 * BACKEND TEAM: if you start returning a `contentType` field on the Offer
 * instead of relying on the extension, swap the `isVideo` check below for
 * `offer.contentType === "video"`.
 */

export type WatermarkOrientation = "landscape" | "portrait" | "square";

const CLOUDINARY_UPLOAD_RE =
  /^(https?:\/\/res\.cloudinary\.com\/[^\/]+\/[a-z]+\/upload\/)(.*)$/;

/**
 * Resolves which watermark public id to use for a given orientation.
 * Prefers the orientation-specific id, falls back to the other one if only
 * that is configured, and returns undefined (no watermark) when neither is set.
 */
function resolveWatermarkId(
  orientation: WatermarkOrientation | undefined,
): string | undefined {
  const landscape =
    process.env.NEXT_PUBLIC_WATERMARK_PUBLIC_ID_LANDSCAPE;
  const portrait =
    process.env.NEXT_PUBLIC_WATERMARK_PUBLIC_ID_PORTRAIT;

  if (orientation === "landscape") return landscape ?? portrait;
  if (orientation === "portrait") return portrait ?? landscape;
  // square / unknown: default to landscape if available, else portrait
  return landscape ?? portrait;
}

/**
 * Rewrites a Cloudinary media URL to include a watermark overlay so the
 * rendered preview is brand-safe (watermarked) rather than the raw original.
 * `orientation` selects between the landscape and portrait watermark assets.
 * Falls back to the original URL when no watermark public id is configured or
 * the URL is not a Cloudinary upload URL.
 */
export function toWatermarkedPreview(
  url: string,
  orientation?: WatermarkOrientation,
): string {
  const watermark = resolveWatermarkId(orientation);
  if (!watermark) return url;
  const match = CLOUDINARY_UPLOAD_RE.exec(url);
  if (!match) return url;
  const [, prefix, rest] = match;
  const overlay = `l_${watermark},w_0.25,o_40,g_center/`;
  return `${prefix}${overlay}${rest}`;
}

/**
 * Derives a video's orientation from its width and height.
 */
export function videoOrientation(
  width: number | null | undefined,
  height: number | null | undefined,
): WatermarkOrientation | undefined {
  if (width == null || height == null || width <= 0 || height <= 0)
    return undefined;
  if (width > height) return "landscape";
  if (height > width) return "portrait";
  return "square";
}

export function ContentPreview({
  url,
  title,
  size = "large",
  orientation,
}: {
  url: string;
  title: string;
  size?: "large" | "small";
  orientation?: WatermarkOrientation;
}) {
  const previewUrl = toWatermarkedPreview(url, orientation);
  const isVideo = /\.(mp4|webm|mov)$/i.test(url);
  const dimensions =
    size === "large" ? "aspect-video" : "aspect-square h-16 w-16 shrink-0";

  return (
    <div className={`overflow-hidden rounded-lg bg-surface ${dimensions}`}>
      {isVideo ? (
        <video
          src={previewUrl}
          className="h-full w-full object-cover"
          controls={size === "large"}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- content URLs are
        // arbitrary/external (Cloudinary), so next/image's domain allowlist
        // would need updating per-offer; a plain  element keeps this MVP simple.
        <img src={previewUrl} alt={title} className="h-full w-full object-cover" />
      )}
    </div>
  );
}
