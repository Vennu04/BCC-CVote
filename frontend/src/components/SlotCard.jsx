import VoteButton from "./VoteButton";
import { useCountdown } from "../hooks/useCountdown";
import { Sun, Sunset, Clock, Lock, AlertTriangle } from "lucide-react";

const DAY_COLORS = {
  Saturday: "from-blue-50 to-blue-100 border-blue-200",
  Sunday:   "from-purple-50 to-purple-100 border-purple-200",
};

const TIME_ICONS = {
  Morning: <Sun size={22} className="text-yellow-500" />,
  Evening: <Sunset size={22} className="text-orange-500" />,
};

function WindowStatus({ windowInfo }) {
  const { hours, minutes, expired } = useCountdown(windowInfo?.seconds_remaining);

  if (!windowInfo?.is_open) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-100 rounded-full px-2.5 py-1">
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
    <div className={`flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 ${
      urgency ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
    }`}>
      <Clock size={11} />
      <span>Closes in {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}</span>
    </div>
  );
}

export default function SlotCard({ slot, currentVote, onVote, disabled, loading, windowInfo, onRevoke, revoking }) {
  const showRevoke = currentVote && windowInfo?.can_revoke;

  return (
    <div className={`rounded-xl border-2 bg-gradient-to-br p-5 ${DAY_COLORS[slot.day] || "from-gray-50 to-gray-100 border-gray-200"}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {TIME_ICONS[slot.time_of_day]}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{slot.day}</p>
            <p className="font-bold text-gray-900 text-lg leading-tight">{slot.match_time || slot.time_of_day}</p>
            <p className="text-xs text-gray-500">{slot.time_of_day} Match</p>
          </div>
        </div>
        {currentVote && (
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
            currentVote === "available"     ? "bg-green-100 text-green-800" :
            currentVote === "not_available" ? "bg-red-100 text-red-800" :
                                              "bg-yellow-100 text-yellow-800"
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

      {/* Vote buttons */}
      <div className="flex gap-2 flex-wrap">
        <VoteButton
          label="Available"
          emoji="✅"
          value="available"
          active={currentVote === "available"}
          onClick={() => onVote(slot.id, "available")}
          disabled={disabled || loading}
          colorActive="bg-green-600 text-white border-green-600"
          colorIdle="bg-white text-green-700 border-green-300 hover:bg-green-50"
        />
        <VoteButton
          label="Not Available"
          emoji="❌"
          value="not_available"
          active={currentVote === "not_available"}
          onClick={() => onVote(slot.id, "not_available")}
          disabled={disabled || loading}
          colorActive="bg-red-600 text-white border-red-600"
          colorIdle="bg-white text-red-700 border-red-300 hover:bg-red-50"
        />
      </div>

      {/* Emergency revoke — withdraw an existing vote, even after the window closes */}
      {showRevoke && (
        <button
          onClick={() => onRevoke(slot.id)}
          disabled={revoking}
          title={windowInfo.revoke_deadline ? `Available until ${windowInfo.revoke_deadline}` : undefined}
          className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-300 rounded-lg py-1.5 hover:bg-amber-100 disabled:opacity-50 transition-colors"
        >
          <AlertTriangle size={12} />
          {revoking ? "Withdrawing…" : "Emergency — Remove My Name"}
        </button>
      )}
    </div>
  );
}
