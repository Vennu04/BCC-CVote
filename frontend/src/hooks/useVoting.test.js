import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useVoting } from "./useVoting";
import api from "../utils/api";
import toast from "react-hot-toast";

vi.mock("../utils/api");
vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

describe("useVoting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads votes successfully and clears any prior error state", async () => {
    api.get.mockResolvedValueOnce({
      data: { votes: [{ slot: { id: "s1" }, availability: true, window: { is_open: true } }] },
    });
    const { result } = renderHook(() => useVoting());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(false);
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.votedCount).toBe(1);
  });

  // Regression coverage for the empty-state ambiguity fixed alongside this
  // test: a failed fetch must be distinguishable (via `error`) from a
  // genuinely empty `votes` array, so the UI can show a retry action
  // instead of "the organizer hasn't set up this weekend's slots".
  it("sets error state and toasts when the initial fetch fails", async () => {
    api.get.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useVoting());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(true);
    expect(result.current.rows).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith("Failed to load voting data");
  });

  it("clears the error once a retry succeeds", async () => {
    api.get.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useVoting());
    await waitFor(() => expect(result.current.error).toBe(true));

    api.get.mockResolvedValueOnce({ data: { votes: [] } });
    await act(async () => {
      await result.current.fetchVotes();
    });
    expect(result.current.error).toBe(false);
  });

  it("handleVote posts the chosen availability and refetches on success", async () => {
    api.get.mockResolvedValue({ data: { votes: [] } });
    api.post.mockResolvedValueOnce({});
    const { result } = renderHook(() => useVoting());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleVote("slot1", true);
    });

    expect(api.post).toHaveBeenCalledWith("/votes", { slot_id: "slot1", availability: true });
    expect(toast.success).toHaveBeenCalledWith("Vote saved!");
    expect(result.current.submitting).toBe(null);
  });

  it("handleVote surfaces the backend's specific error message on failure", async () => {
    api.get.mockResolvedValue({ data: { votes: [] } });
    api.post.mockRejectedValueOnce({ response: { data: { error: "Voting window closed" } } });
    const { result } = renderHook(() => useVoting());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleVote("slot1", true);
    });

    expect(toast.error).toHaveBeenCalledWith("Voting window closed");
    expect(result.current.submitting).toBe(null);
  });

  it("handleNotAvailableWeek shows the backend's confirmation message", async () => {
    api.get.mockResolvedValue({ data: { votes: [] } });
    api.post.mockResolvedValueOnce({ data: { message: "Marked all 4 slots unavailable" } });
    const { result } = renderHook(() => useVoting());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleNotAvailableWeek();
    });

    expect(api.post).toHaveBeenCalledWith("/votes/not-available-week");
    expect(toast.success).toHaveBeenCalledWith("Marked all 4 slots unavailable");
  });
});
