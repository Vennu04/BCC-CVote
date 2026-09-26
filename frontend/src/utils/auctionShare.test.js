import { describe, it, expect } from "vitest";
import { buildPlayerListText } from "./auctionShare";

const groups = [
  { category: "power", players: [{ user_id: "3", name: "ravi" }, { user_id: "1", name: "Arun" }, { user_id: "9", name: "Kiran" }] },
  { category: "classic", players: [] },
  { category: "extra_power_batsman", players: [{ user_id: "5", name: "Mahesh" }] },
];

describe("buildPlayerListText", () => {
  it("groups by category, sorts A-Z, numbers, and drops sit-outs and empty groups", () => {
    const text = buildPlayerListText({
      matchLabel: "Sat 27 Sep · Morning", captainA: "Rajesh", captainB: "Pavan",
      groups, excludeIds: ["9"], groupName: (g) => ({ power: "Power", extra_power_batsman: "EP Batsmen" }[g] || g),
    });
    expect(text).toBe([
      "🏏 *BCC-CVote Auction — Player List*\nSat 27 Sep · Morning\nCaptains: Rajesh vs Pavan\n3 players in the pool",
      "*Power (2)*\n1. Arun\n2. ravi",
      "*EP Batsmen (1)*\n1. Mahesh",
    ].join("\n\n"));
  });

  it("works without match label or captains", () => {
    expect(buildPlayerListText({ groups: [] })).toBe("🏏 *BCC-CVote Auction — Player List*\n0 players in the pool");
  });
});
