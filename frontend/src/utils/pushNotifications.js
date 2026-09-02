import api from "./api";

export function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// The Push API wants the VAPID application server key as a Uint8Array, not
// the base64url string the backend hands back.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// Requests notification permission and subscribes this browser to push,
// then registers the subscription with the backend. Returns "granted",
// "denied", or "unsupported" so callers can show the right message without
// needing to duplicate the support/permission checks themselves.
export async function subscribeToPush() {
  if (!isPushSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission; // "denied" or "default"

  const registration = await navigator.serviceWorker.ready;

  const { data } = await api.get("/push/vapid-public-key");
  if (!data.key) return "unsupported"; // backend has no VAPID key configured

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.key),
    });
  }

  await api.post("/push/subscribe", subscription.toJSON());
  return "granted";
}
