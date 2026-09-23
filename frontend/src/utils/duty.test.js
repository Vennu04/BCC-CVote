import { describe, it, expect } from "vitest";
import { COVERAGE, availableIn, buildRosterMessage, nextWeekendEvening, shortDay, todayIst } from "./duty";

const slots = [
  { code: "19:30", label: "7:30 – 8:30 PM" },
  { code: "20:30", label: "8:30 – 9:30 PM" },
  { code: "21:30", label: "9:30 – 10:30 PM" },
];
const admins = [{ id: "a1", name: "Shashi" }, { id: "a2", name: "Suresh" }, { id: "a3", name: "Narayana" }];

const friday = {
  slot_id: "s1", match_label: "Hawks vs Royals", match_date: "2026-09-26", kickoff: "06:15 AM",
  auction_date: "2026-09-25", is_weekend: true, lead_id: "a1", backup_id: "a2", start_slot: "19:30",
  coverage: "covered",
  responses: {
    a1: { slots: ["19:30", "20:30"], captain: false },
    a2: { slots: ["19:30"], captain: false },
    a3: { slots: [], captain: true },
  },
};
const tuesday = {
  slot_id: "s2", match_label: "Lions vs Bulls", match_date: "2026-09-29", kickoff: "",
  auction_date: "2026-09-28", is_weekend: false, coverage: "organiser", responses: {},
};

describe("COVERAGE", () => {
  it("has a style for every backend coverage state", () => {
    ["covered", "needs_backup", "to_confirm", "nobody", "organiser"].forEach((k) => {
      expect(COVERAGE[k].label).toBeTruthy();
      expect(COVERAGE[k].className).toBeTruthy();
    });
  });
});

describe("availableIn", () => {
  it("lists admins who ticked the slot and are not a captain", () => {
    expect(availableIn(friday, "19:30")).toEqual(["a1", "a2"]);
    expect(availableIn(friday, "20:30")).toEqual(["a1"]);
    expect(availableIn(friday, "21:30")).toEqual([]);
  });
});

describe("dates", () => {
  it("formats IST calendar dates without shifting the day", () => {
    expect(shortDay("2026-09-25").startsWith("Fri 25")).toBe(true);
  });
  it("uses the IST date even late in the UTC day", () => {
    // 20:00 UTC on 24 Sep is already 01:30 on 25 Sep in India
    expect(todayIst(new Date(Date.UTC(2026, 8, 24, 20, 0)))).toBe("2026-09-25");
  });
});

describe("nextWeekendEvening", () => {
  it("skips weekday and past evenings", () => {
    expect(nextWeekendEvening([tuesday, friday], "2026-09-25")).toBe(friday);
    expect(nextWeekendEvening([friday], "2026-09-26")).toBeNull();
  });
});

describe("buildRosterMessage", () => {
  it("lists lead, backup and start time for a covered weekend evening", () => {
    const text = buildRosterMessage({ evenings: [friday], admins, slots });
    expect(text).toContain("auction for Hawks vs Royals");
    expect(text).toContain("Starts 7:30 – 8:30 PM");
    expect(text).toContain("Lead: Shashi");
    expect(text).toContain("Backup: Suresh");
  });
  it("marks weekday matches as the Organiser's and unconfirmed evenings as pending", () => {
    const text = buildRosterMessage({ evenings: [{ ...friday, lead_id: null, backup_id: null }, tuesday], admins, slots });
    expect(text).toContain("Not confirmed yet");
    expect(text).toContain("Run by the Organiser (weekday match)");
  });
  it("flags a missing backup", () => {
    expect(buildRosterMessage({ evenings: [{ ...friday, backup_id: null }], admins, slots })).toContain("still needed");
  });
  it("handles an empty roster", () => {
    expect(buildRosterMessage({ evenings: [], admins, slots })).toContain("No matches scheduled yet.");
  });
});
