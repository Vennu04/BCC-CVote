import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import api from "../utils/api";
import toast from "react-hot-toast";
import Navbar from "../components/Navbar";
import SlotCard from "../components/SlotCard";
import CountdownTimer from "../components/CountdownTimer";
import { CheckCircle, Clock, RefreshCw } from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();
  const [votesData, setVotesData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(null); // slot_id being submitted

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
      toast.success("Vote saved! ✅");
      await fetchVotes();
    } catch (err) {
      const msg = err.response?.data?.error || "Failed to save vote";
      toast.error(msg);
    } finally {
      setSubmitting(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="text-4xl mb-2">🏏</div>
            <p className="text-gray-500">Loading slots…</p>
          </div>
        </div>
      </div>
    );
  }

  const window = votesData?.window;
  const isOpen = window?.is_open;
  const slots = votesData?.votes || [];

  // Build vote map: slot.id → availability
  const voteMap = {};
  slots.forEach(({ slot, availability }) => { voteMap[slot.id] = availability; });

  const votedCount = slots.filter(({ availability }) => availability).length;
  const allVoted = votedCount === slots.length && slots.length > 0;

  return (
    <div className="min-h-screen bg-cricket-cream">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Hey {user?.name} 👋
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Mark your availability for this weekend's matches
          </p>
        </div>

        {/* Window status bar */}
        <div className="mb-6">
          {isOpen ? (
            <CountdownTimer
              secondsRemaining={window?.seconds_remaining}
              closesAt={window?.closes_at}
            />
          ) : (
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 text-gray-600 rounded-lg px-4 py-2.5 text-sm">
              <Clock size={16} />
              <span>
                {window
                  ? `Voting closed on ${window.closes_at}`
                  : "No voting window is currently active. Check back Thursday evening."}
              </span>
            </div>
          )}
        </div>

        {/* All voted banner */}
        {isOpen && allVoted && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 mb-6 text-sm font-medium">
            <CheckCircle size={18} />
            <span>You've voted for all 4 slots! You can still change your votes until the window closes.</span>
          </div>
        )}

        {/* Progress indicator */}
        {isOpen && (
          <div className="flex items-center justify-between text-sm text-gray-500 mb-4">
            <span>{votedCount} / {slots.length} slots voted</span>
            <button
              onClick={fetchVotes}
              className="flex items-center gap-1 hover:text-pitch-600 transition-colors text-xs"
            >
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        )}

        {/* Slot cards */}
        {slots.length === 0 ? (
          <div className="card text-center py-12">
            <div className="text-5xl mb-3">🏏</div>
            <p className="text-gray-600 font-medium">No slots available yet</p>
            <p className="text-gray-400 text-sm mt-1">The organizer hasn't set up this weekend's slots</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {slots.map(({ slot, availability }) => (
              <SlotCard
                key={slot.id}
                slot={slot}
                currentVote={availability}
                onVote={handleVote}
                disabled={!isOpen}
                loading={submitting === slot.id}
              />
            ))}
          </div>
        )}

        {/* Closed state CTA */}
        {!isOpen && slots.length > 0 && (
          <div className="mt-6 card text-center">
            <p className="text-gray-600 text-sm">Voting is closed. Check the results below.</p>
            <a href="/results" className="btn-primary inline-block mt-3 text-sm">View Results</a>
          </div>
        )}
      </div>
    </div>
  );
}
