/**
 * ServiceWorkerRegister Component
 * 
 * Purpose: Registers the service worker for PWA functionality
 * - Registers /sw.js on page load
 * - Periodically checks for updates (every hour) to deliver new versions
 * - Ensures users don't get stuck on outdated versions
 */
"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js")
          .then((registration) => {
            // Check for updates periodically to deliver updates to installed users
            setInterval(() => {
              registration.update();
            }, 60 * 60 * 1000); // Check every hour
          })
          .catch((error) => {
            console.error("Service worker registration failed:", error);
          });
      });
    }
  }, []);

  return null;
}
