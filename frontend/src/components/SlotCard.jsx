import { useState } from "react";
import VoteButton from "./VoteButton";
import WeatherForecast from "./WeatherForecast";
import { useCountdown } from "../hooks/useCountdown";
import { formatDateDisplay } from "../utils/formatDate";
import { Sun, Sunset, Clock, Lock, AlertTriangle, Users, ChevronDown, ChevronUp } from "lucide-react";

// Royal-blue theme — SlotCard is only ever rendered inside VotingSlots,
// which is only ever rendered on CaptainDashboard/PlayerDashboard (the 2
// in-scope dashboard pages), so it's safe to reskin fully rather than keep
// a light/dark split within one card.
const TIME_ICONS = {
  Morning: <Sun size={22} className="text-sky-400" />,
  Evening: <Sunset size={22} className="text-amber-400" />,
};

function WindowStatus({ windowInfo }) {
  const { hours, minutes, expired } = useCountdown(windowInfo?.seconds_remaining);

  if (windowInfo?.is_cancelled) {
    return (
      <div className="flex items-center gap-1.5 text-xs font-semibold text-red-400 bg-red-500/10 border border-red-500/30 rounded-full px-2.5 py-1">
        <AlertTriangle size={11} />
        <span>Match Cancelled{windowInfo.cancel_reason ? ` — ${windowInfo.cancel_reason}` : ""}</span>
      </div>
    );
  }

  if (!windowInfo?.is_open) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-white/40 bg-white/5 border border-white/10 rounded-full px-2.5 py-1">
        <Lock size={11} />
        <span>
          {windowInfo?.closes_at ? `Closed — was open till ${windowInfo.closes_at}` : "Voting not open"}
          {windowInfo?.can_revoke && windowInfo?.revoke_deadline ? ` · can withdraw until ${windowInfo.revoke_deadline}` : ""}
        </span>
      </div>
    );
  }

  const urgency = !expired && hours === 0 && minutes < 30;
  return (
    <div className={`flex items-center gap-1.5 text-xs font-bold rounded-full px-2.5 py-1 border ${
      urgency ? "bg-red-500/10 text-red-400 border-red-500/30" : "bg-green-500/10 text-green-400 border-green-500/30"
    }`}>
      <Clock size={11} />
      <span>Closes in {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}</span>
    </div>
  );
}

export default function SlotCard({ slot, currentVote, onVote, disabled, loading, windowInfo, onRevoke, revoking, availablePlayers }) {
  const [showAvailable, setShowAvailable] = useState(false);
  const showRevoke = currentVote && windowInfo?.can_revoke;

  return (
    <div className="card-dark-light">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {TIME_ICONS[slot.time_of_day]}
          <div>
            <p className="text-xs font-semibold text-white/40 uppercase tracking-wide">
              {slot.day}{slot.resolved_match_date ? ` · ${formatDateDisplay(slot.resolved_match_date)}` : ""}
            </p>
            <p className="font-extrabold text-white text-lg leading-tight">{slot.match_time || slot.time_of_day}</p>
            <p className="text-xs text-white/40">{slot.time_of_day} Match</p>
          </div>
        </div>
        {currentVote && (
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
            currentVote === "available"     ? "bg-green-500/10 text-green-400 border-green-500/30" :
            currentVote === "not_available" ? "bg-red-500/10 text-red-400 border-red-500/30" :
                                              "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
          }`}>
            {currentVote === "available"     ? "✅ Available" :
             currentVote === "not_available" ? "❌ Not Available" :
                                               "🤔 Maybe"}
          </span>
        )}
      </div>

      {/* Per-slot window status */}
      {windowInfo && (
        <div className="mb-3">
          <WindowStatus windowInfo={windowInfo} />
        </div>
      )}

      {/* Forecast for the fixed venue, at this slot's date/time. Deliberately
          left in its own original light styling — WeatherForecast is shared
          with admin/VotingWindow.jsx (an out-of-scope page that keeps the
          light theme), so it can't be recolored here without leaking dark
          styles onto that other page. Small light card inside a dark one is
          an accepted, contained exception. */}
      <div className="rounded-lg overflow-hidden mb-3">
        <WeatherForecast weather={slot.weather} />
      </div>

      {/* Vote buttons */}
      <div className="flex gap-2 flex-wrap">
        <VoteButton
          label="Available"
          emoji="✅"
          value="available"
          active={currentVote === "available"}
          onClick={() => onVote(slot.id, "available")}
          disabled={disabled || loading}
          colorActive="bg-green-500 text-royal-950 border-green-500"
          colorIdle="bg-green-500/5 text-green-400 border-green-500/30 hover:bg-green-500/15"
        />
        <VoteButton
          label="Not Available"
          emoji="❌"
          value="not_available"
          active={currentVote === "not_available"}
          onClick={() => onVote(slot.id, "not_available")}
          disabled={disabled || loading}
          colorActive="bg-red-500 text-white border-red-500"
          colorIdle="bg-red-500/5 text-red-400 border-red-500/30 hover:bg-red-500/15"
        />
      </div>

      {/* Available players — only revealed once you've cast your own vote */}
      {availablePlayers && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <button
            type="button"
            onClick={() => setShowAvailable((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:text-sky-300 active:text-sky-200 min-h-[44px] -my-2 transition-colors duration-150"
          >
            <Users size={13} />
            Available Players ({availablePlayers.length})
            {showAvailable ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {showAvailable && (
            <p className="mt-2 text-xs text-white/45">
              {availablePlayers.length ? availablePlayers.join(", ") : "No one yet — be the first!"}
            </p>
          )}
        </div>
      )}

      {/* Emergency revoke — withdraw an existing vote, even after the window closes */}
      {showRevoke && (
        <button
          onClick={() => onRevoke(slot.id)}
          disabled={revoking}
          title={windowInfo.revoke_deadline ? `Available until ${windowInfo.revoke_deadline}` : undefined}
          className="mt-3 w-full min-h-[44px] flex items-center justify-center gap-1.5 text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-xl py-1.5 hover:bg-amber-500/20 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 transition-all duration-150"
        >
          <AlertTriangle size={12} />
          {revoking ? "Withdrawing…" : "Emergency — Remove My Name"}
        </button>
      )}
    </div>
  );
}
