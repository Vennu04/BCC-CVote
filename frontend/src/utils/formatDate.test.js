import { describe, it, expect } from "vitest";
import { formatDateDisplay } from "./formatDate";

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
