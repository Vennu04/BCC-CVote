import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SlotCard from "./SlotCard";
import { auctionCreatedMessage } from "../pages/admin/Auction";

const slot = { id: "s1", day: "Sunday", time_of_day: "Morning", match_time: "03:30 PM", team_a_name: "Hawks", team_b_name: "Royals" };
const base = { is_open: false, is_cancelled: false, seconds_remaining: 0, closes_at: "27 Sep 2026 03:30 PM IST" };

describe("SlotCard voting status", () => {
  it("says when voting opens for a window that hasn't opened yet", () => {
    render(<SlotCard slot={slot} onVote={() => {}} windowInfo={{ ...base, not_yet_open: true, opens_at: "26 Sep 2026 06:00 PM IST" }} />);
    expect(screen.getByText(/Voting opens 26 Sep 2026 06:00 PM IST/)).toBeInTheDocument();
    expect(screen.queryByText(/Voting closed/)).not.toBeInTheDocument();
  });
  it("still says closed once the window has closed", () => {
    render(<SlotCard slot={slot} onVote={() => {}} windowInfo={{ ...base, not_yet_open: false, opens_at: "25 Sep 2026 06:00 PM IST" }} />);
    expect(screen.getByText(/Voting closed 27 Sep 2026 03:30 PM IST/)).toBeInTheDocument();
  });
});

describe("auctionCreatedMessage", () => {
  it("reads as plain words, not raw data", () => {
    const msg = auctionCreatedMessage({ extra_power_allrounder: 4, extra_power_batsman: 6, power: 8, classic: 6 });
    expect(msg).toBe("Auction created — 24 players: 4 EP All-rounders · 6 EP Batsmen · 8 Power · 6 Classic");
    expect(msg).not.toContain("{");
  });
  it("skips empty categories and copes with no counts", () => {
    expect(auctionCreatedMessage({ power: 2, classic: 0 })).toBe("Auction created — 2 players: 2 Power");
    expect(auctionCreatedMessage(undefined)).toBe("Auction created");
  });
});
