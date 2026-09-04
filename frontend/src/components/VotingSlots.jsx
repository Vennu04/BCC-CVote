import SlotCard from "./SlotCard";
import { CheckCircle, RefreshCw, XCircle, AlertTriangle } from "lucide-react";

export default function VotingSlots({ voting }) {
  const {
    rows, loading, error, submitting, revoking, votedCount,
    fetchVotes, handleVote, handleRevoke, handleNotAvailableWeek,
  } = voting;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-4xl mb-2">🏏</div>
          <p className="text-white/40">Loading slots…</p>
        </div>
      </div>
    );
  }

  // Distinguish "the fetch failed" from "there's genuinely nothing to show" —
  // both used to render the same empty-state card, which misleadingly read
  // as "the organizer hasn't set up this weekend's slots" even when it was
  // actually a network/server error with a one-click fix (retry).
  if (error && rows.length === 0) {
    return (
      <div className="card-dark-light text-center py-12">
        <AlertTriangle className="mx-auto text-amber-400 mb-3" size={40} />
        <p className="text-white font-medium">Couldn't load your voting slots</p>
        <p className="text-white/40 text-sm mt-1 mb-4">Check your connection and try again</p>
        <button
          onClick={fetchVotes}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-xl border border-sky-400/20 text-white/80 hover:bg-sky-400/10 transition-all duration-150"
        >
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  const anyOpen = rows.some(({ window }) => window?.is_open);
  const allVoted = votedCount === rows.length && rows.length > 0;

  return (
    <>
      {/* All voted banner */}
      {allVoted && (
        <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 text-green-400 rounded-xl px-4 py-3 mb-4 text-sm font-medium">
          <CheckCircle size={18} />
          <span>All slots voted!</span>
        </div>
      )}

      {/* Not available this week button */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <span className="text-sm text-white/40">{votedCount} / {rows.length} slots voted</span>
        <div className="flex items-center gap-2">
          {error && (
            <span className="flex items-center gap-1 text-xs text-amber-400" title="Showing last known data — refresh failed">
              <AlertTriangle size={13} /> Refresh failed
            </span>
          )}
          <button
            onClick={handleNotAvailableWeek}
            disabled={submitting === "all" || !anyOpen}
            className="flex items-center gap-1.5 text-sm px-4 py-2.5 min-h-[44px] rounded-xl border-2 border-red-500/30 text-red-400 bg-red-500/5 hover:bg-red-500/15 active:scale-[0.97] font-medium transition-all duration-150 disabled:opacity-50 disabled:active:scale-100"
            title={anyOpen ? "" : "No voting windows are open right now"}
          >
            <XCircle size={15} />
            {submitting === "all" ? "Submitting…" : "Not Available This Week"}
          </button>
          <button
            onClick={fetchVotes}
            className="icon-btn text-white/40 hover:text-sky-400 hover:bg-sky-400/10"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Slot cards */}
      {rows.length === 0 ? (
        <div className="card-dark-light text-center py-12">
          <div className="text-5xl mb-3">🏏</div>
          <p className="text-white/70 font-medium">No slots available yet</p>
          <p className="text-white/40 text-sm mt-1">The organizer hasn't set up this weekend's slots</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
    </>
  );
}
