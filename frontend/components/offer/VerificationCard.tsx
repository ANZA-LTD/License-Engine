import { ShieldCheck } from "lucide-react";
import { CopyButton } from "@/components/ui/CopyButton";

/**
 * Spec section 13 — Nostr Verification Section.
 * `eventId`: the offer's or the license's Nostr event id.
 * `label`: lets the same component say "Verified on Nostr" (offer page) or
 *          reuse the same visual style with a different heading elsewhere.
 */
export function VerificationCard({
  eventId,
  label = "Verified on Nostr",
}: {
  eventId: string;
  label?: string;
}) {
  const visibleId =
    eventId.length > 24
      ? `${eventId.slice(0, 12)}...${eventId.slice(-8)}`
      : eventId;

  return (
    <div className="flex min-w-0 items-start gap-3 rounded-lg bg-success-bg px-4 py-3">
      <ShieldCheck size={18} className="mt-0.5 shrink-0 text-success" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-success">{label}</p>
        <div className="mt-1 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <p
            className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-text-secondary"
            title={eventId}
            aria-label={`Nostr event ID: ${eventId}`}
          >
            Event: {visibleId}
          </p>
          <CopyButton value={eventId} label="Copy ID" />
        </div>
      </div>
    </div>
  );
}
