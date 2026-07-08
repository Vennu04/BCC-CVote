// The service worker already calls skipWaiting()+clientsClaim() (see the
// VitePWA workbox config in vite.config.js), so a new deploy takes over the
// *worker* almost immediately — but a tab that's already open keeps running
// the JS it already loaded until an actual page reload happens, and the
// browser only re-checks sw.js on a real navigation. This app is a single-page
// app an admin can leave open (focused, not just backgrounded) for hours
// without ever triggering one, so on top of reloading the moment a new worker
// takes control, this also actively polls for a new sw.js every 30s instead of
// waiting on navigation/visibility events — so an update shows up within
// moments of a deploy finishing, with nobody needing to know to refresh.
const POLL_INTERVAL_MS = 30_000;

export function setupAutoReloadOnUpdate() {
  if (!("serviceWorker" in navigator)) return;

  // Only reload for an actual update (a different worker taking over from one
  // that was already controlling this tab) — not the very first install,
  // where there's no previous version to reload away from.
  if (!navigator.serviceWorker.controller) return;

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  navigator.serviceWorker.getRegistration().then((registration) => {
    if (!registration) return;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") registration.update();
    });
    setInterval(() => registration.update(), POLL_INTERVAL_MS);
  });
}
