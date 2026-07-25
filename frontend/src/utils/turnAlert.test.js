import { describe, it, expect, vi, afterEach } from "vitest";
import { flashTabTitle, notificationsSupported, showTurnNotification } from "./turnAlert";

describe("flashTabTitle", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.title = "";
  });

  it("alternates between the original title and the alert text, and restores on stop", () => {
    vi.useFakeTimers();
    document.title = "BCC-CVote";
    const stop = flashTabTitle("⚡ YOUR TURN!");

    expect(document.title).toBe("BCC-CVote"); // unchanged until the first tick

    vi.advanceTimersByTime(900);
    expect(document.title).toBe("⚡ YOUR TURN!");

    vi.advanceTimersByTime(900);
    expect(document.title).toBe("BCC-CVote");

    vi.advanceTimersByTime(900);
    expect(document.title).toBe("⚡ YOUR TURN!");

    stop();
    expect(document.title).toBe("BCC-CVote");

    // No further changes after stopping, even if time keeps moving.
    vi.advanceTimersByTime(3000);
    expect(document.title).toBe("BCC-CVote");
  });
});

describe("showTurnNotification", () => {
  it("never throws, regardless of Notification support in this environment", () => {
    expect(() => showTurnNotification("test")).not.toThrow();
  });

  it("does nothing when the tab is currently visible (in-page banner already covers it)", () => {
    if (!notificationsSupported()) return; // jsdom doesn't implement Notification -- nothing to spy on
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    const spy = vi.spyOn(window, "Notification");
    showTurnNotification("test");
    expect(spy).not.toHaveBeenCalled();
  });
});
