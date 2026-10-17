import { describe, it, expect } from "vitest";
import { closesLabel } from "./SlotCard";

describe("closesLabel", () => {
  it("counts down in minutes under an hour", () => {
    expect(closesLabel(0, 25, "12 Jul 2026 08:00 AM IST")).toBe("Voting closes in 25 min");
  });

  it("uses hours and minutes up to two days out", () => {
    expect(closesLabel(47, 5, "12 Jul 2026 08:00 AM IST")).toBe("Voting closes in 47 h 5 min");
  });

  it("shows the closing date beyond two days", () => {
    expect(closesLabel(85362, 1, "12 Jul 2026 08:00 AM IST")).toBe("Voting closes 12 Jul 2026 08:00 AM IST");
  });

  it("falls back to days when no closing date is known", () => {
    expect(closesLabel(73, 0, null)).toBe("Voting closes in 3 days");
  });
});
