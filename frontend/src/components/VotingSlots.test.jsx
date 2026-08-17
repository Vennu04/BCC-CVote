import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import VotingSlots from "./VotingSlots";

function baseVoting(overrides = {}) {
  return {
    rows: [],
    loading: false,
    error: false,
    submitting: null,
    revoking: null,
    votedCount: 0,
    fetchVotes: vi.fn(),
    handleVote: vi.fn(),
    handleRevoke: vi.fn(),
    handleNotAvailableWeek: vi.fn(),
    ...overrides,
  };
}

describe("VotingSlots", () => {
  it("shows a loading state while the initial fetch is in flight", () => {
    render(<VotingSlots voting={baseVoting({ loading: true })} />);
    expect(screen.getByText(/Loading slots/)).toBeInTheDocument();
  });

  // Regression coverage for the fix in this same change: a failed fetch
  // must render a distinct retry state, not the generic "organizer hasn't
  // set up this weekend's slots" empty-state message.
  it("shows a retry action (not the generic empty state) when loading failed with no data", () => {
    const voting = baseVoting({ error: true, rows: [] });
    render(<VotingSlots voting={voting} />);

    expect(screen.getByText("Couldn't load your voting slots")).toBeInTheDocument();
    expect(screen.queryByText(/hasn't set up this weekend's slots/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(voting.fetchVotes).toHaveBeenCalledTimes(1);
  });

  it("shows the genuine empty state when there's simply no data and no error", () => {
    render(<VotingSlots voting={baseVoting({ error: false, rows: [] })} />);
    expect(screen.getByText("No slots available yet")).toBeInTheDocument();
  });

  it("shows a non-blocking refresh-failed indicator when stale data is still on screen", () => {
    const voting = baseVoting({
      error: true,
      rows: [{ slot: { id: "s1" }, availability: null, window: { is_open: true } }],
    });
    render(<VotingSlots voting={voting} />);

    // Stale rows still render (not wiped out by the background failure) ...
    expect(screen.queryByText("Couldn't load your voting slots")).not.toBeInTheDocument();
    // ... alongside a small indicator that the last refresh didn't succeed.
    expect(screen.getByText("Refresh failed")).toBeInTheDocument();
  });
});
