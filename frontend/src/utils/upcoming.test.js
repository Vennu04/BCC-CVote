import { describe, it, expect } from "vitest";
import { statLine, groupUpcoming, stillNeeded } from "./upcoming";

describe("statLine", () => {
  it("shows only known stats, trims .0, hides zero bowling", () => {
    expect(statLine({ batting_average: 32.456, strike_rate: 140.2, bowling_average: 0, economy: null, attendance_percentage: 80 }))
      .toBe("Bat 32.5 · SR 140 · Att 80%");
    expect(statLine({ batting_average: 20, bowling_average: 18.5, economy: 7 })).toBe("Bat 20 · Bowl 18.5 · Econ 7");
    expect(statLine({})).toBe("");
  });
});

describe("groupUpcoming", () => {
  it("keeps release order and groups consecutive categories", () => {
    const up = [{ id: 1, category: "power" }, { id: 2, category: "power" }, { id: 3, category: "classic" }, { id: 4, category: "extra_power_batsman" }];
    expect(groupUpcoming(up).map((g) => [g.category, g.players.map((p) => p.id)]))
      .toEqual([["power", [1, 2]], ["classic", [3]], ["extra_power_batsman", [4]]]);
    expect(groupUpcoming(undefined)).toEqual([]);
  });
});

describe("stillNeeded", () => {
  it("is quota minus what the captain already has, never below 0", () => {
    const me = { group_counts: { power: 2, classic: 5 } };
    expect(stillNeeded(me, { power: 4, classic: 3 }, "power")).toBe(2);
    expect(stillNeeded(me, { power: 4, classic: 3 }, "classic")).toBe(0);
    expect(stillNeeded(me, { power: 4 }, "extra_power_batsman")).toBe(null);
    expect(stillNeeded(null, { power: 4 }, "power")).toBe(null);
  });
});
