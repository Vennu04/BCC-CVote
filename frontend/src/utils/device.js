const DEVICE_ID_KEY = "bcc_device_id";

// localStorage (not sessionStorage) is deliberate here, unlike bcc_token/bcc_user
// — this needs to identify the physical device/browser itself, shared across
// every tab, not swap per-tab the way logged-in identity does.
export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
