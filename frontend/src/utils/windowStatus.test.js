import { describe, it, expect } from "vitest";
import { STATUS_STYLES } from "./windowStatus";

// Every value _window_status() (backend admin.py) can actually return --
// a typo here would silently fall back to the generic gray "UNKNOWN" style
// on both the Voting Windows page and the Admin Dashboard.
const BACKEND_STATUSES = ["scheduled", "open", "closed", "auction_completed", "cancelled"];

describe("STATUS_STYLES", () => {
  it("has an entry for every backend-computed window status", () => {
    BACKEND_STATUSES.forEach((status) => {
      expect(STATUS_STYLES[status]).toBeDefined();
      expect(STATUS_STYLES[status].label).toBeTruthy();
      expect(STATUS_STYLES[status].className).toBeTruthy();
    });
  });
});
