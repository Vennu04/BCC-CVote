// "Your turn" attention-getters for the live captain auction screen — added
// after real live-auction data showed captains missing their turn for
// several minutes at a time despite the tab being open (see Auction.jsx's
// needsMyTurn effect). No new assets needed: the sound is synthesized with
// the Web Audio API rather than shipping an audio file.

let audioCtx = null;

// Two-tone rising beep -- distinct from a generic "ding" so it reads as
// "action needed", not just an ambient notification. Synthesized instead of
// an <audio> asset so there's nothing to fetch/cache and it works offline
// the same as the rest of this PWA.
export function playTurnAlertSound() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const now = audioCtx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.16);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.16);
    });
  } catch {
    // Audio isn't essential to the alert -- vibration/banner/title still fire
    // even on a browser that blocks autoplay-adjacent audio contexts.
  }
}

export function vibrateTurnAlert() {
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

// Flashes the browser tab title between the alert text and whatever title
// was already there, so it's noticeable even if the captain has switched to
// a different tab/app but glances back. Returns a stop function that
// restores the original title.
export function flashTabTitle(alertText) {
  const original = document.title;
  let showingAlert = false;
  const interval = setInterval(() => {
    document.title = showingAlert ? original : alertText;
    showingAlert = !showingAlert;
  }, 900);
  return () => {
    clearInterval(interval);
    document.title = original;
  };
}

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestTurnNotificationPermission() {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission === "default") return Notification.requestPermission();
  return Notification.permission;
}

// Only fires an OS-level notification when the tab is actually backgrounded
// -- while it's focused, the in-page banner + sound + vibration are already
// enough, and a native notification on top would just be redundant/annoying.
export function showTurnNotification(body) {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  try {
    const n = new Notification("BCC-CVote — Your turn!", {
      body,
      icon: "/pwa-192x192.png",
      tag: "bcc-cvote-turn-alert", // replaces any previous one instead of stacking
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Some browsers restrict Notification construction in certain contexts
    // (e.g. iOS Safari PWAs) -- non-fatal, the in-page alert still covers it.
  }
}
