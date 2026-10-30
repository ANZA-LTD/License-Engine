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
 * The backend signs preview URLs (videos are authenticated Cloudinary
 * resources) and applies the watermark overlay, so the frontend renders the
 * URL as-is. Downloads always serve the unwatermarked original via the
 * download-grant flow.
 *
 * BACKEND TEAM: if you start returning a `contentType` field on the Offer
 * instead of relying on the extension, swap the `isVideo` check below for
 * `offer.contentType === "video"`.
 */

export function ContentPreview({
  url,
  title,
  size = "large",
}: {
  url: string;
  title: string;
  size?: "large" | "small";
}) {
  const isVideo = /\.(mp4|webm|mov)(\?.*)?$/i.test(url);
  const dimensions =
    size === "large" ? "aspect-video" : "aspect-square h-16 w-16 shrink-0";

  return (
    <div className={`overflow-hidden rounded-lg bg-surface ${dimensions}`}>
      {isVideo ? (
        <video
          src={url}
          className="h-full w-full object-cover"
          controls={size === "large"}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- content URLs are
        // arbitrary/external (Cloudinary), so next/image's domain allowlist
        // would need updating per-offer; a plain  element keeps this MVP simple.
        <img src={url} alt={title} className="h-full w-full object-cover" />
      )}
    </div>
  );
}
