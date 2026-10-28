/**
 * InstallPrompt Component
 * 
 * Purpose: Handles PWA installation across different platforms
 * - Shows install button on Android/Chrome/Desktop when beforeinstallprompt fires
 * - Shows manual installation instructions for iOS (Share > Add to Home Screen)
 * - Detects if app is already installed (standalone mode) to avoid showing prompt
 * - Auto-shows prompt after 3 seconds if installable
 * - Provides app-like experience with touch-friendly UI
 */
"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if already installed in standalone mode
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    setIsStandalone(standalone);

    // Detect iOS for custom installation instructions
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(ios);

    // Listen for install prompt (Android/Chrome)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Show prompt after a short delay for better UX
      setTimeout(() => setShowPrompt(true), 3000);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      setDeferredPrompt(null);
      setShowPrompt(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
  };

  if (isStandalone || !showPrompt) {
    return null;
  }

  // iOS doesn't support beforeinstallprompt, show manual instructions
  if (isIOS && !deferredPrompt) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-sm rounded-lg border border-border bg-white p-4 shadow-lg md:left-auto md:right-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <h3 className="mb-1 font-semibold text-text-primary">Install ANZA</h3>
            <p className="mb-2 text-sm text-text-secondary">
              Tap the share button <span className="inline-block">⎋</span> and then "Add to Home Screen"
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="text-text-secondary hover:text-text-primary"
            aria-label="Dismiss"
          >
            <X size={18} />
          </button>
        </div>
      </div>
    );
  }

  if (deferredPrompt) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-sm rounded-lg border border-border bg-white p-4 shadow-lg md:left-auto md:right-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-1 items-start gap-3">
            <Download className="mt-0.5 text-primary" size={20} />
            <div className="flex-1">
              <h3 className="mb-1 font-semibold text-text-primary">Install ANZA</h3>
              <p className="mb-3 text-sm text-text-secondary">
                Add ANZA to your home screen for quick access
              </p>
              <div className="flex gap-2">
                <Button onClick={handleInstallClick} className="!px-3 !py-1.5 text-sm">
                  Install
                </Button>
                <button
                  onClick={handleDismiss}
                  className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary"
                >
                  Not now
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
