import { useState, useEffect, useCallback } from "react";
import api from "../utils/api";
import toast from "react-hot-toast";

export function useVoting() {
  const [votesData, setVotesData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(null); // slot_id being submitted
  const [revoking, setRevoking] = useState(null); // slot_id being revoked

  const fetchVotes = useCallback(async () => {
    try {
      const res = await api.get("/votes/my");
      setVotesData(res.data);
    } catch {
      toast.error("Failed to load voting data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchVotes(); }, [fetchVotes]);

  // Auto-refresh every 60s to sync window status
  useEffect(() => {
    const interval = setInterval(fetchVotes, 60000);
    return () => clearInterval(interval);
  }, [fetchVotes]);

  const handleVote = async (slotId, availability) => {
    setSubmitting(slotId);
    try {
      await api.post("/votes", { slot_id: slotId, availability });
      toast.success("Vote saved!");
      await fetchVotes();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save vote");
    } finally {
      setSubmitting(null);
    }
  };

  const handleRevoke = async (slotId) => {
    if (!confirm("Emergency withdrawal — remove your name from this match?")) return;
    setRevoking(slotId);
    try {
      await api.delete(`/votes/${slotId}`);
      toast.success("Vote withdrawn");
      await fetchVotes();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to withdraw vote");
    } finally {
      setRevoking(null);
    }
  };

  const handleNotAvailableWeek = async () => {
    setSubmitting("all");
    try {
      const res = await api.post("/votes/not-available-week");
      toast.success(res.data?.message || "Marked as not available");
      await fetchVotes();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to submit");
    } finally {
      setSubmitting(null);
    }
  };

  const rows = votesData?.votes || [];
  const votedCount = rows.filter(({ availability }) => availability).length;

  return {
    rows,
    loading,
    submitting,
    revoking,
    votedCount,
    fetchVotes,
    handleVote,
    handleRevoke,
    handleNotAvailableWeek,
  };
}
