import { useState, useEffect, useCallback, useRef } from "react";
import api from "../utils/api";
import toast from "react-hot-toast";

const POLL_INTERVAL_MS = 2500;

export function useAuction(auctionId) {
  const [auction, setAuction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bidding, setBidding] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [freePicking, setFreePicking] = useState(null);
  const hasLoadedOnce = useRef(false);

  const fetchAuction = useCallback(async () => {
    if (!auctionId) return;
    try {
      const res = await api.get(`/auction/${auctionId}`);
      setAuction(res.data);
      hasLoadedOnce.current = true;
    } catch (err) {
      if (!hasLoadedOnce.current) {
        toast.error(err.response?.data?.error || "Failed to load auction");
      }
    } finally {
      setLoading(false);
    }
  }, [auctionId]);

  useEffect(() => { fetchAuction(); }, [fetchAuction]);

  // Live sync via short-interval polling — plenty for just 2 captains bidding at
  // once, and needs no WebSocket infra on top of the existing plain Flask/gunicorn stack.
  useEffect(() => {
    if (!auctionId) return;
    const interval = setInterval(fetchAuction, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [auctionId, fetchAuction]);

  const placeBid = async (amount) => {
    // Same lesson as dropCurrentPlayer below: a successful bid used to give
    // zero confirmation beyond the on-screen bid amount quietly updating.
    // Real live-auction feedback: a captain who bids, doesn't notice that
    // subtle change, and clicks "Place Bid" again gets rejected with "You
    // already have the highest bid" -- correct behavior (can't bid against
    // yourself), but reads as the button not working the first time, when
    // it actually did. A toast on success makes that unmistakable.
    setBidding(true);
    try {
      await api.post(`/auction/${auctionId}/bid`, { amount });
      toast.success(`Bid placed: ${amount}`, { duration: 3000 });
      await fetchAuction();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to place bid");
    } finally {
      setBidding(false);
    }
  };

  const dropCurrentPlayer = async () => {
    // Still no confirm() prompt -- "not interested" stays a single instant
    // click. Every outcome now gets *some* acknowledgment -- including the
    // plain "Dropped" case, which earlier today was left silent on the
    // theory that "someone else's bid is still standing" needed no
    // confirming. Real live-auction data proved that wrong: the backend
    // only ever returns plain "Dropped" when NO ONE has bid on this player
    // yet (the moment either side bids, or the other captain has already
    // passed, this hits a different branch below) -- meaning it's always
    // the "you passed, now waiting on the other captain" state, and with
    // nothing else on screen changing, real captains clicked Drop 2-6 times
    // in a row on the exact same still-current player, not realizing their
    // first click had already registered.
    setDropping(true);
    try {
      const res = await api.post(`/auction/${auctionId}/drop`);
      const message = res.data?.message;
      if (message === "Sold") {
        // From the dropper's own POV "Sold" always means the other
        // captain — you can only ever see this response for a player you
        // just passed on, never one you were winning.
        toast("Sold to the other captain", { duration: 5000 });
      } else if (message === "Dropped") {
        toast("Passed — waiting on the other captain", { duration: 4000, icon: "⏳" });
      } else if (message) {
        toast(message, { duration: 5000 });
      }
      await fetchAuction();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to drop");
    } finally {
      setDropping(false);
    }
  };

  const freePick = async (playerId) => {
    setFreePicking(playerId);
    try {
      await api.post(`/auction/${auctionId}/free-pick`, { player_id: playerId });
      toast.success("Player picked for free!");
      await fetchAuction();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to free-pick player");
    } finally {
      setFreePicking(null);
    }
  };

  return { auction, loading, bidding, dropping, freePicking, placeBid, dropCurrentPlayer, freePick, refetch: fetchAuction };
}
