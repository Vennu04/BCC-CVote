import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAuction } from "./useAuction";
import api from "../utils/api";
import toast from "react-hot-toast";

vi.mock("../utils/api");
vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

describe("useAuction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never fetches when no auctionId is given", () => {
    const { result } = renderHook(() => useAuction(undefined));
    expect(result.current.loading).toBe(true);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("loads the auction and clears error state on success", async () => {
    api.get.mockResolvedValueOnce({ data: { status: "active" } });
    const { result } = renderHook(() => useAuction("a1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.auction).toEqual({ status: "active" });
    expect(result.current.error).toBe(false);
  });

  // Regression coverage for the "Auction not found" ambiguity fixed
  // alongside this test: a failed first load must be distinguishable from a
  // genuinely nonexistent auction ID, via `error`, so the page can offer a
  // retry instead of a dead-end message.
  it("sets error and toasts on the first failed load", async () => {
    api.get.mockRejectedValueOnce({ response: { data: { error: "Auction not found" } } });
    const { result } = renderHook(() => useAuction("bad-id"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(true);
    expect(result.current.auction).toBe(null);
    expect(toast.error).toHaveBeenCalledWith("Auction not found");
  });

  it("suppresses repeat toasts/error state for a poll failure after a successful first load", async () => {
    api.get.mockResolvedValueOnce({ data: { status: "active" } });
    const { result } = renderHook(() => useAuction("a1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    api.get.mockRejectedValueOnce(new Error("one missed poll tick"));
    await act(async () => {
      await result.current.refetch();
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.error).toBe(false);
    // Stale-but-good data stays on screen rather than being wiped by a blip.
    expect(result.current.auction).toEqual({ status: "active" });
  });

  it("placeBid posts the amount and shows a confirmation toast", async () => {
    api.get.mockResolvedValue({ data: { status: "active" } });
    api.post.mockResolvedValueOnce({});
    const { result } = renderHook(() => useAuction("a1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.placeBid(9);
    });

    expect(api.post).toHaveBeenCalledWith("/auction/a1/bid", { amount: 9 });
    expect(toast.success).toHaveBeenCalledWith("Bid placed: 9", { duration: 3000 });
    expect(result.current.bidding).toBe(false);
  });

  it("placeBid surfaces the backend's rejection reason on failure", async () => {
    api.get.mockResolvedValue({ data: { status: "active" } });
    api.post.mockRejectedValueOnce({ response: { data: { error: "You already have the highest bid" } } });
    const { result } = renderHook(() => useAuction("a1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.placeBid(9);
    });

    expect(toast.error).toHaveBeenCalledWith("You already have the highest bid");
  });

  it("freePick posts the player id and shows a success toast", async () => {
    api.get.mockResolvedValue({ data: { status: "active" } });
    api.post.mockResolvedValueOnce({});
    const { result } = renderHook(() => useAuction("a1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.freePick("p1");
    });

    expect(api.post).toHaveBeenCalledWith("/auction/a1/free-pick", { player_id: "p1" });
    expect(toast.success).toHaveBeenCalledWith("Player picked for free!");
  });
  // An old WhatsApp link to an auction this account can't watch used to
  // toast "Access denied" and re-poll every 2.5 s forever.
  it("stops polling and skips the toast when the auction is forbidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      api.get.mockRejectedValue({ response: { status: 403, data: { error: "Access denied" } } });
      const { result } = renderHook(() => useAuction("other-team"));

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.blocked).toBe("forbidden");
      expect(result.current.error).toBe(false);
      expect(toast.error).not.toHaveBeenCalled();

      const calls = api.get.mock.calls.length;
      await act(async () => { vi.advanceTimersByTime(10000); });
      expect(api.get.mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a missing auction as not_found", async () => {
    api.get.mockRejectedValueOnce({ response: { status: 404, data: { error: "Auction not found" } } });
    const { result } = renderHook(() => useAuction("gone"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.blocked).toBe("not_found");
    expect(toast.error).not.toHaveBeenCalled();
  });
});
