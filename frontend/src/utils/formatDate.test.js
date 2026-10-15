import { describe, it, expect } from "vitest";
import { formatDateDisplay, shortDay, todayIst } from "./formatDate";

describe("formatDateDisplay", () => {
  it("formats an ISO date as DD Mon YYYY", () => {
    expect(formatDateDisplay("2026-08-15")).toBe("15 Aug 2026");
  });

  it("returns an empty string for falsy input", () => {
    expect(formatDateDisplay("")).toBe("");
    expect(formatDateDisplay(null)).toBe("");
    expect(formatDateDisplay(undefined)).toBe("");
  });

  it("returns the raw input unchanged if it doesn't parse as Y-M-D", () => {
    expect(formatDateDisplay("not-a-date")).toBe("not-a-date");
  });
});

describe("IST dates", () => {
  it("formats IST calendar dates without shifting the day", () => {
    expect(shortDay("2026-09-25").startsWith("Fri 25")).toBe(true);
  });
  it("uses the IST date even late in the UTC day", () => {
    // 20:00 UTC on 24 Sep is already 01:30 on 25 Sep in India
    expect(todayIst(new Date(Date.UTC(2026, 8, 24, 20, 0)))).toBe("2026-09-25");
  });
});
