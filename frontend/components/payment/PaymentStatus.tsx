import { CheckCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import Link from "next/link";

/**
 * Spec section 16 — Payment State.
 *
 * `confirmed` comes only from a backend status response after the configured
 * payment-verification policy accepts evidence. For NIP-57 purchases, this
 * means a signed receiver receipt, not independent proof that funds moved.
 */
export function PaymentStatus({
  confirmed,
  offerId,
  zapReceiptVerified,
}: {
  confirmed: boolean;
  offerId: string;
  zapReceiptVerified: boolean;
}) {
  if (confirmed) {
    return (
      <div className="rounded-lg bg-success-bg p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-success">
          <CheckCircle size={16} /> {zapReceiptVerified ? "Creator payment receipt verified" : "Lightning payment settled"}
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          {zapReceiptVerified
            ? "The creator's Lightning service signed a Zap receipt for this invoice. ANZA relies on that service's claim; it is not independent proof of settlement."
            : "The local Lightning node reported that this invoice settled."}
        </p>
        <Link href={`/offers/${offerId}`} className="mt-3 block">
          <Button fullWidth>View offer →</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface p-4">
      <Loader2 size={16} className="animate-spin text-brand" />
      <div>
        <p className="text-sm font-medium text-text-primary">Waiting for creator receipt…</p>
        <p className="text-xs text-text-secondary">
          A delayed receipt remains pending; it cannot issue a license.
        </p>
      </div>
    </div>
  );
}
