import SlotCard from "./SlotCard";
import { CheckCircle, RefreshCw, XCircle } from "lucide-react";

export default function VotingSlots({ voting }) {
  const {
    rows, loading, submitting, revoking, votedCount,
    fetchVotes, handleVote, handleRevoke, handleNotAvailableWeek,
  } = voting;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-4xl mb-2">🏏</div>
          <p className="text-gray-500">Loading slots…</p>
        </div>
      </div>
    );
  }

  const anyOpen = rows.some(({ window }) => window?.is_open);
  const allVoted = votedCount === rows.length && rows.length > 0;

  return (
    <>
      {/* All voted banner */}
      {allVoted && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 mb-4 text-sm font-medium">
          <CheckCircle size={18} />
          <span>All slots voted!</span>
        </div>
      )}

      {/* Not available this week button */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <span className="text-sm text-gray-500">{votedCount} / {rows.length} slots voted</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleNotAvailableWeek}
            disabled={submitting === "all" || !anyOpen}
            className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border-2 border-red-300 text-red-700 bg-white hover:bg-red-50 font-medium transition-colors disabled:opacity-50 min-h-[44px]"
            title={anyOpen ? "" : "No voting windows are open right now"}
          >
            <XCircle size={15} />
            {submitting === "all" ? "Submitting…" : "Not Available This Week"}
          </button>
          <button
            onClick={fetchVotes}
            className="flex items-center gap-1 hover:text-pitch-600 transition-colors text-xs text-gray-400 min-h-[44px] min-w-[44px] justify-center"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Slot cards */}
      {rows.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-5xl mb-3">🏏</div>
          <p className="text-gray-600 font-medium">No slots available yet</p>
          <p className="text-gray-400 text-sm mt-1">The organizer hasn't set up this weekend's slots</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {rows.map(({ slot, availability, window }) => (
            <SlotCard
              key={slot.id}
              slot={slot}
              currentVote={availability}
              onVote={handleVote}
              disabled={!window?.is_open}
              loading={submitting === slot.id}
              windowInfo={window}
              onRevoke={handleRevoke}
              revoking={revoking === slot.id}
            />
          ))}
        </div>
      )}
    </>
  );
}
