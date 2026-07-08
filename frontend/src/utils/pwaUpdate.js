// The service worker already calls skipWaiting()+clientsClaim() (see the
// VitePWA workbox config in vite.config.js), so a new deploy takes over the
// *worker* almost immediately — but a tab that's already open keeps running
// the JS it already loaded until an actual page reload happens. Without this,
// admins kept seeing the pre-deploy nav/pages indefinitely unless they
// manually hard-refreshed or went incognito. This reloads the tab exactly
// once, right when a new worker takes control, so everyone lands on the
// latest deploy automatically.
export function setupAutoReloadOnUpdate() {
  if (!("serviceWorker" in navigator)) return;

  // Only do this for an actual update (a different worker taking over from
  // one that was already controlling this tab) — not the very first install,
  // where there's no previous version to reload away from.
  if (!navigator.serviceWorker.controller) return;

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  // The browser already checks for a new worker on every navigation; this
  // catches updates that happen while a tab is left open and idle instead.
  navigator.serviceWorker.getRegistration().then((registration) => {
    if (!registration) return;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") registration.update();
    });
  });
}
