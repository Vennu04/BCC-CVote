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
    setBidding(true);
    try {
      await api.post(`/auction/${auctionId}/bid`, { amount });
      await fetchAuction();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to place bid");
    } finally {
      setBidding(false);
    }
  };

  const dropCurrentPlayer = async () => {
    if (!confirm("Drop out of bidding for this player?")) return;
    setDropping(true);
    try {
      const res = await api.post(`/auction/${auctionId}/drop`);
      toast(res.data?.message || "Dropped");
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
