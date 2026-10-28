/**
 * Offline Page
 * 
 * Purpose: Fallback page shown when offline and page not cached
 * - Informs user they're offline
 * - Explains that network-dependent operations won't work
 * - Provides sensible behavior for PWA offline state
 */
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline",
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">You're offline</h1>
        <p className="text-slate-600">
          Some pages may not be available while offline. Please check your internet connection.
        </p>
        <p className="text-sm text-slate-500">
          Actions that require a network connection (like publishing events or processing payments) won't work offline.
        </p>
      </div>
    </main>
  );
}
