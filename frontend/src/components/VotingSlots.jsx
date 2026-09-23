import SlotCard from "./SlotCard";
import { CheckCircle, RefreshCw, XCircle, AlertTriangle } from "lucide-react";

// Home's list of match cards + the "not playing this weekend" shortcut.
export default function VotingSlots({ voting }) {
  const {
    rows, loading, error, submitting, revoking, votedCount,
    fetchVotes, handleVote, handleRevoke, handleNotAvailableWeek,
  } = voting;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-center">
          <div className="text-4xl mb-2">🏏</div>
          <p className="text-gray-500">Loading slots…</p>
        </div>
      </div>
    );
  }

  if (error && rows.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-soft text-center py-10 px-4">
        <AlertTriangle className="mx-auto text-amber-500 mb-3" size={36} />
        <p className="text-gray-900 font-semibold">Couldn't load your voting slots</p>
        <p className="text-gray-500 text-sm mt-1 mb-4">Check your connection and try again</p>
        <button onClick={fetchVotes} className="btn-secondary inline-flex items-center gap-1.5">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  const anyOpen = rows.some(({ window }) => window?.is_open);
  const allVoted = votedCount === rows.length && rows.length > 0;

  return (
    <>
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-xs font-black uppercase tracking-wider text-gray-500">Your matches</h2>
        <div className="flex items-center gap-1">
          {error && (
            <span className="flex items-center gap-1 text-xs text-amber-700" title="Showing last known data — refresh failed">
              <AlertTriangle size={13} /> Refresh failed
            </span>
          )}
          <button onClick={fetchVotes} className="icon-btn text-gray-500 hover:text-brand-navy" aria-label="Refresh matches">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {allVoted && (
        <div className="flex items-center gap-2 bg-pitch-50 text-pitch-800 rounded-xl px-4 py-2.5 mb-3 text-sm font-semibold">
          <CheckCircle size={17} />
          <span>All slots voted!</span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-soft text-center py-10 px-4">
          <div className="text-5xl mb-3">🏏</div>
          <p className="text-gray-800 font-semibold">No slots available yet</p>
          <p className="text-gray-500 text-sm mt-1">The organizer hasn't set up this weekend's slots</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map(({ slot, availability, window, available_players }) => (
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
              availablePlayers={available_players}
            />
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="text-center mt-4">
          <button
            onClick={handleNotAvailableWeek}
            disabled={submitting === "all" || !anyOpen}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-700 px-4 min-h-[44px] rounded-xl hover:bg-red-50 disabled:opacity-40"
            title={anyOpen ? "Marks every open match as 'can't play'" : "No voting windows are open right now"}
          >
            <XCircle size={15} />
            {submitting === "all" ? "Submitting…" : "Not Available This Week"}
          </button>
        </div>
      )}
    </>
  );
}
