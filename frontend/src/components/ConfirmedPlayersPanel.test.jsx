import { describe, it, expect } from "vitest";
import { confirmedForSlot } from "./ConfirmedPlayersPanel";

const row = (id, cat, availability) => ({
  captain: { id, name: id, auction_category: cat },
  votes: availability ? [{ slot_id: "s1", availability }] : [],
});

describe("confirmedForSlot", () => {
  const matrix = [
    row("srinu", "extra_power_batsman", "available"), // captain in this match
    row("praveen", "extra_power_batsman", "available"),
    row("shoyeb", "extra_power_batsman", "available"),
    row("bunny", "power", "available"), // captain in this match
    row("madhu", "classic", null),
  ];

  it("counts everyone by group when nobody is excluded", () => {
    const d = confirmedForSlot(matrix, "s1");
    expect(d.categories.extra_power_batsman.confirmed).toHaveLength(3);
    expect(d.totalConfirmed).toBe(4);
  });

  it("leaves the match's captains out of every group and the total", () => {
    const d = confirmedForSlot(matrix, "s1", new Set(["srinu", "bunny"]));
    expect(d.categories.extra_power_batsman.confirmed.map((p) => p.id)).toEqual(["praveen", "shoyeb"]);
    expect(d.categories.power.confirmed).toHaveLength(0);
    expect(d.totalConfirmed).toBe(2);
    expect(d.categories.classic.pending).toHaveLength(1);
  });
});
