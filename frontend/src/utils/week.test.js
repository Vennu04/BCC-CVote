import { describe, it, expect } from "vitest";
import { computeSteps, unresolvedOdd, defaultMatch } from "./week";

const base = {
  slot_id: "s1", label: "Hawks vs Royals", kickoff: "06:15 AM", is_weekend: true,
  voting: { state: "open" }, counts: { available: 20, not_available: 3, yet_to_vote: 5 },
  odd_groups: [], attendance_credited: 0, auction: null, duty: { lead_id: null },
};
const states = (m, x) => Object.fromEntries(computeSteps(m, x).map((s) => [s.key, s.state]));

describe("This week steps", () => {
  it("while voting is open: watch votes is next, later steps locked", () => {
    const s = states(base);
    expect(s.setup).toBe("done");
    expect(s.votes).toBe("now");
    expect(s.close).toBe("open");
    expect(s.attend).toBe("locked");
    expect(s.odd).toBe("locked");
    expect(s.duty).toBe("open");
    expect(s.start).toBe("locked");
    expect(s.share).toBe("locked");
  });

  it("voting not open yet locks the vote steps too", () => {
    const s = states({ ...base, voting: { state: "scheduled" } });
    expect(s.votes).toBe("locked");
    expect(s.close).toBe("locked");
    expect(s.duty).toBe("now");
  });

  it("after closing: attendance is next; odd groups block the start", () => {
    const m = { ...base, voting: { state: "closed" }, odd_groups: ["power"] };
    const s = states(m);
    expect(s.votes).toBe("done");
    expect(s.close).toBe("done");
    expect(s.attend).toBe("now");
    expect(s.odd).toBe("open");
    expect(s.start).toBe("locked");
    expect(computeSteps(m).find((x) => x.key === "odd").detail).toBe("Power is odd");
  });

  it("choosing who sits out resolves the odd step", () => {
    const m = { ...base, voting: { state: "closed" }, odd_groups: ["power"], attendance_credited: 20, duty: { lead_id: "a" } };
    expect(unresolvedOdd(m, { power: "u9" })).toEqual([]);
    const s = states(m, { sitOuts: { power: "u9" } });
    expect(s.odd).toBe("done");
    expect(s.start).toBe("now");
  });

  it("weekday matches need no duty roster", () => {
    expect(states({ ...base, is_weekend: false }).duty).toBe("done");
  });

  it("a finished auction leaves only sharing, then everything is done", () => {
    const m = { ...base, voting: { state: "closed" }, auction: { id: "a1", status: "completed" }, duty: { lead_id: "x" } };
    expect(states(m).share).toBe("now");
    expect(Object.values(states(m, { shared: true })).every((v) => v === "done")).toBe(true);
  });

  it("opens on the first match that still has work", () => {
    const finished = { ...base, slot_id: "done", voting: { state: "closed" }, auction: { status: "completed" }, duty: { lead_id: "x" } };
    expect(defaultMatch([finished, base], (id) => (id === "done" ? { shared: true } : {})).slot_id).toBe("s1");
  });
});
