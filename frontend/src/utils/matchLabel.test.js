import { describe, it, expect } from "vitest";
import { matchTeams, matchWhen, matchLabel } from "./matchLabel";
import { formatDateDisplay } from "./formatDate";

const fixture = {
  team_a_name: "Super Kings", team_b_name: "Rohit 45", day: "Saturday",
  time_of_day: "Morning", match_time: "06:15 AM", resolved_match_date: "2026-09-19",
};

describe("matchLabel", () => {
  it("names both teams with the real date and time for a pool fixture", () => {
    expect(matchTeams(fixture)).toBe("Super Kings vs Rohit 45");
    // Month spelling ("Sep"/"Sept") is the runtime's locale data, so build the expected date the same way.
    const when = `Saturday · ${formatDateDisplay("2026-09-19")} · 06:15 AM`;
    expect(matchWhen(fixture)).toBe(when);
    expect(matchLabel(fixture)).toBe(`Super Kings vs Rohit 45 — ${when}`);
  });

  it("falls back to day and time when a slot has no teams", () => {
    const slot = { day: "Sunday", time_of_day: "Evening", match_time: "" };
    expect(matchTeams(slot)).toBe("");
    expect(matchLabel(slot)).toBe("Sunday · Evening");
  });

  it("does not show a half-named matchup", () => {
    expect(matchTeams({ team_a_name: "Super Kings", team_b_name: null })).toBe("");
  });
});
