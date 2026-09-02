import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkOnly } from "workbox-strategies";

// __WB_MANIFEST is injected at build time by vite-plugin-pwa's
// injectManifest strategy — the same app-shell precache list the previous
// generateSW config produced, just declared by hand now that this file
// also needs a `push` handler generateSW has no hook for.
precacheAndRoute(self.__WB_MANIFEST);

// Never cache API responses — voting data must always be fresh when
// online. Matches the previous generateSW config's navigateFallbackDenylist
// + NetworkOnly runtimeCaching entry for /api/, just expressed via Workbox's
// routing API directly since injectManifest has no config-object equivalent.
registerRoute(({ url }) => url.pathname.startsWith("/api/"), new NetworkOnly());

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "BCC-CVote", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "BCC-CVote";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      data: { url: data.url || "/" },
    })
  );
});

// Focuses an already-open tab instead of opening a duplicate one whenever
// possible — matches how installed apps generally behave.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
